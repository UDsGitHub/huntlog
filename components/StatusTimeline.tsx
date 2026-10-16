import { useId, useState } from 'react';
import { updateHistoryDate, NotFoundError } from '@/lib/applications';
import { todayLocal } from '@/lib/dates';
import { localDateOf, STATUS_LABELS } from '@/lib/status';
import type { Application } from '@/lib/types';

/**
 * The status timeline in the detail view (spec §4.3). Sorted by date for reading; stored order
 * is append-only and untouched. Each entry's date can be edited, e.g. to backfill an interview.
 */
export function StatusTimeline({ application }: { application: Application }) {
  const id = useId().replace(/:/g, '');
  const history = application.statusHistory ?? [];
  // Stable: entries on the same instant keep their stored order.
  const sorted = history
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.index - b.index);

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <h3 id={`${id}-heading`} className="text-sm font-medium">
        Status history
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-600">No history yet.</p>
      ) : (
        <ol className="flex flex-col gap-2 border-l border-slate-200 pl-3">
          {sorted.map(({ entry, index }) => (
            <TimelineEntry
              key={`${index}-${entry.at}`}
              applicationId={application.id}
              index={index}
              status={STATUS_LABELS[entry.status]}
              at={entry.at}
              inputId={`${id}-${index}`}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineEntry({
  applicationId,
  index,
  status,
  at,
  inputId,
}: {
  applicationId: string;
  index: number;
  status: string;
  at: string;
  inputId: string;
}) {
  const stored = localDateOf(at);
  const [value, setValue] = useState(stored);
  const [error, setError] = useState<string | null>(null);

  async function save(date: string) {
    setValue(date);
    if (date === stored) return setError(null);
    try {
      const result = await updateHistoryDate(applicationId, { index, at }, date);
      setError('error' in result ? result.error : null);
    } catch (failure) {
      if (!(failure instanceof NotFoundError)) console.error('updateHistoryDate failed', failure);
      setError("Couldn't save this date.");
    }
  }

  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <label htmlFor={inputId} className="text-sm">
        {status}
      </label>
      <input
        id={inputId}
        type="date"
        max={todayLocal()}
        value={value}
        // A date input reports a complete date (or '' when cleared) on change.
        onChange={(event) => event.target.value && void save(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className="min-w-0 rounded border border-slate-300 px-2 py-1 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700"
      />
      {error && (
        <p id={`${inputId}-error`} className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}
