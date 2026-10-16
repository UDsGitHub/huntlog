import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  SALARY_PERIOD_LABELS,
  SOURCE_SUGGESTIONS,
  WORK_MODE_LABELS,
  type ApplicationInput,
  type FieldErrors,
  type InputField,
} from '@/lib/applicationInput';
import {
  NotFoundError,
  saveApplication,
  ValidationError,
  type DuplicateMatch,
} from '@/lib/applications';
import { todayLocal } from '@/lib/dates';
import { capturedDetailFields } from '@/lib/captureDraft';
import type { FormDefaults } from '@/lib/formDefaults';
import {
  ACTIVE_STATUSES,
  appliedAtOptional,
  CLOSED_STATUSES,
  isStatus,
  STATUS_LABELS,
} from '@/lib/status';
import { defaultCurrency, numberSeparators, orderedCurrencies } from '@/lib/locale';
import type { Application } from '@/lib/types';
import { DuplicateWarning } from './DuplicateWarning';
import { useStickyBar } from './Toast';
import type { CapturePrefill } from './useCaptureDraft';

interface Props {
  /** A captured page or link. The form is remounted per capture (keyed by nonce), so it's read once. */
  prefill?: CapturePrefill | null;
  /** Edit mode: the stored application to change. Without it, the form adds a new one. */
  application?: Application;
  /** Remembered source and work mode; used only for a manual Add (no capture, not Edit). */
  defaults?: FormDefaults;
  onSaved: (application: Application) => void;
  onCancel: () => void;
  /** "View existing" in the duplicate warning: leave this form for that application. */
  onViewExisting: (id: string) => void;
}

type FormValues = Required<{ [K in keyof ApplicationInput]: string }>;

/** Fields above More details, in screen order (title has no validation of its own). */
const MAIN_FIELDS: InputField[] = ['url', 'company', 'status', 'appliedAt'];
/** Fields under More details (spec §4.2), in screen order. */
const DETAIL_FIELDS: InputField[] = [
  'location',
  'workMode',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
  'source',
  'notes',
];
/** Screen order; the first invalid field gets focus. */
const FIELD_ORDER: InputField[] = [...MAIN_FIELDS, ...DETAIL_FIELDS];
/** Detail fields whose value means something was entered: currency and period always have one. */
const DETAIL_VALUE_FIELDS = DETAIL_FIELDS.filter(
  (field): field is Exclude<InputField, 'salaryCurrency' | 'salaryPeriod'> =>
    field !== 'salaryCurrency' && field !== 'salaryPeriod',
);

const input =
  'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';

/** Stored values shown as form text; salaries use the locale's decimal separator. */
function formValuesFrom(app: Application): FormValues {
  const { decimal } = numberSeparators();
  const number = (n: number | undefined) =>
    n === undefined ? '' : String(n).replace('.', decimal);
  return {
    url: app.url,
    company: app.company,
    title: app.title ?? '',
    location: app.location ?? '',
    workMode: app.workMode ?? '',
    status: app.status,
    appliedAt: app.appliedAt ?? '',
    salaryMin: number(app.salaryMin),
    salaryMax: number(app.salaryMax),
    salaryCurrency: app.salaryCurrency ?? defaultCurrency(),
    salaryPeriod: app.salaryPeriod ?? 'year',
    source: app.source ?? '',
    notes: app.notes ?? '',
  };
}

export function ApplicationForm({
  prefill,
  application,
  defaults,
  onSaved,
  onCancel,
  onViewExisting,
}: Props) {
  // Without React's colons, the ids are valid in CSS selectors too (happy-dom resolves `list` that way).
  const id = useId().replace(/:/g, '');
  const draft = application ? undefined : prefill?.draft;
  const [values, setValues] = useState<FormValues>(() =>
    application
      ? formValuesFrom(application)
      : {
          url: draft?.url ?? '',
          company: '',
          title: draft?.title ?? '',
          location: '',
          // Remembered defaults are for a manual Add only (this form owns that rule); a capture
          // fills just what it captured.
          workMode: (!draft && defaults?.workMode) || '',
          status: 'applied',
          appliedAt: todayLocal(),
          salaryMin: '',
          salaryMax: '',
          salaryCurrency: defaultCurrency(),
          salaryPeriod: 'year',
          source: (!draft && defaults?.source) || '',
          notes: '',
        },
  );
  // More details opens on its own in Edit when a field inside has a value, and after a capture
  // that filled one (none yet; see capturedDetailFields). Errors inside open it too (save()).
  const [detailsOpen, setDetailsOpen] = useState(() => {
    if (application) return DETAIL_VALUE_FIELDS.some((field) => application[field] !== undefined);
    return draft ? capturedDetailFields(draft).length > 0 : false;
  });
  const readFailed = Boolean(draft?.readFailed);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const fieldRefs = useRef<Partial<Record<InputField, HTMLElement | null>>>({});
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  // Focus for the first invalid field moves after the render that re-enables the fieldset (a
  // disabled field can't take focus). A ref, used once, so it never steals focus later.
  const pendingFocus = useRef<InputField | null>(null);
  useLayoutEffect(() => {
    if (isSaving || !pendingFocus.current) return;
    fieldRefs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  }, [errors, isSaving]);
  // Includes a stored currency the runtime doesn't know, so Edit never silently swaps it.
  const storedCurrency = application?.salaryCurrency;
  const currencies = useMemo(() => orderedCurrencies(undefined, storedCurrency), [storedCurrency]);
  const stickyBar = useRef<HTMLDivElement>(null);
  useStickyBar(stickyBar);

  // Start at the first empty required field: Company after a capture with a URL, otherwise URL.
  // A layout effect, so focus moves in the same commit that shows the form.
  useLayoutEffect(() => {
    fieldRefs.current[draft?.url ? 'company' : 'url']?.focus();
  }, [draft]);

  // A hint stays while the field still holds exactly what was captured.
  const hints = {
    url: Boolean(draft?.url) && values.url === draft?.url,
    title: Boolean(draft?.title) && values.title === draft?.title,
  };

  const set = (field: keyof FormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    // The warning is about what was submitted; changing what it matched on clears it.
    if (field === 'url' || field === 'company' || field === 'title') setDuplicates(null);
  };
  const register = (field: InputField) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await save({ allowDuplicate: false });
  }

  async function save({ allowDuplicate }: { allowDuplicate: boolean }) {
    if (saving.current) return;
    setErrors({});
    setSaveError(null);
    saving.current = true;
    setIsSaving(true);
    try {
      // One call validates, checks for duplicates and saves; the rules live in lib only.
      // Date applied is hidden for Saved. A new Saved job stores none; an existing job keeps
      // the date it had, since a status change never overwrites it (spec §5).
      const input =
        values.status === 'saved' ? { ...values, appliedAt: application?.appliedAt ?? '' } : values;
      const result = await saveApplication(input, { id: application?.id, allowDuplicate });
      if ('duplicates' in result) {
        setDuplicates(result.duplicates);
        saving.current = false;
        setIsSaving(false);
        return;
      }
      onSaved(result.saved);
    } catch (error) {
      saving.current = false;
      setIsSaving(false);
      setDuplicates(null);
      if (error instanceof ValidationError) {
        setErrors(error.fields);
        // The first invalid field, in screen order (also for errors only storage can catch).
        const first = FIELD_ORDER.find((field) => error.fields[field]);
        // Any error inside More details opens it, even when the first error is above it.
        if (DETAIL_FIELDS.some((field) => error.fields[field])) setDetailsOpen(true);
        pendingFocus.current = first ?? null;
        return;
      }
      if (error instanceof NotFoundError) {
        setSaveError("This application was deleted, so the changes can't be saved.");
        return;
      }
      console.error('Saving the application failed', error);
      setSaveError("Couldn't save. Please try again.");
    }
  }

  /** Props shared by every control: id, validity and the ids of its hint and error. */
  const control = (field: InputField, hint = false) => ({
    id: `${id}-${field}`,
    name: field,
    ref: register(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby':
      [hint && `${id}-${field}-hint`, errors[field] && `${id}-${field}-error`]
        .filter(Boolean)
        .join(' ') || undefined,
    className: input,
  });

  const message = (field: InputField, hint = false) => (
    <>
      {hint && <AutoFilledHint id={`${id}-${field}-hint`} />}
      {errors[field] && (
        <p id={`${id}-${field}-error`} className="text-xs text-red-700">
          {errors[field]}
        </p>
      )}
    </>
  );

  const workModeLabel = values.workMode
    ? WORK_MODE_LABELS[values.workMode as keyof typeof WORK_MODE_LABELS]
    : undefined;
  // While collapsed, say what's inside, so remembered defaults are never invisible.
  const detailsSummary = [
    values.location.trim(),
    workModeLabel,
    (values.salaryMin.trim() || values.salaryMax.trim()) && 'Salary',
    values.source.trim(),
    values.notes.trim() && 'Notes',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={application ? 'Edit application' : 'Add application'}
      aria-busy={isSaving || undefined}
      className="flex flex-col gap-3"
    >
      {/* Locked while saving: the save writes what was there when Save was pressed. */}
      <fieldset disabled={isSaving} className="flex min-w-0 flex-col gap-3">
        {readFailed && <p className="text-sm text-slate-700">{readFailedMessage(draft?.url)}</p>}

        <Field label="Job posting URL" htmlFor={`${id}-url`}>
          <input
            {...control('url', hints.url)}
            type="text"
            inputMode="url"
            autoComplete="off"
            value={values.url}
            onChange={(e) => set('url')(e.target.value)}
          />
          {message('url', hints.url)}
        </Field>

        <Field label="Company" htmlFor={`${id}-company`}>
          <input
            {...control('company')}
            type="text"
            autoComplete="off"
            value={values.company}
            onChange={(e) => set('company')(e.target.value)}
          />
          {message('company')}
        </Field>

        <Field label="Job title" optional htmlFor={`${id}-title`}>
          <input
            id={`${id}-title`}
            name="title"
            type="text"
            autoComplete="off"
            value={values.title}
            onChange={(e) => set('title')(e.target.value)}
            aria-describedby={hints.title ? `${id}-title-hint` : undefined}
            className={input}
          />
          {hints.title && <AutoFilledHint id={`${id}-title-hint`} />}
        </Field>

        <Field label="Status" htmlFor={`${id}-status`}>
          <select
            {...control('status')}
            value={values.status}
            onChange={(e) => set('status')(e.target.value)}
          >
            <optgroup label="Active">
              {ACTIVE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Closed">
              {CLOSED_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </optgroup>
          </select>
          {message('status')}
        </Field>

        {/* Hidden for Saved: nothing was applied for yet (spec §4.2, §5). */}
        <div hidden={values.status === 'saved'}>
          <Field
            label="Date applied"
            optional={isStatus(values.status) && appliedAtOptional(values.status)}
            htmlFor={`${id}-appliedAt`}
          >
            <input
              {...control('appliedAt')}
              type="date"
              max={todayLocal()}
              value={values.appliedAt}
              onChange={(e) => set('appliedAt')(e.target.value)}
            />
            {message('appliedAt')}
          </Field>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={`${id}-details`}
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex items-center gap-1 self-start rounded text-sm font-medium text-indigo-700 hover:underline focus:outline-2 focus:outline-indigo-600"
          >
            <span aria-hidden="true">{detailsOpen ? '▾' : '▸'}</span>
            More details
          </button>
          {!detailsOpen && detailsSummary && (
            <p className="text-xs break-words text-slate-600">{detailsSummary}</p>
          )}
        </div>

        {/* Hidden, not unmounted: values and field refs survive collapsing. */}
        <div id={`${id}-details`} hidden={!detailsOpen} className="flex min-w-0 flex-col gap-3">
          <Field label="Location" optional htmlFor={`${id}-location`}>
            <input
              {...control('location')}
              type="text"
              autoComplete="off"
              value={values.location}
              onChange={(e) => set('location')(e.target.value)}
            />
            {message('location')}
          </Field>

          <Field label="Work mode" optional htmlFor={`${id}-workMode`}>
            <select
              {...control('workMode')}
              value={values.workMode}
              onChange={(e) => set('workMode')(e.target.value)}
            >
              <option value="">Not set</option>
              {Object.entries(WORK_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {message('workMode')}
          </Field>

          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-sm font-medium">
              Salary <span className="font-normal text-slate-600">(optional)</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Minimum" htmlFor={`${id}-salaryMin`} small>
                <input
                  {...control('salaryMin')}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={values.salaryMin}
                  onChange={(e) => set('salaryMin')(e.target.value)}
                />
                {message('salaryMin')}
              </Field>
              <Field label="Maximum" htmlFor={`${id}-salaryMax`} small>
                <input
                  {...control('salaryMax')}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={values.salaryMax}
                  onChange={(e) => set('salaryMax')(e.target.value)}
                />
                {message('salaryMax')}
              </Field>
              <Field label="Currency" htmlFor={`${id}-salaryCurrency`} small>
                <select
                  {...control('salaryCurrency')}
                  value={values.salaryCurrency}
                  onChange={(e) => set('salaryCurrency')(e.target.value)}
                >
                  <optgroup label="Common">
                    {currencies.common.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="All currencies">
                    {currencies.others.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {message('salaryCurrency')}
              </Field>
              <Field label="Per" htmlFor={`${id}-salaryPeriod`} small>
                <select
                  {...control('salaryPeriod')}
                  value={values.salaryPeriod}
                  onChange={(e) => set('salaryPeriod')(e.target.value)}
                >
                  {Object.entries(SALARY_PERIOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {message('salaryPeriod')}
              </Field>
            </div>
          </fieldset>

          <Field label="Source" optional htmlFor={`${id}-source`}>
            <input
              {...control('source')}
              type="text"
              autoComplete="off"
              list={`${id}-source-suggestions`}
              value={values.source}
              onChange={(e) => set('source')(e.target.value)}
            />
            <datalist id={`${id}-source-suggestions`}>
              {SOURCE_SUGGESTIONS.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
            {message('source')}
          </Field>

          <Field label="Notes" optional htmlFor={`${id}-notes`}>
            <textarea
              {...control('notes')}
              rows={4}
              value={values.notes}
              onChange={(e) => set('notes')(e.target.value)}
            />
            {message('notes')}
          </Field>
        </div>
      </fieldset>
      {duplicates && (
        <DuplicateWarning
          matches={duplicates}
          editing={Boolean(application)}
          onViewExisting={onViewExisting}
          onSaveAnyway={() => void save({ allowDuplicate: true })}
        />
      )}
      {saveError && (
        <p role="alert" className="text-xs text-red-700">
          {saveError}
        </p>
      )}
      {/* Sticky: Save is always reachable without scrolling (spec §4.2, §10). */}
      <div
        ref={stickyBar}
        className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-white px-4 py-3"
      >
        <button
          type="submit"
          aria-disabled={isSaving || undefined}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  small,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className={small ? 'text-xs font-medium' : 'text-sm font-medium'}>
        {label}
        {optional && <span className="font-normal text-slate-600"> (optional)</span>}
      </label>
      {children}
    </div>
  );
}

export function readFailedMessage(keptUrl: string | undefined): string {
  return keptUrl
    ? "Couldn't read this page, so only its address was filled in."
    : "Couldn't read this page, so fill in the details below.";
}

function AutoFilledHint({ id }: { id: string }) {
  return (
    <p id={id} className="text-xs text-slate-600">
      Auto-filled, please check
    </p>
  );
}
