import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Combobox } from './Combobox';
import { PlusIcon } from './icons';
import { ResumeUpload } from './ResumeUpload';
import { formatTimestampDate } from '@/lib/dates';
import { formatLabel, listResumes } from '@/lib/resumes';
import type { Resume } from '@/lib/types';

/**
 * What each resume is called in the picker: its name, plus format and upload date when another
 * offered resume shares the name ("Backend v3 · PDF · Oct 2" vs "Backend v3 · DOCX · Oct 5").
 */
export function resumeOptionLabels(resumes: Resume[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const resume of resumes) count.set(resume.name, (count.get(resume.name) ?? 0) + 1);
  return new Map(
    resumes.map((resume) => [
      resume.id,
      (count.get(resume.name) ?? 0) > 1
        ? `${resume.name} · ${formatLabel(resume.fileName)} · ${formatTimestampDate(resume.createdAt)}`
        : resume.name,
    ]),
  );
}

interface Props {
  id: string;
  value: string;
  onChange: (resumeId: string) => void;
  /** Edit: the stored link and its snapshot name, shown if that resume is gone. */
  linked?: { resumeId: string; snapshot?: string };
  error?: string;
  /** Receives the field, e.g. so an error can focus it. */
  inputRef?: (element: HTMLInputElement | null) => void;
}

/**
 * The form's Resume field (spec §4.2, §4.6): a searchable dropdown of "No resume" and the active
 * resumes, newest first, and a + button beside it that opens a compact upload, saves the resume
 * and picks it. Optional: with none picked a gentle tip shows, and saving still works.
 */
export function ResumeField({ id, value, onChange, linked, error, inputRef }: Props) {
  const resumes = useLiveQuery(() => listResumes(), []);
  const [uploading, setUploading] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  // The resume just uploaded here: on offer at once, before the live list catches up, so the
  // field never shows blank while it's picked.
  const [uploaded, setUploaded] = useState<Resume>();
  const listed = resumes ?? [];
  const active = [
    ...(uploaded && !listed.some((resume) => resume.id === uploaded.id) ? [uploaded] : []),
    ...listed.filter((resume) => !resume.archived),
  ];
  const labels = resumeOptionLabels(active);
  // The selected resume isn't on offer: archived (or archived meanwhile in another window), or
  // gone. Keep it as an option, so the select shows what's really chosen.
  const chosenElsewhere =
    value && resumes && !active.some((resume) => resume.id === value)
      ? (() => {
          const resume = resumes.find((r) => r.id === value);
          if (resume) return `${resume.name} (archived)`;
          const snapshot = linked?.resumeId === value ? linked.snapshot : undefined;
          return `${snapshot ?? 'Resume'} (file not available)`;
        })()
      : undefined;

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="field-label">
        Resume <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <div className="flex min-w-0 gap-2">
        <Combobox
          id={id}
          value={value}
          onChange={onChange}
          listLabel="Resumes"
          inputRef={(element) => {
            field.current = element;
            inputRef?.(element);
          }}
          invalid={Boolean(error)}
          describedBy={[!value && hintId, error && errorId].filter(Boolean).join(' ') || undefined}
          options={[
            { value: '', label: 'No resume' },
            ...(chosenElsewhere ? [{ value, label: chosenElsewhere }] : []),
            ...active.map((resume) => ({ value: resume.id, label: labels.get(resume.id)! })),
          ]}
        />
        {/* A button, not an option: moving through the options must never open an upload. */}
        <button
          ref={uploadButton}
          type="button"
          aria-label="Upload new resume"
          title="Upload new resume"
          aria-expanded={uploading}
          onClick={() => setUploading((open) => !open)}
          className="btn btn-outline btn-icon"
        >
          <PlusIcon />
        </button>
      </div>
      {!value && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Tip: pick the resume you sent, so you can find it later.
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      {uploading && (
        <ResumeUpload
          variant="inline"
          onUploaded={(resume) => {
            setUploading(false);
            setUploaded(resume);
            onChange(resume.id);
            field.current?.focus();
          }}
          onCancel={() => {
            setUploading(false);
            uploadButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}
