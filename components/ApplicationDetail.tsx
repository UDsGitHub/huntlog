import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { getApplication, NotFoundError, safeHref, softDeleteApplication } from '@/lib/applications';
import { formatLocalDate, formatTimestampDate } from '@/lib/dates';
import { formatSalary } from '@/lib/format';
import { StatusChip, type StatusPick } from './StatusChip';
import { StatusTimeline } from './StatusTimeline';
import { getResume } from '@/lib/resumes';
import { openResume, opensInViewer } from '@/lib/openResume';
import type { Application } from '@/lib/types';

interface Props {
  id: string;
  /** Where focus lands when the view opens: the heading, or Edit when coming back from editing. */
  initialFocus: 'heading' | 'edit';
  onBack: () => void;
  onEdit: () => void;
  onDeleted: (application: Application) => void;
  onStatusPick: (application: Application, pick: StatusPick) => void;
}

const button =
  'rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600';

export function ApplicationDetail({
  id,
  initialFocus,
  onBack,
  onEdit,
  onDeleted,
  onStatusPick,
}: Props) {
  // null: not found or soft-deleted (maybe in another window); undefined: still loading.
  const app = useLiveQuery(async () => (await getApplication(id)) ?? null, [id]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const loaded = app !== undefined;

  useLayoutEffect(() => {
    if (!loaded) return;
    // Fall back to the heading when there's no Edit button (the row is gone).
    (initialFocus === 'edit' && editButton.current ? editButton : heading).current?.focus();
  }, [loaded, initialFocus]);

  const back = (
    <button type="button" onClick={onBack} className={`${button} self-start`}>
      ← Back to applications
    </button>
  );

  if (app === undefined) return null;
  if (app === null) {
    return (
      <section aria-labelledby="detail-heading" className="flex flex-col gap-3">
        {back}
        <h2 id="detail-heading" ref={heading} tabIndex={-1} className="text-base font-semibold">
          This application isn't available
        </h2>
        <p className="text-sm text-slate-700">It may have been deleted in another window.</p>
      </section>
    );
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      onDeleted(await softDeleteApplication(id));
    } catch (error) {
      if (!(error instanceof NotFoundError)) console.error('softDeleteApplication failed', error);
      setDeleteError("Couldn't delete. Please try again.");
    }
  }

  const href = safeHref(app.url);
  const salary = formatSalary(app);

  return (
    <section aria-labelledby="detail-heading" className="flex min-w-0 flex-col gap-3">
      {back}
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2
          id="detail-heading"
          ref={heading}
          tabIndex={-1}
          className="text-base font-semibold break-words focus:outline-none"
        >
          {app.company}
        </h2>
        {app.title && <p className="text-sm break-words text-slate-700">{app.title}</p>}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-sm break-all text-indigo-700 underline"
          >
            Open job posting
          </a>
        ) : (
          <span className="text-xs break-all text-slate-600">{app.url}</span>
        )}
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <Row label="Status">
          <StatusChip application={app} align="start" onPick={(pick) => onStatusPick(app, pick)} />
        </Row>
        {app.appliedAt && <Row label="Date applied">{formatLocalDate(app.appliedAt)}</Row>}
        {app.resumeId && (
          <Row label="Resume">
            <ResumeLink resumeId={app.resumeId} snapshot={app.resumeNameSnapshot} />
          </Row>
        )}
        {app.location && <Row label="Location">{app.location}</Row>}
        {app.workMode && <Row label="Work mode">{WORK_MODE_LABELS[app.workMode]}</Row>}
        {salary && <Row label="Salary">{salary}</Row>}
        {app.source && <Row label="Source">{app.source}</Row>}
        <Row label="Added">{formatTimestampDate(app.createdAt)}</Row>
      </dl>

      <StatusTimeline application={app} />

      {app.notes && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Notes</h3>
          {/* Plain text: line breaks kept, nothing rendered as markup (spec §5). */}
          <p className="text-sm break-words whitespace-pre-wrap text-slate-800">{app.notes}</p>
        </div>
      )}

      {deleteError && (
        <p role="alert" className="text-xs text-red-700">
          {deleteError}
        </p>
      )}
      <div className="flex gap-2">
        <button ref={editButton} type="button" onClick={onEdit} className={button}>
          Edit
        </button>
        <button type="button" onClick={handleDelete} className={button}>
          Delete
        </button>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/**
 * The linked resume's current name with Open (PDF) or Download, or its snapshot name when the
 * resume itself is gone (spec §4.6). Archived resumes still open from here.
 */
function ResumeLink({ resumeId, snapshot }: { resumeId: string; snapshot?: string }) {
  const resume = useLiveQuery(async () => (await getResume(resumeId)) ?? null, [resumeId]);
  const [failed, setFailed] = useState(false);
  if (resume === undefined) return null;
  if (resume === null) {
    return <span>{snapshot ?? 'Resume'} (file not available)</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 break-words">{resume.name}</span>
      <button
        type="button"
        onClick={() => void openResume(resume).then((opened) => setFailed(!opened))}
        className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
      >
        {opensInViewer(resume) ? 'Open' : 'Download'}
        <span className="sr-only"> resume {resume.name}</span>
      </button>
      {failed && <span className="text-xs text-slate-600">The file isn't available.</span>}
    </span>
  );
}
