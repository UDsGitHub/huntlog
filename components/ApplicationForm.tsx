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
import { currencyLabel, defaultCurrency, orderedCurrencies } from '@/lib/locale';
import { formatNumber } from '@/lib/numberInput';
import type { Application, Status } from '@/lib/types';
import { DuplicateWarning } from './DuplicateWarning';
import { ResumeField } from './ResumeField';
import { Sheet } from './Sheet';
import type { CapturePrefill } from './useCaptureDraft';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { inert } from './inert';
import { useCollapsing } from './useCollapsing';
import { ChevronDownIcon } from './icons';
import { Combobox } from './Combobox';
import { NumberField } from './NumberField';
import { Select } from './Select';
import { SourceField } from './SourceField';
import { sourceFromUrl } from '@/lib/captureSource';
import { SUBMIT_SHORTCUT, SubmitShortcutHint } from './submitShortcut';

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
/** Fields a capture can fill besides URL and title (spec §7), each with its "Auto-filled" hint. */
const CAPTURED_FIELDS = [
  'company',
  'location',
  'workMode',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
] as const;
/** Those inside More details: a capture that filled one opens the section. */
const CAPTURED_DETAIL_FIELDS = CAPTURED_FIELDS.filter((field) => field !== 'company');

const DETAIL_VALUE_FIELDS = DETAIL_FIELDS.filter(
  (field): field is Exclude<InputField, 'salaryCurrency' | 'salaryPeriod'> =>
    field !== 'salaryCurrency' && field !== 'salaryPeriod',
);

/** Stored values shown as form text; salaries as the number field shows them (grouped). */
function formValuesFrom(app: Application): FormValues {
  const number = (n: number | undefined) => (n === undefined ? '' : formatNumber(n));
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
  // The job board a capture came from, told by its address (spec §4.1).
  const [capturedSource] = useState(() => sourceFromUrl(draft?.url));
  const [initial] = useState<FormValues>(() =>
    application
      ? formValuesFrom(application)
      : {
          url: draft?.url ?? '',
          // A capture fills what the page said about the job (spec §7).
          company: draft?.company ?? '',
          title: draft?.title ?? '',
          location: draft?.location ?? '',
          // Remembered defaults (this form owns these rules): a manual Add starts with the last
          // work mode and source; a capture fills just what it captured, its source told by the
          // address. Both start with the last resume, the one most likely sent again.
          workMode: (draft ? draft.workMode : defaults?.workMode) || '',
          status: 'applied',
          resumeId: defaults?.resumeId || '',
          appliedAt: todayLocal(),
          salaryMin: draft?.salaryMin === undefined ? '' : formatNumber(draft.salaryMin),
          salaryMax: draft?.salaryMax === undefined ? '' : formatNumber(draft.salaryMax),
          salaryCurrency: draft?.salaryCurrency ?? defaultCurrency(),
          salaryPeriod: draft?.salaryPeriod ?? 'year',
          source: (draft ? capturedSource : defaults?.source) || '',
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
    // A capture that filled a field inside opens it, so its "Auto-filled" hint is seen. A source
    // told by the address doesn't: the row's hint already shows it (spec §4.1).
    return CAPTURED_DETAIL_FIELDS.some((field) => draft?.[field] !== undefined);
  });
  // Collapsing slides shut before the section is hidden (not under reduced motion).
  const detailsClosing = useCollapsing(detailsOpen);
  // Only a tap on the row animates. Opening on its own (an error inside, a capture, Edit) is
  // instant: an error focuses its field at once, and a panel still growing would push that
  // field out of view.
  const [detailsAnimate, setDetailsAnimate] = useState(false);
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
  // Common ones first (the locale's, USD, EUR, GBP), then the rest; searchable by code or name.
  const currencyOptions = useMemo(() => {
    const { common, others } = orderedCurrencies(undefined, storedCurrency);
    return [...common, ...others].map((code) => ({ value: code, label: currencyLabel(code) }));
  }, [storedCurrency]);
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
  const capturedHint = (field: (typeof CAPTURED_FIELDS)[number]) =>
    draft?.[field] !== undefined && values[field] === initial[field];
  const hints = {
    url: Boolean(draft?.url) && values.url === draft?.url,
    title: Boolean(draft?.title) && values.title === draft?.title,
    source: Boolean(capturedSource) && values.source === capturedSource,
    ...(Object.fromEntries(CAPTURED_FIELDS.map((field) => [field, capturedHint(field)])) as Record<
      (typeof CAPTURED_FIELDS)[number],
      boolean
    >),
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
        if (DETAIL_FIELDS.some((field) => error.fields[field])) {
          setDetailsAnimate(false);
          setDetailsOpen(true);
        }
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

  /** The same wiring for a `Select`, whose focusable element is its button. */
  const selectControl = (field: InputField, hint = false) => {
    const { id: fieldId, name, ref, ...aria } = control(field, hint);
    return {
      id: fieldId,
      name,
      buttonRef: ref,
      'aria-invalid': aria['aria-invalid'],
      'aria-describedby': aria['aria-describedby'],
    };
  };

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
  // The row's hint, open or closed: what's filled in inside, so remembered defaults are never
  // invisible, else what the section holds.
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
          {...SUBMIT_SHORTCUT}
          className="btn btn-primary relative w-full"
        >
          {isSaving ? 'Saving…' : 'Save'}
          <SubmitShortcutHint />
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
              {...control('company', hints.company)}
              type="text"
              autoComplete="off"
              aria-required="true"
              value={values.company}
              onChange={(e) => set('company')(e.target.value)}
            />
            {message('company', hints.company)}
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
              <Select
                {...selectControl('status')}
                listLabel="Statuses"
                value={values.status}
                onChange={set('status')}
                options={[
                  { label: 'Active', options: ACTIVE_STATUSES.map(statusOption) },
                  { label: 'Closed', options: CLOSED_STATUSES.map(statusOption) },
                ]}
              />
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

          {/* An accordion (spec §4.2): the row names the section and says what's inside, or
              what's filled in; the fields grow open under it, in the same section. They're
              hidden, not unmounted, so values and field refs survive collapsing. The panel
              grows and shrinks in height (instantly under reduced motion). */}
          <div className="-mx-1 flex min-w-0 flex-col border-t">
            {/* The button holds just its name (WCAG 2.5.3: the visible label is the whole name)
                and its ::after covers the row, so a tap anywhere on it toggles; the hint is its
                description. */}
            <div className="relative flex w-full items-start justify-between gap-2 rounded-sm px-1 py-3 has-[.details-toggle:focus-visible]:outline-2 has-[.details-toggle:focus-visible]:outline-offset-2 has-[.details-toggle:focus-visible]:outline-ring">
              <span className="flex min-w-0 flex-col gap-0.5">
                <button
                  type="button"
                  aria-expanded={detailsOpen}
                  aria-controls={`${id}-details`}
                  aria-describedby={`${id}-details-hint`}
                  onClick={() => {
                    setDetailsAnimate(true);
                    setDetailsOpen((open) => !open);
                  }}
                  className="details-toggle text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-sm after:content-['']"
                >
                  More details
                </button>
                <span
                  id={`${id}-details-hint`}
                  className="text-xs break-words text-muted-foreground"
                >
                  {detailsSummary || 'Location, work mode, salary, source, notes'}
                </span>
              </span>
              <ChevronDownIcon
                className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`}
              />
            </div>
            <div
              id={`${id}-details`}
              hidden={!detailsOpen && !detailsClosing}
              // Sliding shut: out of reach already, so focus can't land in it just before it hides.
              {...inert(detailsClosing)}
              data-state={detailsOpen ? 'open' : 'closing'}
              data-instant={!detailsAnimate || undefined}
              className="details-panel min-w-0"
            >
              {/* The panel animates its height; this is the content it clips. */}
              <div className="flex min-w-0 flex-col gap-3 px-1 pt-1 pb-1">
                <Field label="Location" htmlFor={`${id}-location`}>
                  <input
                    {...control('location', hints.location)}
                    type="text"
                    autoComplete="off"
                    value={values.location}
                    onChange={(e) => set('location')(e.target.value)}
                  />
                  {message('location', hints.location)}
                </Field>

                <Field label="Work mode" htmlFor={`${id}-workMode`}>
                  <Select
                    {...selectControl('workMode', hints.workMode)}
                    listLabel="Work modes"
                    value={values.workMode}
                    onChange={set('workMode')}
                    options={[
                      { value: '', label: 'Not set' },
                      ...Object.entries(WORK_MODE_LABELS).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                  {message('workMode', hints.workMode)}
                </Field>

                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="field-label">Salary</legend>
                  {/* Minimum – Maximum on one row, currency and period below. */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-2">
                    <Field label="Minimum" htmlFor={`${id}-salaryMin`} small>
                      <NumberField
                        {...control('salaryMin', hints.salaryMin)}
                        kind="amount"
                        value={values.salaryMin}
                        onChange={set('salaryMin')}
                      />
                      {message('salaryMin', hints.salaryMin)}
                    </Field>
                    <span aria-hidden="true" className="pt-7 text-muted-foreground">
                      –
                    </span>
                    <Field label="Maximum" htmlFor={`${id}-salaryMax`} small>
                      <NumberField
                        {...control('salaryMax', hints.salaryMax)}
                        kind="amount"
                        value={values.salaryMax}
                        onChange={set('salaryMax')}
                      />
                      {message('salaryMax', hints.salaryMax)}
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Currency" htmlFor={`${id}-salaryCurrency`} small>
                      <Combobox
                        id={`${id}-salaryCurrency`}
                        listLabel="Currencies"
                        value={values.salaryCurrency}
                        onChange={set('salaryCurrency')}
                        options={currencyOptions}
                        inputRef={register('salaryCurrency')}
                        invalid={Boolean(errors.salaryCurrency)}
                        describedBy={
                          [
                            hints.salaryCurrency && `${id}-salaryCurrency-hint`,
                            errors.salaryCurrency && `${id}-salaryCurrency-error`,
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                      />
                      {message('salaryCurrency', hints.salaryCurrency)}
                    </Field>
                    <Field label="Per" htmlFor={`${id}-salaryPeriod`} small>
                      <Select
                        {...selectControl('salaryPeriod', hints.salaryPeriod)}
                        listLabel="Periods"
                        value={values.salaryPeriod}
                        onChange={set('salaryPeriod')}
                        options={Object.entries(SALARY_PERIOD_LABELS).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                      />
                      {message('salaryPeriod', hints.salaryPeriod)}
                    </Field>
                  </div>
                </fieldset>

                <SourceField
                  id={`${id}-source`}
                  value={values.source}
                  onChange={set('source')}
                  error={errors.source}
                  inputRef={register('source')}
                  describedBy={hints.source ? `${id}-source-hint` : undefined}
                />
                {hints.source && <AutoFilledHint id={`${id}-source-hint`} />}

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

const statusOption = (status: Status) => ({ value: status, label: STATUS_LABELS[status] });
