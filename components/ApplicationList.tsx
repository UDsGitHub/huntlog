import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useRef } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { listApplications, safeHref } from '@/lib/applications';
import type { Application } from '@/lib/types';
import { StatusChip, type StatusPick } from './StatusChip';

interface Props {
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
  onOpen,
  onStatusPick,
  focusRowId,
  onRowFocused,
  awaitRow,
  onRowMissing,
}: Props) {
  const applications = useLiveQuery(() => listApplications(), []);
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

  if (!applications) return null;
  if (applications.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No applications yet. Tap + Add application, or right-click any job posting and choose Add
        job to Job Log.
      </p>
    );
  }

  return (
    <ul aria-label="Applications" className="flex flex-col divide-y divide-slate-200">
      {applications.map((app) => (
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
              {app.title && <span className="text-sm break-words text-slate-700">{app.title}</span>}
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
          {app.appliedAt && <span className="text-xs text-slate-600">Applied {app.appliedAt}</span>}
        </li>
      ))}
    </ul>
  );
}
