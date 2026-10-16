import { useId, useState } from 'react';
import { updateHistoryDate, NotFoundError } from '@/lib/applications';
import { MIN_YEAR, todayLocal } from '@/lib/dates';
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
        <p className="text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ol className="flex flex-col gap-2 border-l border-border pl-3">
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
  const [saving, setSaving] = useState(false);
  // The panel can stay open past midnight; refresh "today" whenever the field is focused.
  const [max, setMax] = useState(() => todayLocal());

  // Saves when the field is left, not on every change: Chrome fires a change per keystroke in a
  // date field, so typing a year would otherwise save "0202" halfway through.
  async function save() {
    if (saving || !value || value === stored) return;
    setSaving(true);
    try {
      const result = await updateHistoryDate(applicationId, { index, at }, value);
      setError('error' in result ? result.error : null);
    } catch (failure) {
      if (!(failure instanceof NotFoundError)) console.error('updateHistoryDate failed', failure);
      setError("Couldn't save this date.");
    } finally {
      setSaving(false);
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
        min={`${MIN_YEAR}-01-01`}
        max={max}
        value={value}
        readOnly={saving}
        aria-busy={saving || undefined}
        onFocus={() => setMax(todayLocal())}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save();
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className="field w-auto py-1"
      />
      {error && (
        <p id={`${inputId}-error`} className="field-error w-full">
          {error}
        </p>
      )}
    </li>
  );
}
