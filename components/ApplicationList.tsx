import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useRef, useState } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { listApplications, safeHref } from '@/lib/applications';
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
  // Row order is frozen while the list is on screen, so a status change (which bumps
  // `updatedAt`) doesn't move the row from under the pointer. It refreshes when the sort changes
  // or the list is shown again; new rows appear at the top.
  const [frozen, setFrozen] = useState<{ sort: ListQuery['sort']; ranks: Map<string, number> }>();
  if (applications && frozen?.sort !== query.sort) {
    setFrozen({
      sort: query.sort,
      ranks: rankOf(queryApplications(applications, { ...DEFAULT_QUERY, sort: query.sort })),
    });
  }
  const visible = applications
    ? queryApplications(applications, query, frozen?.sort === query.sort ? frozen.ranks : undefined)
    : undefined;
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());

  // The request is cleared by the parent once handled, so a remount never replays it.
  // Re-runs as the live list changes, so an awaited row is focused as soon as it shows up.
  useLayoutEffect(() => {
    if (!applications || !focusRowId) return;
    const row = rowButtons.current.get(focusRowId);
    if (row) {
      row.focus();
      onRowFocused?.();
    } else if (!awaitRow) {
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
      <ListControls query={query} onChange={onQueryChange} />
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
            onClick={() => onQueryChange({ ...DEFAULT_QUERY, sort: query.sort })}
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
              {safeHref(app.url) ? (
                <a
                  href={safeHref(app.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs break-all text-indigo-700 underline"
                >
                  {app.url}
                </a>
              ) : (
                <span className="text-xs break-all text-slate-600">{app.url}</span>
              )}
              {app.appliedAt && (
                <span className="text-xs text-slate-600">Applied {app.appliedAt}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
