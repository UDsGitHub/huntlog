import { useId, useRef, useState, type FormEvent } from 'react';
import { addApplication, validateNewApplication, type FieldErrors } from '@/lib/applications';

export function AddApplicationForm() {
  const id = useId();
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const result = validateNewApplication({ url, company });
    setErrors(result.errors);
    setSaveError(null);
    if (!result.values) {
      (result.errors.url ? urlRef : companyRef).current?.focus();
      return;
    }
    const submitted = { url, company };
    saving.current = true;
    setIsSaving(true);
    try {
      await addApplication(result.values);
      // Only clear what is unchanged: the user may already be typing the next job.
      setUrl((current) => (current === submitted.url ? '' : current));
      setCompany((current) => (current === submitted.company ? '' : current));
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
          aria-describedby={errors.url ? `${id}-url-error` : undefined}
          className={input}
        />
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
