import { useLiveQuery } from 'dexie-react-hooks';
import { listApplications, safeHref } from '@/lib/applications';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';

export function ApplicationList() {
  const applications = useLiveQuery(() => listApplications(), []);

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
          <span className="text-sm font-medium break-words">{app.company}</span>
          {app.title && <span className="text-sm break-words text-slate-700">{app.title}</span>}
          {(app.location || app.workMode) && (
            <span className="text-xs break-words text-slate-600">
              {[app.location, app.workMode && WORK_MODE_LABELS[app.workMode]]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
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
