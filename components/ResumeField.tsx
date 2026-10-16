import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type Ref } from 'react';
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
  selectRef?: Ref<HTMLSelectElement>;
}

/**
 * The form's Resume field (spec §4.2, §4.6): active resumes newest first, and an "Upload new…"
 * button beside it that opens a compact upload, saves the resume and selects it. Optional: with
 * none picked a gentle tip shows, and saving still works.
 */
export function ResumeField({ id, value, onChange, linked, error, selectRef }: Props) {
  const resumes = useLiveQuery(() => listResumes(), []);
  const [uploading, setUploading] = useState(false);
  const select = useRef<HTMLSelectElement | null>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const active = (resumes ?? []).filter((resume) => !resume.archived);
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
        <select
          ref={(element) => {
            select.current = element;
            if (typeof selectRef === 'function') selectRef(element);
          }}
          id={id}
          name="resumeId"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [!value && hintId, error && errorId].filter(Boolean).join(' ') || undefined
          }
          className="field"
        >
          <option value="">No resume</option>
          {chosenElsewhere && <option value={value}>{chosenElsewhere}</option>}
          {active.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {labels.get(resume.id)}
            </option>
          ))}
        </select>
        {/* A button, not a select option: arrowing through options must not open an upload. */}
        <button
          ref={uploadButton}
          type="button"
          aria-expanded={uploading}
          onClick={() => setUploading((open) => !open)}
          className="btn btn-outline"
        >
          Upload new…
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
            onChange(resume.id);
            select.current?.focus();
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
