import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type Ref } from 'react';
import { formatTimestampDate } from '@/lib/dates';
import {
  addResume,
  defaultResumeName,
  formatLabel,
  listResumes,
  RESUME_ACCEPT,
  ResumeValidationError,
  type ResumeErrors,
} from '@/lib/resumes';
import type { Resume } from '@/lib/types';

const UPLOAD = '__upload__';

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
  /** Edit: the stored link, kept selectable even if archived or gone. */
  linked?: { resumeId: string; snapshot?: string };
  error?: string;
  selectRef?: Ref<HTMLSelectElement>;
}

/**
 * The form's Resume field (spec §4.2, §4.6): active resumes newest first, then "Upload new…",
 * which opens a compact upload that saves the resume and selects it. Optional: with none picked,
 * a gentle tip shows, and saving still works.
 */
export function ResumeField({ id, value, onChange, linked, error, selectRef }: Props) {
  const resumes = useLiveQuery(() => listResumes(), []);
  const [uploading, setUploading] = useState(false);
  const active = (resumes ?? []).filter((resume) => !resume.archived);
  const labels = resumeOptionLabels(active);
  const linkedResume = linked && resumes?.find((resume) => resume.id === linked.resumeId);
  // The stored link isn't offered as an active resume: it's archived, or its file is gone.
  const linkedExtra =
    linked && !active.some((resume) => resume.id === linked.resumeId)
      ? linkedResume
        ? `${linkedResume.name} (archived)`
        : `${linked.snapshot ?? 'Resume'} (file not available)`
      : undefined;

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Resume <span className="font-normal text-slate-600">(optional)</span>
      </label>
      <select
        ref={selectRef}
        id={id}
        name="resumeId"
        value={value}
        onChange={(event) => {
          if (event.target.value === UPLOAD) setUploading(true);
          else onChange(event.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [!value && hintId, error && errorId].filter(Boolean).join(' ') || undefined
        }
        className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700"
      >
        <option value="">No resume</option>
        {linkedExtra && <option value={linked!.resumeId}>{linkedExtra}</option>}
        {active.map((resume) => (
          <option key={resume.id} value={resume.id}>
            {labels.get(resume.id)}
          </option>
        ))}
        <option value={UPLOAD}>Upload new…</option>
      </select>
      {!value && (
        <p id={hintId} className="text-xs text-slate-600">
          Tip: pick the resume you sent, so you can find it later.
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      )}
      {uploading && (
        <InlineUpload
          onDone={(resume) => {
            setUploading(false);
            if (resume) onChange(resume.id);
          }}
        />
      )}
    </div>
  );
}

/** "Upload new…": pick a file and name it, then it's saved and selected. */
function InlineUpload({ onDone }: { onDone: (resume?: Resume) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<ResumeErrors>({});
  const [saving, setSaving] = useState(false);

  async function upload() {
    if (saving) return;
    if (!file) {
      setErrors({ file: 'Choose a file to upload.' });
      fileInput.current?.focus();
      return;
    }
    setSaving(true);
    try {
      onDone(await addResume(file, { name }));
    } catch (failure) {
      if (failure instanceof ResumeValidationError) setErrors(failure.fields);
      else {
        console.error('addResume failed', failure);
        setErrors({ file: "Couldn't save this file. Please try again." });
      }
      setSaving(false);
    }
  }

  // Not a <form>: it sits inside the application form, and forms can't nest.
  return (
    <div
      role="group"
      aria-label="Upload a new resume"
      aria-busy={saving || undefined}
      className="flex min-w-0 flex-col gap-2 rounded border border-slate-200 p-2"
    >
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
        Resume file
        <input
          ref={fileInput}
          type="file"
          accept={RESUME_ACCEPT}
          // Focus lands here first: the user just chose "Upload new…".
          autoFocus
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            setFile(picked);
            setErrors({});
            if (picked && !name.trim()) setName(defaultResumeName(picked.name));
          }}
          aria-invalid={errors.file ? true : undefined}
          className="w-full min-w-0 text-sm font-normal"
        />
      </label>
      {errors.file && <p className="text-xs text-red-700">{errors.file}</p>}
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
        Name
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={errors.name ? true : undefined}
          className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-sm font-normal focus:outline-2 focus:outline-indigo-600"
        />
      </label>
      {errors.name && <p className="text-xs text-red-700">{errors.name}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void upload()}
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          {saving ? 'Uploading…' : 'Upload and use'}
        </button>
        <button
          type="button"
          onClick={() => onDone()}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
        >
          {/* Not just "Cancel": the form's own Cancel is on screen too. */}
          Cancel upload
        </button>
      </div>
    </div>
  );
}
