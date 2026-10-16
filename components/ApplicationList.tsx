import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useRef } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { listApplications, safeHref } from '@/lib/applications';

export interface FocusRequest {
  /** Increments for each request, so the same row can be focused again. */
  n: number;
  rowId?: string;
}

interface Props {
  onOpen: (id: string) => void;
  /** Focus this row's button once the list has loaded (focus returning from its detail view). */
  focusRequest?: FocusRequest;
  /** Called when the requested row isn't in the list any more. */
  onFocusMissing?: () => void;
}

export function ApplicationList({ onOpen, focusRequest, onFocusMissing }: Props) {
  const applications = useLiveQuery(() => listApplications(), []);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const handled = useRef(0);
  const loaded = applications !== undefined;

  useLayoutEffect(() => {
    if (!loaded || !focusRequest?.rowId || focusRequest.n === handled.current) return;
    handled.current = focusRequest.n;
    const row = rowButtons.current.get(focusRequest.rowId);
    if (row) row.focus();
    else onFocusMissing?.();
  }, [loaded, focusRequest, onFocusMissing]);

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
          <button
            type="button"
            ref={(element) => {
              if (element) rowButtons.current.set(app.id, element);
              else rowButtons.current.delete(app.id);
            }}
            onClick={() => onOpen(app.id)}
            className="flex min-w-0 flex-col gap-0.5 rounded text-left hover:bg-slate-50 focus:outline-2 focus:outline-indigo-600"
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
