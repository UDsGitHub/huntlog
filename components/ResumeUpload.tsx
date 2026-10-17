import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import { formatBytes } from '@/lib/format';
import {
  addResume,
  defaultResumeName,
  formatLabel,
  RESUME_ACCEPT,
  ResumeValidationError,
  type ResumeErrors,
} from '@/lib/resumes';
import type { Resume } from '@/lib/types';
import { FileIcon, UploadIcon } from './icons';

interface Props {
  /**
   * `sheet`: the Resumes tab's upload sheet, with a note. Its Upload button is in the sheet's
   * footer, joined to this form by `formId`.
   * `inline`: inside the application form (forms can't nest, so it's a group), opened from its
   * "+" button: Enter uploads here rather than submitting the application.
   */
  variant: 'sheet' | 'inline';
  onUploaded: (resume: Resume) => void;
  onCancel?: () => void;
  /** `sheet`: the form's id, for the footer's Upload button (`form=`). */
  formId?: string;
  /** `sheet`: whether anything was picked or typed (to ask before discarding), and saving. */
  onStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}

/**
 * Uploading a resume: a file (picked, or dropped on the drop zone), a name suggested from the
 * file (it follows the file until a name is typed), and in the Resumes tab an optional note.
 * Errors are linked to their fields and the first invalid one takes focus. One component for
 * both places, so they can't drift.
 */
export function ResumeUpload({ variant, onUploaded, onCancel, formId, onStateChange }: Props) {
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
  const [dragging, setDragging] = useState(false);
  // Focus the first invalid field once its error has rendered (a ref, used once).
  const pendingFocus = useRef<keyof ResumeErrors | null>(null);
  useLayoutEffect(() => {
    const field = pendingFocus.current;
    if (!field) return;
    pendingFocus.current = null;
    ({ file: fileInput, name: nameInput, note: noteInput })[field].current?.focus();
  }, [errors]);

  // The inline upload opens from an explicit "+" press: start at the file.
  useLayoutEffect(() => {
    if (variant === 'inline') fileInput.current?.focus();
  }, [variant]);

  const dirty = Boolean(file) || name.trim() !== '' || note.trim() !== '';
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.({ dirty, saving });
  }, [dirty, saving]);

  function fail(fields: ResumeErrors) {
    pendingFocus.current =
      (['file', 'name', 'note'] as const).find((field) => fields[field]) ?? null;
    setErrors(fields);
  }

  function choose(picked: File) {
    setFile(picked);
    setErrors({});
    if (!nameTyped) setName(defaultResumeName(picked.name));
  }

  async function upload() {
    if (saving) return;
    if (!file) return fail({ file: 'Choose a file to upload.' });
    setSaving(true);
    try {
      const resume = await addResume(file, variant === 'sheet' ? { name, note } : { name });
      setSaving(false);
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

  // Only drags that carry files light the zone up (not a text selection).
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  function onDrop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      fail({ file: 'Drop one file at a time.' });
      return;
    }
    // The picker's own value no longer matches: clear it, so picking that file again still counts.
    if (fileInput.current) fileInput.current.value = '';
    choose(files[0]!);
    fileInput.current?.focus();
  }

  const described = (field: keyof ResumeErrors, ...hints: (string | false)[]) => {
    const ids = [...hints, errors[field] && `${id}-${field}-error`].filter(Boolean).join(' ');
    return {
      'aria-invalid': errors[field] ? (true as const) : undefined,
      'aria-describedby': ids || undefined,
    };
  };
  const errorText = (field: keyof ResumeErrors) =>
    errors[field] && (
      <p id={`${id}-${field}-error`} className="field-error">
        {errors[field]}
      </p>
    );

  const fields = (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <span id={`${id}-file-label`} className="field-label">
          Resume file
        </span>
        {/* Visually hidden but focusable: the drop zone below is its label, so a click anywhere
            in it opens the picker, and it shows this input's focus. */}
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept={RESUME_ACCEPT}
          aria-labelledby={`${id}-file-label`}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) choose(picked);
          }}
          className="peer sr-only"
          {...described('file', Boolean(file) && `${id}-file-chosen`, `${id}-file-hint`)}
        />
        <label
          htmlFor={`${id}-file`}
          data-dropzone=""
          onDragEnter={(event) => carriesFiles(event) && setDragging(true)}
          onDragOver={(event) => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={onDrop}
          className={`flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:bg-accent/50 ${
            dragging
              ? 'border-primary bg-accent'
              : errors.file
                ? 'border-destructive'
                : 'border-input'
          }`}
        >
          {file ? (
            <>
              <FileIcon className="size-5 text-muted-foreground" />
              <span id={`${id}-file-chosen`} className="flex min-w-0 flex-col">
                <span className="text-sm font-medium break-all">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatLabel(file.name)} · {formatBytes(file.size)}
                </span>
              </span>
              <span className="text-xs font-medium underline underline-offset-4">Change file</span>
            </>
          ) : (
            <>
              <UploadIcon className="size-5 text-muted-foreground" />
              <span className="text-sm">
                {dragging ? 'Drop it here' : 'Choose a file or drag it here'}
              </span>
              <span aria-hidden="true" className="btn btn-outline btn-sm pointer-events-none">
                Choose file…
              </span>
            </>
          )}
        </label>
        <p id={`${id}-file-hint`} className="text-xs text-muted-foreground">
          PDF, DOCX, DOC, TXT or RTF, up to 10 MB.
        </p>
        {errorText('file')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-name`} className="field-label">
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
          className="field"
          {...described('name')}
        />
        {errorText('name')}
      </div>
      {variant === 'sheet' && (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-note`} className="field-label">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            ref={noteInput}
            id={`${id}-note`}
            type="text"
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="field"
            {...described('note')}
          />
          {errorText('note')}
        </div>
      )}
    </>
  );

  if (variant === 'sheet') {
    return (
      <form
        id={formId}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void upload();
        }}
        noValidate
        aria-label="Upload a resume"
        aria-busy={saving || undefined}
        className="flex min-w-0 flex-col gap-3"
      >
        {fields}
        {/* Enter in a field submits through the form's default button; the visible Upload is
            in the sheet's footer (joined by form=). Last, so the sheet's first control is the file. */}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    );
  }

  return (
    <div
      role="group"
      aria-label="Upload a new resume"
      aria-busy={saving || undefined}
      // Enter in a text field uploads; it must not submit the application form around it. (On
      // the file input, Enter opens the picker.)
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.key === 'Enter' && target instanceof HTMLInputElement && target.type !== 'file') {
          event.preventDefault();
          void upload();
        }
      }}
      className="card flex min-w-0 flex-col gap-2 p-2"
    >
      {fields}
      <div className="flex gap-2">
        <button type="button" onClick={() => void upload()} className="btn btn-primary">
          {saving ? 'Uploading…' : 'Upload and use'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-outline">
          {/* Not just "Cancel": the application form's own Cancel is on screen too. */}
          Cancel upload
        </button>
      </div>
    </div>
  );
}
