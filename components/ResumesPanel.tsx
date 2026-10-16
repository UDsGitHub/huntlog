import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { NotFoundError } from '@/lib/applications';
import { formatTimestampDate } from '@/lib/dates';
import { formatBytes } from '@/lib/format';
import { openResume, opensInViewer } from '@/lib/openResume';
import {
  deleteResume,
  formatLabel,
  listResumes,
  purgeDeletedResumeData,
  restoreResume,
  ResumeValidationError,
  setResumeArchived,
  updateResume,
  type ResumeErrors,
} from '@/lib/resumes';
import type { Resume } from '@/lib/types';
import { ResumeUpload } from './ResumeUpload';
import type { ToastData } from './Toast';
import { ChevronRightIcon } from './icons';

interface Props {
  showToast: (toast: Omit<ToastData, 'id'>) => void;
  announce: (message: string) => void;
}

/** The Resumes tab (spec §4.6): upload, list, rename, archive, delete with Undo, open. */
export function ResumesPanel({ showToast, announce }: Props) {
  const resumes = useLiveQuery(() => listResumes(), []);
  const [showArchived, setShowArchived] = useState(false);
  const archivedId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  if (!resumes) return null;
  const active = resumes.filter((resume) => !resume.archived);
  const archived = resumes.filter((resume) => resume.archived);

  // A row's button had focus and the row moved (archived, unarchived) or went (deleted): keep
  // focus in the tab, on its heading.
  const keepFocus = () => heading.current?.focus();

  async function setArchived(resume: Resume, archive: boolean) {
    try {
      await setResumeArchived(resume.id, archive);
      announce(archive ? `Archived ${resume.name}.` : `${resume.name} is back in your resumes.`);
      keepFocus();
    } catch (error) {
      if (!(error instanceof NotFoundError)) console.error('setResumeArchived failed', error);
      announce(`Couldn't change ${resume.name}. It may have been deleted.`);
    }
  }

  async function remove(resume: Resume) {
    try {
      const { outcome, wasArchived } = await deleteResume(resume.id);
      keepFocus();
      if (outcome === 'archived') {
        showToast(
          wasArchived
            ? { message: `${resume.name} is used by applications, so it stays archived.` }
            : {
                message: `${resume.name} is used by applications, so it was archived instead.`,
                action: { label: 'Undo', onAction: () => void setArchived(resume, false) },
              },
        );
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
        // Once Undo can't happen any more, the file goes (spec §4.6).
        onClose: (reason) => {
          if (reason !== 'action') void purgeDeletedResumeData({ id: resume.id, olderThanMs: 0 });
        },
      });
    } catch (error) {
      if (!(error instanceof NotFoundError)) console.error('deleteResume failed', error);
      announce(`Couldn't delete ${resume.name}.`);
    }
  }

  const rowProps = { announce, onDelete: remove, onSetArchived: setArchived };
  return (
    <section aria-labelledby="resumes-heading" className="flex min-w-0 flex-col gap-4">
      <h2
        id="resumes-heading"
        ref={heading}
        tabIndex={-1}
        className="section-heading focus:outline-none"
      >
        Resumes
      </h2>
      <ResumeUpload variant="panel" onUploaded={(resume) => announce(`Uploaded ${resume.name}.`)} />

      {active.length === 0 && archived.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No resumes yet. Upload the versions you send, so you always know which one went with each
          application.
        </p>
      ) : (
        <ul aria-label="Resumes" className="flex flex-col divide-y divide-border">
          {active.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} {...rowProps} />
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
            className="btn btn-outline btn-sm self-start"
          >
            <ChevronRightIcon
              className={`size-4 transition-transform motion-reduce:transition-none ${showArchived ? 'rotate-90' : ''}`}
            />
            Archived ({archived.length})
          </button>
          <ul
            id={archivedId}
            hidden={!showArchived}
            aria-label="Archived resumes"
            className="flex flex-col divide-y divide-border"
          >
            {archived.map((resume) => (
              <ResumeRow key={resume.id} resume={resume} {...rowProps} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ResumeRow({
  resume,
  announce,
  onDelete,
  onSetArchived,
}: {
  resume: Resume;
  announce: (message: string) => void;
  onDelete: (resume: Resume) => Promise<void>;
  onSetArchived: (resume: Resume, archive: boolean) => Promise<void>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<ResumeErrors>({});
  const renameButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  // Where focus goes once the rename form opens or closes (the target isn't rendered yet).
  const [focusAfter, setFocusAfter] = useState<'name' | 'rename' | null>(null);
  useLayoutEffect(() => {
    if (focusAfter === 'name') nameInput.current?.focus();
    if (focusAfter === 'rename') renameButton.current?.focus();
  }, [focusAfter, editing]);

  function startEditing() {
    // Seed from what's stored now, not what was there when the row mounted.
    setName(resume.name);
    setNote(resume.note ?? '');
    setErrors({});
    setEditing(true);
    setFocusAfter('name');
  }

  function stopEditing() {
    setEditing(false);
    setFocusAfter('rename');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await updateResume(resume.id, { name, note });
      announce('Saved.');
      stopEditing();
    } catch (error) {
      if (error instanceof ResumeValidationError) setErrors(error.fields);
      else {
        if (!(error instanceof NotFoundError)) console.error('updateResume failed', error);
        setErrors({ name: "Couldn't save. Please try again." });
      }
    }
  }

  async function open() {
    if (!(await openResume(resume))) announce(`${resume.name} isn't available any more.`);
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
            ref={nameInput}
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
            className="field"
          />
          {errors.name && (
            <p id={`${id}-name-error`} className="field-error">
              {errors.name}
            </p>
          )}
          <label htmlFor={`${id}-note`} className="text-xs font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id={`${id}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? `${id}-note-error` : undefined}
            className="field"
          />
          {errors.note && (
            <p id={`${id}-note-error`} className="field-error">
              {errors.note}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-outline btn-sm">
              Save
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={stopEditing}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className="text-sm font-medium break-words">{resume.name}</span>
          <span className="text-xs text-muted-foreground">{details}</span>
          {resume.note && (
            <span className="text-xs break-words text-muted-foreground">{resume.note}</span>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void open()}>
              {opensInViewer(resume) ? 'Open' : 'Download'}
              <span className="sr-only"> {resume.name}</span>
            </button>
            <button
              ref={renameButton}
              type="button"
              className="btn btn-outline btn-sm"
              onClick={startEditing}
            >
              Rename<span className="sr-only"> {resume.name}</span>
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void onSetArchived(resume, !resume.archived)}
            >
              {resume.archived ? 'Unarchive' : 'Archive'}
              <span className="sr-only"> {resume.name}</span>
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void onDelete(resume)}
            >
              Delete<span className="sr-only"> {resume.name}</span>
            </button>
          </div>
        </>
      )}
    </li>
  );
}
