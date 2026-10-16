import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { listApplications, safeHref } from '@/lib/applications';
import { formatLocalDate } from '@/lib/dates';
import { DEFAULT_QUERY, queryApplications, rankOf, type ListQuery } from '@/lib/listQuery';
import type { Application } from '@/lib/types';
import { ListControls } from './ListControls';
import { StatusChip, type StatusPick } from './StatusChip';

interface Props {
  /** Search, filter and sort; kept by App so they survive opening a job and coming back. */
  query: ListQuery;
  onQueryChange: (query: ListQuery) => void;
  onOpen: (id: string) => void;
  onStatusPick: (application: Application, pick: StatusPick) => void;
  /** Focus this row once the list has loaded (focus returning from its detail view). */
  focusRowId?: string;
  onRowFocused?: () => void;
  /** The row is about to appear (just restored): keep waiting for it while it's missing. */
  awaitRow?: boolean;
  /** The requested row isn't in the list any more (deleted meanwhile). */
  onRowMissing?: () => void;
}

export function ApplicationList({
  query,
  onQueryChange,
  onOpen,
  onStatusPick,
  focusRowId,
  onRowFocused,
  awaitRow,
  onRowMissing,
}: Props) {
  const applications = useLiveQuery(() => listApplications(), []);
  // While the list is on screen, a status change (which bumps `updatedAt`, and may stop the row
  // matching a status filter) mustn't move or hide the row under the pointer. Order and
  // membership are frozen per query; they refresh when the query changes or the list is shown
  // again. New rows still appear, at the top.
  const queryKey = JSON.stringify(query);
  const [frozen, setFrozen] = useState<{
    queryKey: string;
    ranks: Map<string, number>;
    shown: Set<string>;
  }>();
  if (applications && frozen?.queryKey !== queryKey) {
    const fresh = queryApplications(applications, query);
    setFrozen({ queryKey, ranks: rankOf(fresh), shown: new Set(fresh.map((app) => app.id)) });
  }
  const current = frozen?.queryKey === queryKey ? frozen : undefined;
  const visible = useMemo(
    () => applications && queryApplications(applications, query, current?.ranks, current?.shown),
    [applications, query, current],
  );
  const search = useRef<HTMLInputElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());

  // The request is cleared by the parent once handled, so a remount never replays it.
  // Re-runs as the live list changes, so an awaited row is focused as soon as it shows up.
  useLayoutEffect(() => {
    if (!applications || !focusRowId) return;
    const row = rowButtons.current.get(focusRowId);
    if (row) {
      row.focus();
      onRowFocused?.();
    } else if (!awaitRow || applications.some((app) => app.id === focusRowId)) {
      // Gone, or present but hidden by the search or filter: don't wait for it.
      onRowMissing?.();
    }
  }, [applications, focusRowId, awaitRow, onRowFocused, onRowMissing]);

  if (!applications || !visible) return null;
  if (applications.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No applications yet. Tap + Add application, or right-click any job posting and choose Add
        job to Job Log.
      </p>
    );
  }

  const filtered = visible.length !== applications.length;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ListControls query={query} onChange={onQueryChange} searchRef={search} />
      {filtered && (
        <p className="text-xs text-slate-600">
          Showing {visible.length} of {applications.length}
        </p>
      )}
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-slate-600">No applications match.</p>
          <button
            type="button"
            onClick={() => {
              onQueryChange({ ...DEFAULT_QUERY, sort: query.sort });
              // This button disappears with the empty state; keep focus in the controls.
              search.current?.focus();
            }}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600"
          >
            Clear search and filter
          </button>
        </div>
      ) : (
        <ul aria-label="Applications" className="flex flex-col divide-y divide-slate-200">
          {visible.map((app) => (
            <li key={app.id} className="flex min-w-0 flex-col gap-0.5 py-2">
              {/* The chip sits beside the row button, never inside it (no nested controls). */}
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  ref={(element) => {
                    if (element) rowButtons.current.set(app.id, element);
                    else rowButtons.current.delete(app.id);
                  }}
                  onClick={() => onOpen(app.id)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 rounded text-left hover:bg-slate-50 focus:outline-2 focus:outline-indigo-600"
                >
                  <span className="text-sm font-medium break-words">{app.company}</span>
                  {app.title && (
                    <span className="text-sm break-words text-slate-700">{app.title}</span>
                  )}
                  {(app.location || app.workMode) && (
                    <span className="text-xs break-words text-slate-600">
                      {[app.location, app.workMode && WORK_MODE_LABELS[app.workMode]]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </button>
                <StatusChip application={app} onPick={(pick) => onStatusPick(app, pick)} />
              </div>
              {/* A small icon link, not the full URL, which would wrap over lines at 320px. */}
              <div className="flex items-center gap-2 text-xs text-slate-600">
                {app.appliedAt && <span>Applied {formatLocalDate(app.appliedAt)}</span>}
                {safeHref(app.url) && (
                  <a
                    href={safeHref(app.url)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open job posting for ${app.company}`}
                    title="Open job posting"
                    className="inline-flex rounded p-0.5 text-indigo-700 hover:bg-slate-100 focus:outline-2 focus:outline-indigo-600"
                  >
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </svg>
  );
}
