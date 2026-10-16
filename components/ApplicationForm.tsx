import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  SALARY_PERIOD_LABELS,
  SOURCE_SUGGESTIONS,
  WORK_MODE_LABELS,
  type ApplicationInput,
  type FieldErrors,
  type InputField,
} from '@/lib/applicationInput';
import { addApplication, ValidationError } from '@/lib/applications';
import { todayLocal } from '@/lib/dates';
import { defaultCurrency, knownCurrencies } from '@/lib/locale';
import type { Application } from '@/lib/types';
import type { CapturePrefill } from './useCaptureDraft';

interface Props {
  /** A captured page or link. The form is remounted per capture (keyed by nonce), so it's read once. */
  prefill?: CapturePrefill | null;
  onSaved: (application: Application) => void;
  onCancel: () => void;
}

type FormValues = Required<{ [K in keyof ApplicationInput]: string }>;

/** Order of the fields on screen; the first invalid one gets focus. */
const FIELD_ORDER: InputField[] = [
  'url',
  'company',
  'location',
  'workMode',
  'appliedAt',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
  'source',
  'notes',
];

const input =
  'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';

export function ApplicationForm({ prefill, onSaved, onCancel }: Props) {
  // Without React's colons, the ids are valid in CSS selectors too (happy-dom resolves `list` that way).
  const id = useId().replace(/:/g, '');
  const draft = prefill?.draft;
  const [values, setValues] = useState<FormValues>(() => ({
    url: draft?.url ?? '',
    company: '',
    title: draft?.title ?? '',
    location: '',
    workMode: '',
    appliedAt: todayLocal(),
    salaryMin: '',
    salaryMax: '',
    salaryCurrency: defaultCurrency(),
    salaryPeriod: 'year',
    source: '',
    notes: '',
  }));
  const readFailed = Boolean(draft?.readFailed);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const fieldRefs = useRef<Partial<Record<InputField, HTMLElement | null>>>({});
  const currencies = useMemo(() => knownCurrencies(), []);

  // Start at the first empty required field: Company after a capture with a URL, otherwise URL.
  useEffect(() => {
    fieldRefs.current[prefill?.draft.url ? 'company' : 'url']?.focus();
  }, [prefill]);

  // A hint stays while the field still holds exactly what was captured.
  const hints = {
    url: Boolean(draft?.url) && values.url === draft?.url,
    title: Boolean(draft?.title) && values.title === draft?.title,
  };

  const set = (field: keyof FormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  const register = (field: InputField) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    setErrors({});
    setSaveError(null);
    saving.current = true;
    setIsSaving(true);
    try {
      // addApplication validates once and reports field errors through ValidationError.
      onSaved(await addApplication(values));
    } catch (error) {
      saving.current = false;
      setIsSaving(false);
      if (error instanceof ValidationError) {
        setErrors(error.fields);
        const first = FIELD_ORDER.find((field) => error.fields[field]);
        if (first) fieldRefs.current[first]?.focus();
        return;
      }
      console.error('addApplication failed', error);
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

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Add application"
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

        <Field label="Date applied" htmlFor={`${id}-appliedAt`}>
          <input
            {...control('appliedAt')}
            type="date"
            max={todayLocal()}
            value={values.appliedAt}
            onChange={(e) => set('appliedAt')(e.target.value)}
          />
          {message('appliedAt')}
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
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
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
      </fieldset>
      {saveError && (
        <p role="alert" className="text-xs text-red-700">
          {saveError}
        </p>
      )}
      <div className="flex gap-2">
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
