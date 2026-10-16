import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  addResume,
  defaultResumeName,
  RESUME_ACCEPT,
  ResumeValidationError,
  type ResumeErrors,
} from '@/lib/resumes';
import type { Resume } from '@/lib/types';

const input =
  'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';

interface Props {
  /**
   * `panel`: the Resumes tab's own form, with a note, resetting after each upload.
   * `inline`: inside the application form (forms can't nest, so it's a group), opened from its
   * "Upload new…" button: Enter uploads here rather than submitting the application.
   */
  variant: 'panel' | 'inline';
  onUploaded: (resume: Resume) => void;
  onCancel?: () => void;
}

/**
 * Uploading a resume: a file, a name suggested from the file (it follows the file picked until
 * a name is typed), and in the Resumes tab an optional note. Errors are linked to their fields
 * and the first invalid one takes focus. One component for both places, so they can't drift.
 */
export function ResumeUpload({ variant, onUploaded, onCancel }: Props) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [nameTyped, setNameTyped] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<ResumeErrors>({});
  const [saving, setSaving] = useState(false);
  // Focus the first invalid field once its error has rendered (a ref, used once).
  const pendingFocus = useRef<keyof ResumeErrors | null>(null);
  useLayoutEffect(() => {
    const field = pendingFocus.current;
    if (!field) return;
    pendingFocus.current = null;
    ({ file: fileInput, name: nameInput, note: noteInput })[field].current?.focus();
  }, [errors]);

  // The inline upload opens from an explicit "Upload new…" press: start at the file.
  useLayoutEffect(() => {
    if (variant === 'inline') fileInput.current?.focus();
  }, [variant]);

  function fail(fields: ResumeErrors) {
    pendingFocus.current =
      (['file', 'name', 'note'] as const).find((field) => fields[field]) ?? null;
    setErrors(fields);
  }

  async function upload() {
    if (saving) return;
    if (!file) return fail({ file: 'Choose a file to upload.' });
    setSaving(true);
    try {
      const resume = await addResume(file, variant === 'panel' ? { name, note } : { name });
      setSaving(false);
      if (variant === 'panel') {
        setFile(null);
        setName('');
        setNameTyped(false);
        setNote('');
        setErrors({});
        if (fileInput.current) fileInput.current.value = '';
      }
      onUploaded(resume);
    } catch (error) {
      setSaving(false);
      if (error instanceof ResumeValidationError) fail(error.fields);
      else {
        console.error('addResume failed', error);
        fail({ file: "Couldn't save this file. Please try again." });
      }
    }
  }

  const described = (field: keyof ResumeErrors, hint?: string) => {
    const ids = [hint, errors[field] && `${id}-${field}-error`].filter(Boolean).join(' ');
    return {
      'aria-invalid': errors[field] ? (true as const) : undefined,
      'aria-describedby': ids || undefined,
    };
  };
  const errorText = (field: keyof ResumeErrors) =>
    errors[field] && (
      <p id={`${id}-${field}-error`} className="text-xs text-red-700">
        {errors[field]}
      </p>
    );

  const fields = (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-file`} className="text-sm font-medium">
          Resume file
        </label>
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept={RESUME_ACCEPT}
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            setFile(picked);
            setErrors({});
            if (picked && !nameTyped) setName(defaultResumeName(picked.name));
          }}
          className="w-full min-w-0 text-sm"
          {...described('file', `${id}-file-hint`)}
        />
        <p id={`${id}-file-hint`} className="text-xs text-slate-600">
          PDF, DOCX, DOC, TXT or RTF, up to 10 MB.
        </p>
        {errorText('file')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <input
          ref={nameInput}
          id={`${id}-name`}
          type="text"
          autoComplete="off"
          placeholder="e.g. Backend v3"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            // Clearing the name hands it back to the suggestion.
            setNameTyped(event.target.value.trim() !== '');
          }}
          className={input}
          {...described('name')}
        />
        {errorText('name')}
      </div>
      {variant === 'panel' && (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-note`} className="text-sm font-medium">
            Note <span className="font-normal text-slate-600">(optional)</span>
          </label>
          <input
            ref={noteInput}
            id={`${id}-note`}
            type="text"
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={input}
            {...described('note')}
          />
          {errorText('note')}
        </div>
      )}
    </>
  );

  const primary =
    'rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600';

  if (variant === 'panel') {
    return (
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void upload();
        }}
        noValidate
        aria-label="Upload a resume"
        aria-busy={saving || undefined}
        className="flex min-w-0 flex-col gap-2 rounded border border-slate-200 p-3"
      >
        {fields}
        <button
          type="submit"
          aria-disabled={saving || undefined}
          className={`${primary} self-start`}
        >
          {saving ? 'Uploading…' : 'Upload'}
        </button>
      </form>
    );
  }

  return (
    <div
      role="group"
      aria-label="Upload a new resume"
      aria-busy={saving || undefined}
      // Enter here uploads; it must not submit the application form around it.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault();
          void upload();
        }
      }}
      className="flex min-w-0 flex-col gap-2 rounded border border-slate-200 p-2"
    >
      {fields}
      <div className="flex gap-2">
        <button type="button" onClick={() => void upload()} className={primary}>
          {saving ? 'Uploading…' : 'Upload and use'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          {/* Not just "Cancel": the application form's own Cancel is on screen too. */}
          Cancel upload
        </button>
      </div>
    </div>
  );
}
