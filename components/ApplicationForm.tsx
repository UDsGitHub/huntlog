import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  SALARY_PERIOD_LABELS,
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
import { ResumeField } from './ResumeField';
import { Sheet } from './Sheet';
import type { CapturePrefill } from './useCaptureDraft';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { inert } from './inert';
import { useCollapsing } from './useCollapsing';
import { ChevronDownIcon } from './icons';
import { SourceField } from './SourceField';

interface Props {
  /** The sheet is showing (it stays mounted while it slides out after closing). */
  open: boolean;
  /** After the sheet has finished closing. */
  onClosed?: () => void;
  /** A captured page or link. The form is remounted per capture (keyed by nonce), so it's read once. */
  prefill?: CapturePrefill | null;
  /** Edit mode: the stored application to change. Without it, the form adds a new one. */
  application?: Application;
  /** Remembered source and work mode; used only for a manual Add (no capture, not Edit). */
  defaults?: FormDefaults;
  onSaved: (application: Application) => void;
  /** Back (or Escape), after confirming any discard: leave without saving. */
  onCancel: () => void;
  /** "View existing" in the duplicate warning: leave this form for that application. */
  onViewExisting: (id: string) => void;
}

type FormValues = Required<{ [K in keyof ApplicationInput]: string }>;

/** Fields above More details, in screen order (title has no validation of its own). */
const MAIN_FIELDS: InputField[] = ['company', 'url', 'status', 'appliedAt', 'resumeId'];
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
    resumeId: app.resumeId ?? '',
    appliedAt: app.appliedAt ?? '',
    salaryMin: number(app.salaryMin),
    salaryMax: number(app.salaryMax),
    salaryCurrency: app.salaryCurrency ?? defaultCurrency(),
    salaryPeriod: app.salaryPeriod ?? 'year',
    source: app.source ?? '',
    notes: app.notes ?? '',
  };
}

/**
 * The Add/Edit form (spec §4.2), in a near-full-height sheet: Back in its header (asking before
 * discarding typed changes), Save as its footer, so Save is always in reach and toasts sit above
 * it. A click outside doesn't close it.
 */
export function ApplicationForm({
  open,
  onClosed,
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
  const [initial] = useState<FormValues>(() =>
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
          resumeId: '',
          appliedAt: todayLocal(),
          salaryMin: '',
          salaryMax: '',
          salaryCurrency: defaultCurrency(),
          salaryPeriod: 'year',
          source: (!draft && defaults?.source) || '',
          notes: '',
        },
  );
  const [values, setValues] = useState<FormValues>(initial);
  // Anything typed since the form opened: leaving then asks first (spec §3).
  const dirty = (Object.keys(values) as (keyof FormValues)[]).some(
    (field) => values[field] !== initial[field],
  );
  // More details opens on its own in Edit when a field inside has a value. Errors inside open
  // it too (save()).
  const [detailsOpen, setDetailsOpen] = useState(() => {
    if (application) return DETAIL_VALUE_FIELDS.some((field) => application[field] !== undefined);
    // Captures fill only URL and title, both above More details. M8's extractor adds location,
    // work mode and salary: then open it for those, so their "Auto-filled" hints are seen.
    return false;
  });
  // Collapsing slides shut before the section is hidden (not under reduced motion).
  const detailsClosing = useCollapsing(detailsOpen);
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
  // The sheet focuses Company when it opens: the first field, and the first one a capture
  // leaves empty. (After the sheet records the opener, so focus returns there.) A view of the
  // field refs, not a second copy of them.
  const companyRef = useMemo<RefObject<HTMLElement>>(
    () => ({
      get current() {
        return fieldRefs.current.company ?? null;
      },
    }),
    [],
  );

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
    className: 'field',
  });

  const message = (field: InputField, hint = false) => (
    <>
      {hint && <AutoFilledHint id={`${id}-${field}-hint`} />}
      {errors[field] && (
        <p id={`${id}-${field}-error`} className="field-error">
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

  const formId = `${id}-form`;
  const dateHidden = values.status === 'saved';
  const dateOptional = isStatus(values.status) && appliedAtOptional(values.status);
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      onClosed={onClosed}
      title={application ? 'Edit application' : 'Add application'}
      closeButton="back"
      size="full"
      dirty={dirty}
      initialFocus={companyRef}
      footer={
        <button
          type="submit"
          form={formId}
          aria-disabled={isSaving || undefined}
          className="btn btn-primary w-full"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        aria-label={application ? 'Edit application' : 'Add application'}
        aria-busy={isSaving || undefined}
        className="flex flex-col gap-3"
      >
        {/* Enter in a field submits through the form's default button. The visible Save is in
            the sheet's footer, outside this element (joined by form=), so this hidden one keeps
            Enter working the same everywhere. */}
        <button type="submit" hidden disabled={isSaving} tabIndex={-1} aria-hidden="true" />
        {/* Locked while saving: the save writes what was there when Save was pressed. */}
        <fieldset disabled={isSaving} className="flex min-w-0 flex-col gap-3">
          {readFailed && (
            <p className="text-sm text-muted-foreground">{readFailedMessage(draft?.url)}</p>
          )}
          <p className="field-hint">
            <span aria-hidden="true">Fields marked * are required.</span>
          </p>

          <Field label="Company" required htmlFor={`${id}-company`}>
            <input
              {...control('company')}
              type="text"
              autoComplete="off"
              aria-required="true"
              value={values.company}
              onChange={(e) => set('company')(e.target.value)}
            />
            {message('company')}
          </Field>

          <Field label="Job title" htmlFor={`${id}-title`}>
            <input
              id={`${id}-title`}
              name="title"
              type="text"
              autoComplete="off"
              value={values.title}
              onChange={(e) => set('title')(e.target.value)}
              aria-describedby={hints.title ? `${id}-title-hint` : undefined}
              className="field"
            />
            {hints.title && <AutoFilledHint id={`${id}-title-hint`} />}
          </Field>

          <Field label="Job posting URL" required htmlFor={`${id}-url`}>
            <input
              {...control('url', hints.url)}
              type="text"
              inputMode="url"
              autoComplete="off"
              aria-required="true"
              value={values.url}
              onChange={(e) => set('url')(e.target.value)}
            />
            {message('url', hints.url)}
          </Field>

          {/* Status and Date applied share a row; Status takes it when the date is hidden. */}
          <div className={`grid min-w-0 gap-2 ${dateHidden ? 'grid-cols-1' : 'grid-cols-2'}`}>
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
            <div hidden={dateHidden} className="min-w-0">
              <Field label="Date applied" required={!dateOptional} htmlFor={`${id}-appliedAt`}>
                <input
                  {...control('appliedAt')}
                  type="date"
                  max={todayLocal()}
                  aria-required={!dateOptional || undefined}
                  value={values.appliedAt}
                  onChange={(e) => set('appliedAt')(e.target.value)}
                />
                {message('appliedAt')}
              </Field>
            </div>
          </div>
          <ResumeField
            id={`${id}-resumeId`}
            value={values.resumeId}
            onChange={(resumeId) => set('resumeId')(resumeId)}
            linked={
              application?.resumeId
                ? { resumeId: application.resumeId, snapshot: application.resumeNameSnapshot }
                : undefined
            }
            error={errors.resumeId}
            inputRef={register('resumeId')}
          />

          {/* An accordion row (spec §4.2): the hint says what's inside, or what's filled in. */}
          <div className="-mx-1 flex min-w-0 flex-col border-y">
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={`${id}-details`}
              aria-describedby={`${id}-details-hint`}
              onClick={() => setDetailsOpen((open) => !open)}
              className="focus-ring flex w-full items-center justify-between gap-2 rounded-sm px-1 pt-3 pb-1 text-left text-sm font-medium"
            >
              More details
              <ChevronDownIcon
                className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <p
              id={`${id}-details-hint`}
              className="px-1 pb-3 text-xs break-words text-muted-foreground"
            >
              {detailsOpen ? '' : detailsSummary || 'Location, work mode, salary, source, notes'}
            </p>
          </div>

          {/* Hidden, not unmounted: values and field refs survive collapsing. It slides open and
              shut, its height growing and shrinking (instantly under reduced motion). */}
          <div
            id={`${id}-details`}
            hidden={!detailsOpen && !detailsClosing}
            // Sliding shut: out of reach already, so focus can't land in it just before it hides.
            {...inert(detailsClosing)}
            data-state={detailsOpen ? 'open' : 'closing'}
            className="details-panel min-w-0"
          >
            {/* The panel animates its height; this is the content it clips. */}
            <div className="flex min-w-0 flex-col gap-3">
              <Field label="Location" htmlFor={`${id}-location`}>
                <input
                  {...control('location')}
                  type="text"
                  autoComplete="off"
                  value={values.location}
                  onChange={(e) => set('location')(e.target.value)}
                />
                {message('location')}
              </Field>

              <Field label="Work mode" htmlFor={`${id}-workMode`}>
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
                <legend className="field-label">Salary</legend>
                {/* Minimum – Maximum on one row, currency and period below. */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-2">
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
                  <span aria-hidden="true" className="pt-7 text-muted-foreground">
                    –
                  </span>
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
                </div>
                <div className="grid grid-cols-2 gap-2">
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

              <SourceField
                id={`${id}-source`}
                value={values.source}
                onChange={set('source')}
                error={errors.source}
                inputRef={register('source')}
              />

              <Field label="Notes" htmlFor={`${id}-notes`}>
                <AutoGrowTextarea
                  {...control('notes')}
                  value={values.notes}
                  onChange={(e) => set('notes')(e.target.value)}
                />
                {message('notes')}
              </Field>
            </div>
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
          <p role="alert" className="field-error">
            {saveError}
          </p>
        )}
      </form>
    </Sheet>
  );
}

function Field({
  label,
  htmlFor,
  required,
  small,
  children,
}: {
  label: string;
  htmlFor: string;
  /** Marked with an asterisk; the field itself says "required" to screen readers. */
  required?: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* The asterisk sits beside the label, not in it: the field's name stays "Company". */}
      <div className="flex items-baseline gap-0.5">
        <label htmlFor={htmlFor} className={small ? 'text-xs font-medium' : 'field-label'}>
          {label}
        </label>
        {required && (
          <span aria-hidden="true" className="text-sm font-medium text-destructive">
            *
          </span>
        )}
      </div>
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
    <p id={id} className="text-xs text-muted-foreground">
      Auto-filled, please check
    </p>
  );
}
