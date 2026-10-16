import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addApplication, validateNewApplication, type FieldErrors } from '@/lib/applications';
import type { CapturePrefill } from './useCaptureDraft';

interface Props {
  /** A captured page or link. The form is remounted per capture (keyed by nonce), so it's read once. */
  prefill?: CapturePrefill | null;
}

export function AddApplicationForm({ prefill }: Props) {
  const id = useId();
  const draft = prefill?.draft;
  const [url, setUrl] = useState(draft?.url ?? '');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState(draft?.title ?? '');
  const [readFailed, setReadFailed] = useState(Boolean(draft?.readFailed));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);

  // Start at the first empty required field: Company, or the URL when none could be captured.
  useEffect(() => {
    if (prefill) (prefill.draft.url ? companyRef : urlRef).current?.focus();
  }, [prefill]);

  // A hint stays while the field still holds exactly what was captured.
  const hints = {
    url: Boolean(draft?.url) && url === draft?.url,
    title: Boolean(draft?.title) && title === draft?.title,
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const result = validateNewApplication({ url, company, title });
    setErrors(result.errors);
    setSaveError(null);
    if (!result.values) {
      (result.errors.url ? urlRef : companyRef).current?.focus();
      return;
    }
    const submitted = { url, company, title };
    saving.current = true;
    setIsSaving(true);
    try {
      await addApplication(result.values);
      // Only clear what is unchanged: the user may already be typing the next job.
      setUrl((current) => (current === submitted.url ? '' : current));
      setCompany((current) => (current === submitted.company ? '' : current));
      setTitle((current) => (current === submitted.title ? '' : current));
      setReadFailed(false);
      if (
        urlRef.current?.value === submitted.url &&
        companyRef.current?.value === submitted.company
      ) {
        urlRef.current.focus();
      }
    } catch (error) {
      console.error('addApplication failed', error);
      setSaveError("Couldn't save. Please try again.");
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  const describedBy = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(' ') || undefined;

  const field = 'flex flex-col gap-1';
  const input =
    'w-full min-w-0 rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';
  const errorText = 'text-xs text-red-700';

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Add application"
      className="flex flex-col gap-3"
    >
      {readFailed && <p className="text-sm text-slate-700">{readFailedMessage(draft?.url)}</p>}
      <div className={field}>
        <label htmlFor={`${id}-url`} className="text-sm font-medium">
          Job posting URL
        </label>
        <input
          ref={urlRef}
          id={`${id}-url`}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={describedBy(
            hints.url && `${id}-url-hint`,
            errors.url && `${id}-url-error`,
          )}
          className={input}
        />
        {hints.url && <AutoFilledHint id={`${id}-url-hint`} />}
        {errors.url && (
          <p id={`${id}-url-error`} className={errorText}>
            {errors.url}
          </p>
        )}
      </div>
      <div className={field}>
        <label htmlFor={`${id}-company`} className="text-sm font-medium">
          Company
        </label>
        <input
          ref={companyRef}
          id={`${id}-company`}
          name="company"
          type="text"
          autoComplete="off"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          aria-invalid={errors.company ? true : undefined}
          aria-describedby={errors.company ? `${id}-company-error` : undefined}
          className={input}
        />
        {errors.company && (
          <p id={`${id}-company-error`} className={errorText}>
            {errors.company}
          </p>
        )}
      </div>
      <div className={field}>
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Job title <span className="font-normal text-slate-600">(optional)</span>
        </label>
        <input
          id={`${id}-title`}
          name="title"
          type="text"
          autoComplete="off"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-describedby={hints.title ? `${id}-title-hint` : undefined}
          className={input}
        />
        {hints.title && <AutoFilledHint id={`${id}-title-hint`} />}
      </div>
      {saveError && (
        <p role="alert" className={errorText}>
          {saveError}
        </p>
      )}
      <button
        type="submit"
        aria-disabled={isSaving || undefined}
        className="self-start rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </form>
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
