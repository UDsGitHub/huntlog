import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useRef, useState, type FormEvent } from 'react';
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
  searchResumes,
  setResumeArchived,
  updateResume,
  type ResumeErrors,
} from '@/lib/resumes';
import type { Resume } from '@/lib/types';
import { MoreMenu } from './MoreMenu';
import { ResumeUpload } from './ResumeUpload';
import { Sheet } from './Sheet';
import type { ToastData } from './Toast';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from './icons';
import { inert } from './inert';
import { useCollapsing } from './useCollapsing';

interface Props {
  showToast: (toast: Omit<ToastData, 'id'>) => void;
  announce: (message: string) => void;
  /** The Resumes tab is selected. Its sheets close when it isn't (e.g. a capture switched tabs). */
  active: boolean;
  /** The upload sheet is asked for (the floating + Upload, outside this section, opens it). */
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}

/**
 * The Resumes tab (spec §4.6): search, the list (tap a row to open or download it, ⋯ for
 * Rename, Archive and Delete with Undo), the Archived accordion, and the upload sheet.
 */
export function ResumesPanel({
  showToast,
  announce,
  active,
  uploadOpen,
  onUploadOpenChange,
}: Props) {
  const resumes = useLiveQuery(() => listResumes(), []);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const archivedClosing = useCollapsing(showArchived);
  // The resume being renamed: kept while its sheet slides out.
  const [renaming, setRenaming] = useState<Resume | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Leaving the tab (a capture) closes the rename sheet, and forgets it, so coming back doesn't
  // reopen it. (App forgets the upload sheet the same way.)
  if (!active && renameOpen) setRenameOpen(false);
  if (!resumes) return null;
  const found = searchResumes(resumes, search);
  const activeFound = found.filter((resume) => !resume.archived);
  const archived = found.filter((resume) => resume.archived);

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

  const rowProps = {
    announce,
    onDelete: remove,
    onSetArchived: setArchived,
    onRename: (resume: Resume) => {
      setRenaming(resume);
      setRenameOpen(true);
    },
  };
  const uploadSheet = (
    <UploadSheet
      open={uploadOpen && active}
      onClose={() => onUploadOpenChange(false)}
      onUploaded={(resume) => {
        announce(`Uploaded ${resume.name}.`);
        onUploadOpenChange(false);
      }}
    />
  );

  if (resumes.length === 0) {
    // Spec §4.6: an empty tab also offers a full-size button, not just the floating one.
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
        <div className="flex flex-col items-stretch gap-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No resumes yet. Upload the versions you send, so you always know which one went with
            each application.
          </p>
          <button
            type="button"
            onClick={() => onUploadOpenChange(true)}
            className="btn btn-primary"
          >
            <PlusIcon />
            Upload your first resume
          </button>
        </div>
        {uploadSheet}
      </section>
    );
  }

  return (
    // Bottom padding keeps the last row clear of the floating + Upload.
    <section aria-labelledby="resumes-heading" className="flex min-w-0 flex-col gap-3 pb-16">
      <h2
        id="resumes-heading"
        ref={heading}
        tabIndex={-1}
        className="section-heading focus:outline-none"
      >
        Resumes
      </h2>
      <div role="search" aria-label="Find resumes" className="relative min-w-0">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search resumes
        </label>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          placeholder="Search by name or file name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="field pl-8"
        />
      </div>

      {activeFound.length > 0 ? (
        <ul aria-label="Resumes" className="flex flex-col gap-2">
          {activeFound.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} {...rowProps} />
          ))}
        </ul>
      ) : found.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No resumes match.</p>
      ) : (
        archived.length > 0 &&
        search.trim() === '' && (
          <p className="text-sm text-muted-foreground">All your resumes are archived.</p>
        )
      )}

      {archived.length > 0 && (
        // An accordion row, like the form's More details: its list slides open and shut.
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            aria-expanded={showArchived}
            aria-controls={`${id}-archived`}
            onClick={() => setShowArchived((open) => !open)}
            className="focus-ring flex w-full items-center justify-between gap-2 rounded-sm border-t px-1 py-3 text-left text-sm font-medium"
          >
            <span>
              Archived{' '}
              <span className="font-normal text-muted-foreground">({archived.length})</span>
            </span>
            <ChevronDownIcon
              className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${showArchived ? 'rotate-180' : ''}`}
            />
          </button>
          <ul
            id={`${id}-archived`}
            hidden={!showArchived && !archivedClosing}
            {...inert(archivedClosing)}
            data-state={showArchived ? 'open' : 'closing'}
            aria-label="Archived resumes"
            className="details-panel flex flex-col gap-2"
          >
            {archived.map((resume) => (
              <ResumeRow key={resume.id} resume={resume} {...rowProps} />
            ))}
          </ul>
        </div>
      )}

      {uploadSheet}
      {renaming && (
        <RenameSheet
          key={renaming.id}
          resume={renaming}
          open={renameOpen && active}
          onClose={() => setRenameOpen(false)}
          onClosed={() => setRenaming(null)}
          onSaved={() => {
            announce('Saved.');
            setRenameOpen(false);
          }}
        />
      )}
    </section>
  );
}

function ResumeRow({
  resume,
  announce,
  onDelete,
  onSetArchived,
  onRename,
}: {
  resume: Resume;
  announce: (message: string) => void;
  onDelete: (resume: Resume) => Promise<void>;
  onSetArchived: (resume: Resume, archive: boolean) => Promise<void>;
  onRename: (resume: Resume) => void;
}) {
  const id = useId();
  async function open() {
    if (!(await openResume(resume))) announce(`${resume.name} isn't available any more.`);
  }
  const details = `${formatLabel(resume.fileName)} · ${formatBytes(resume.size)} · Uploaded ${formatTimestampDate(resume.createdAt)}`;
  const verb = opensInViewer(resume) ? 'Open' : 'Download';

  return (
    <li className="card flex min-w-0 items-start gap-1 p-1">
      {/* The whole card opens (a PDF) or downloads the file; ⋯ has the rest. */}
      <button
        type="button"
        onClick={() => void open()}
        aria-label={`${verb} ${resume.name}`}
        aria-describedby={`${id}-details${resume.note ? ` ${id}-note` : ''}`}
        className="focus-ring flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 text-left hover:bg-accent/50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileTextIcon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium break-words">{resume.name}</span>
          <span id={`${id}-details`} className="text-xs text-muted-foreground">
            {details}
          </span>
          {resume.note && (
            <span id={`${id}-note`} className="text-xs break-words text-muted-foreground">
              {resume.note}
            </span>
          )}
        </span>
      </button>
      <MoreMenu
        label={`More actions for ${resume.name}`}
        items={[
          {
            label: 'Rename',
            icon: <PencilIcon className="size-4" />,
            onSelect: () => onRename(resume),
          },
          resume.archived
            ? {
                label: 'Unarchive',
                icon: <ArchiveRestoreIcon className="size-4" />,
                onSelect: () => void onSetArchived(resume, false),
              }
            : {
                label: 'Archive',
                icon: <ArchiveIcon className="size-4" />,
                onSelect: () => void onSetArchived(resume, true),
              },
          {
            label: 'Delete',
            icon: <Trash2Icon className="size-4" />,
            destructive: true,
            onSelect: () => void onDelete(resume),
          },
        ]}
      />
    </li>
  );
}

/** Upload in a sheet (spec §4.6): a stray click outside can't lose a picked file. */
function UploadSheet({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (resume: Resume) => void;
}) {
  const formId = useId();
  const [state, setState] = useState({ dirty: false, saving: false });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      onClosed={() => setState({ dirty: false, saving: false })}
      title="Upload a resume"
      dirty={state.dirty}
      footer={
        <button
          type="submit"
          form={formId}
          aria-disabled={state.saving || undefined}
          className="btn btn-primary w-full"
        >
          {state.saving ? 'Uploading…' : 'Upload'}
        </button>
      }
    >
      <ResumeUpload
        variant="sheet"
        formId={formId}
        onStateChange={setState}
        onUploaded={onUploaded}
      />
    </Sheet>
  );
}

/** Rename a resume and edit its note, in a sheet (spec §4.6). Seeded once, when it opens. */
function RenameSheet({
  resume,
  open,
  onClose,
  onClosed,
  onSaved,
}: {
  resume: Resume;
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(resume.name);
  const [note, setNote] = useState(resume.note ?? '');
  const [errors, setErrors] = useState<ResumeErrors>({});
  const [saving, setSaving] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const dirty = name !== resume.name || note !== (resume.note ?? '');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateResume(resume.id, { name, note });
      onSaved();
    } catch (error) {
      if (error instanceof ResumeValidationError) {
        setErrors(error.fields);
        (error.fields.name ? nameInput : noteInput).current?.focus();
      } else {
        if (!(error instanceof NotFoundError)) console.error('updateResume failed', error);
        setErrors({ name: "Couldn't save. It may have been deleted." });
        nameInput.current?.focus();
      }
    } finally {
      setSaving(false);
    }
  }

  const field = (key: 'name' | 'note') => ({
    id: `${id}-${key}`,
    'aria-invalid': errors[key] ? (true as const) : undefined,
    'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined,
    className: 'field',
    type: 'text',
    autoComplete: 'off',
  });
  const error = (key: 'name' | 'note') =>
    errors[key] && (
      <p id={`${id}-${key}-error`} className="field-error">
        {errors[key]}
      </p>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onClosed={onClosed}
      title="Rename resume"
      dirty={dirty}
      initialFocus={nameInput}
      footer={
        <button
          type="submit"
          form={`${id}-form`}
          aria-disabled={saving || undefined}
          className="btn btn-primary w-full"
        >
          Save
        </button>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => void save(event)}
        noValidate
        aria-label={`Rename ${resume.name}`}
        className="flex min-w-0 flex-col gap-3"
      >
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-name`} className="field-label">
            Name
          </label>
          <input
            ref={nameInput}
            {...field('name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {error('name')}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-note`} className="field-label">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            ref={noteInput}
            {...field('note')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error('note')}
        </div>
      </form>
    </Sheet>
  );
}
