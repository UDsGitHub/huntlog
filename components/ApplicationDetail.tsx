import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { getApplication, NotFoundError, safeHref, softDeleteApplication } from '@/lib/applications';
import { formatLocalDate, formatTimestampDate } from '@/lib/dates';
import { formatSalary } from '@/lib/format';
import { ArrowLeftIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from './icons';
import { MoreMenu } from './MoreMenu';
import { toUnicodeHost } from '@/lib/punycode';
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

/**
 * A posting's site, for its button: the host without "www." (e.g. boards.greenhouse.io), with an
 * international domain shown as written, not in its xn-- form.
 */
export function postingSite(href: string): string {
  try {
    return toUnicodeHost(new URL(href).hostname.replace(/^www\./, ''));
  } catch {
    return href;
  }
}

/**
 * The detail view (spec §4.3): a page that slides in from the right. Its header has Back, the
 * company, Edit (a pencil) and a ⋯ menu with Delete, so Delete is never one mis-tap away. The
 * posting opens from a full-width button naming its site.
 */
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
  // Slides in when it opens over the list; coming back from Edit, it's simply there again.
  const slide = initialFocus === 'heading' ? 'page page-slide-in' : 'page';

  useLayoutEffect(() => {
    if (!loaded) return;
    // Fall back to the heading when there's no Edit button (the row is gone).
    (initialFocus === 'edit' && editButton.current ? editButton : heading).current?.focus();
  }, [loaded, initialFocus]);

  const back = (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to applications"
      className="btn btn-ghost btn-icon -ml-2 shrink-0"
    >
      <ArrowLeftIcon />
    </button>
  );

  if (app === undefined) return null;
  if (app === null) {
    return (
      <section aria-labelledby="detail-heading" className={`${slide} flex flex-col gap-3`}>
        <div className="flex items-center gap-1">
          {back}
          <h2 id="detail-heading" ref={heading} tabIndex={-1} className="section-heading">
            This application isn't available
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">It may have been deleted in another window.</p>
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
    <section aria-labelledby="detail-heading" className={`${slide} flex min-w-0 flex-col gap-4`}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          {back}
          <h2
            id="detail-heading"
            ref={heading}
            tabIndex={-1}
            className="section-heading min-w-0 flex-1 break-words focus:outline-none"
          >
            {app.company}
          </h2>
          <button
            ref={editButton}
            type="button"
            onClick={onEdit}
            aria-label="Edit"
            title="Edit"
            className="btn btn-ghost btn-icon shrink-0"
          >
            <PencilIcon />
          </button>
          <MoreMenu
            label={`More actions for ${app.company}`}
            items={[
              {
                label: 'Delete',
                icon: <Trash2Icon />,
                destructive: true,
                onSelect: () => void handleDelete(),
              },
            ]}
          />
        </div>
        {app.title && <p className="text-sm break-words text-muted-foreground">{app.title}</p>}
      </div>

      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open job posting on ${postingSite(href)}`}
          className="btn btn-outline w-full justify-between"
        >
          <span className="min-w-0 truncate">{postingSite(href)}</span>
          <ExternalLinkIcon />
        </a>
      ) : (
        <span className="text-xs break-all text-muted-foreground">{app.url}</span>
      )}

      {deleteError && (
        <p role="alert" className="field-error">
          {deleteError}
        </p>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
        <Row label="Status">
          <StatusChip application={app} onPick={(pick) => onStatusPick(app, pick)} />
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
          <h3 className="text-sm font-semibold">Notes</h3>
          {/* Plain text: line breaks kept, nothing rendered as markup (spec §5). */}
          <p className="text-sm break-words whitespace-pre-wrap text-foreground">{app.notes}</p>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
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
        onClick={() =>
          void openResume(resume).then(
            (opened) => setFailed(!opened),
            (error: unknown) => {
              console.error('openResume failed', error);
              setFailed(true);
            },
          )
        }
        className="btn btn-outline btn-sm py-0.5"
      >
        {opensInViewer(resume) ? 'Open' : 'Download'}
        <span className="sr-only"> resume {resume.name}</span>
      </button>
      {failed && <span className="text-xs text-muted-foreground">The file isn't available.</span>}
    </span>
  );
}
