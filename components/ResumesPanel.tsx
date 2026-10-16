import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useRef, useState, type FormEvent } from 'react';
import { NotFoundError } from '@/lib/applications';
import { formatTimestampDate } from '@/lib/dates';
import { formatBytes } from '@/lib/format';
import { openResume } from '@/lib/openResume';
import {
  addResume,
  defaultResumeName,
  deleteResume,
  formatLabel,
  listResumes,
  purgeDeletedResumeData,
  restoreResume,
  RESUME_ACCEPT,
  ResumeValidationError,
  setResumeArchived,
  updateResume,
  type ResumeErrors,
} from '@/lib/resumes';
import type { Resume } from '@/lib/types';
import type { ToastData } from './Toast';

interface Props {
  showToast: (toast: Omit<ToastData, 'id'>) => void;
  announce: (message: string) => void;
}

const input =
  'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';
const button =
  'rounded border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600';

/** The Resumes tab (spec §4.6): upload, list, rename, archive, delete with Undo, open. */
export function ResumesPanel({ showToast, announce }: Props) {
  const resumes = useLiveQuery(() => listResumes(), []);
  const [showArchived, setShowArchived] = useState(false);
  const archivedId = useId();
  if (!resumes) return null;
  const active = resumes.filter((resume) => !resume.archived);
  const archived = resumes.filter((resume) => resume.archived);

  async function remove(resume: Resume) {
    try {
      const { outcome } = await deleteResume(resume.id);
      if (outcome === 'archived') {
        showToast({
          message: `${resume.name} is used by applications, so it was archived instead.`,
          action: { label: 'Undo', onAction: () => void setResumeArchived(resume.id, false) },
        });
        return;
      }
      showToast({
        message: `Deleted ${resume.name}.`,
        action: {
          label: 'Undo',
          onAction: () =>
            restoreResume(resume.id).then(
              () => announce(`Restored ${resume.name}.`),
              () => announce(`Couldn't restore ${resume.name}.`),
            ),
        },
        // Once Undo can't happen any more, the file's bytes go (spec §4.6).
        onClose: (reason) => {
          if (reason !== 'action') void purgeDeletedResumeData({ id: resume.id, olderThanMs: 0 });
        },
      });
    } catch (error) {
      if (!(error instanceof NotFoundError)) console.error('deleteResume failed', error);
      announce(`Couldn't delete ${resume.name}.`);
    }
  }

  return (
    <section aria-labelledby="resumes-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="resumes-heading" className="text-base font-semibold">
        Resumes
      </h2>
      <UploadForm announce={announce} />

      {active.length === 0 && archived.length === 0 ? (
        <p className="text-sm text-slate-600">
          No resumes yet. Upload the versions you send, so you always know which one went with each
          application.
        </p>
      ) : (
        <ul aria-label="Resumes" className="flex flex-col divide-y divide-slate-200">
          {active.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} announce={announce} onDelete={remove} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showArchived}
            aria-controls={archivedId}
            onClick={() => setShowArchived((open) => !open)}
            className="flex items-center gap-1 self-start rounded text-sm font-medium text-indigo-700 hover:underline focus:outline-2 focus:outline-indigo-600"
          >
            <span aria-hidden="true">{showArchived ? '▾' : '▸'}</span>
            Archived ({archived.length})
          </button>
          <ul
            id={archivedId}
            hidden={!showArchived}
            aria-label="Archived resumes"
            className="flex flex-col divide-y divide-slate-200"
          >
            {archived.map((resume) => (
              <ResumeRow key={resume.id} resume={resume} announce={announce} onDelete={remove} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Upload: pick a file, name it (defaulting from the file name), optional note. */
function UploadForm({ announce }: { announce: (message: string) => void }) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<ResumeErrors>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!file) {
      setErrors({ file: 'Choose a file to upload.' });
      fileInput.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const resume = await addResume(file, { name, note });
      announce(`Uploaded ${resume.name}.`);
      setFile(null);
      setName('');
      setNote('');
      setErrors({});
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      if (error instanceof ResumeValidationError) {
        setErrors(error.fields);
        if (error.fields.file) fileInput.current?.focus();
      } else {
        console.error('addResume failed', error);
        setErrors({ file: "Couldn't save this file. Please try again." });
      }
    } finally {
      setSaving(false);
    }
  }

  const described = (field: keyof ResumeErrors) =>
    errors[field]
      ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-${field}-error` }
      : {};
  const errorText = (field: keyof ResumeErrors) =>
    errors[field] && (
      <p id={`${id}-${field}-error`} className="text-xs text-red-700">
        {errors[field]}
      </p>
    );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Upload a resume"
      aria-busy={saving || undefined}
      className="flex min-w-0 flex-col gap-2 rounded border border-slate-200 p-3"
    >
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
            // Suggest a name from the file, unless one was typed.
            if (picked && !name.trim()) setName(defaultResumeName(picked.name));
          }}
          className="w-full min-w-0 text-sm"
          {...described('file')}
        />
        <p className="text-xs text-slate-600">PDF, DOCX, DOC, TXT or RTF, up to 10 MB.</p>
        {errorText('file')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="off"
          placeholder="e.g. Backend v3"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={input}
          {...described('name')}
        />
        {errorText('name')}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-note`} className="text-sm font-medium">
          Note <span className="font-normal text-slate-600">(optional)</span>
        </label>
        <input
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
      <button
        type="submit"
        aria-disabled={saving || undefined}
        className="self-start rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
      >
        {saving ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}

function ResumeRow({
  resume,
  announce,
  onDelete,
}: {
  resume: Resume;
  announce: (message: string) => void;
  onDelete: (resume: Resume) => Promise<void>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(resume.name);
  const [note, setNote] = useState(resume.note ?? '');
  const [errors, setErrors] = useState<ResumeErrors>({});
  const renameButton = useRef<HTMLButtonElement>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await updateResume(resume.id, { name, note });
      setEditing(false);
      setErrors({});
      announce('Saved.');
      renameButton.current?.focus();
    } catch (error) {
      if (error instanceof ResumeValidationError) setErrors(error.fields);
      else {
        if (!(error instanceof NotFoundError)) console.error('updateResume failed', error);
        setErrors({ name: "Couldn't save. Please try again." });
      }
    }
  }

  async function open() {
    if (!(await openResume(resume.id))) announce(`${resume.name} isn't available any more.`);
  }

  const details = `${formatLabel(resume.fileName)} · ${formatBytes(resume.size)} · Uploaded ${formatTimestampDate(resume.createdAt)}`;

  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2">
      {editing ? (
        <form
          onSubmit={save}
          noValidate
          aria-label={`Rename ${resume.name}`}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`${id}-name`} className="text-xs font-medium">
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
            className={input}
          />
          {errors.name && (
            <p id={`${id}-name-error`} className="text-xs text-red-700">
              {errors.name}
            </p>
          )}
          <label htmlFor={`${id}-note`} className="text-xs font-medium">
            Note <span className="font-normal text-slate-600">(optional)</span>
          </label>
          <input
            id={`${id}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? `${id}-note-error` : undefined}
            className={input}
          />
          {errors.note && (
            <p id={`${id}-note-error`} className="text-xs text-red-700">
              {errors.note}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={button}>
              Save
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setEditing(false);
                setName(resume.name);
                setNote(resume.note ?? '');
                setErrors({});
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className="text-sm font-medium break-words">{resume.name}</span>
          <span className="text-xs text-slate-600">{details}</span>
          {resume.note && <span className="text-xs break-words text-slate-700">{resume.note}</span>}
        </>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => void open()}>
            {resume.mimeType === 'application/pdf' ? 'Open' : 'Download'}
            <span className="sr-only"> {resume.name}</span>
          </button>
          <button
            ref={renameButton}
            type="button"
            className={button}
            onClick={() => setEditing(true)}
          >
            Rename<span className="sr-only"> {resume.name}</span>
          </button>
          {resume.archived ? (
            <button
              type="button"
              className={button}
              onClick={() =>
                void setResumeArchived(resume.id, false).then(() =>
                  announce(`${resume.name} is back in your resumes.`),
                )
              }
            >
              Unarchive<span className="sr-only"> {resume.name}</span>
            </button>
          ) : (
            <button
              type="button"
              className={button}
              onClick={() =>
                void setResumeArchived(resume.id, true).then(() =>
                  announce(`Archived ${resume.name}.`),
                )
              }
            >
              Archive<span className="sr-only"> {resume.name}</span>
            </button>
          )}
          <button type="button" className={button} onClick={() => void onDelete(resume)}>
            Delete<span className="sr-only"> {resume.name}</span>
          </button>
        </div>
      )}
    </li>
  );
}
