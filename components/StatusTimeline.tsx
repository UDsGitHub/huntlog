import { useId, useLayoutEffect, useRef, useState } from 'react';
import { updateHistoryDate, NotFoundError } from '@/lib/applications';
import { formatTimestampDate, MIN_YEAR, todayLocal } from '@/lib/dates';
import { localDateOf, STATUS_LABELS } from '@/lib/status';
import type { Application, Status } from '@/lib/types';
import { CheckIcon, PencilIcon, XIcon } from './icons';
import { STATUS_SWATCH } from './statusColors';

/**
 * The status timeline in the detail view (spec §4.3): a vertical stepper, one dot per entry in
 * its status's color. Sorted by date for reading; stored order is append-only and untouched.
 * Each date can be corrected (e.g. to backfill an interview): it's read-only until its pencil
 * opens a date field, which saves only on Save or Enter, never just by picking a date.
 */
export function StatusTimeline({ application }: { application: Application }) {
  const id = useId().replace(/:/g, '');
  // The entry whose pencil gets focus once it re-renders after a saved date (its key changes).
  const [focusAfterSave, setFocusAfterSave] = useState<number | null>(null);
  const history = application.statusHistory ?? [];
  // Stable: entries on the same instant keep their stored order.
  const sorted = history
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.index - b.index);

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">
        Status history
      </h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ol className="ml-1.5 flex flex-col gap-3 border-l-2 border-border pl-5">
          {sorted.map(({ entry, index }) => (
            <TimelineEntry
              // Keyed by position and time: if the entry changes (here or in another window),
              // an editor open on the old one is dropped rather than saved onto the new one.
              key={`${index}-${entry.at}`}
              applicationId={application.id}
              index={index}
              status={entry.status}
              at={entry.at}
              focusPencil={focusAfterSave === index}
              onSaved={() => setFocusAfterSave(index)}
              onPencilFocused={() => setFocusAfterSave(null)}
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
  focusPencil,
  onSaved,
  onPencilFocused,
}: {
  applicationId: string;
  index: number;
  status: Status;
  at: string;
  /** Just saved (and re-keyed): its pencil takes focus back. */
  focusPencil: boolean;
  onSaved: () => void;
  onPencilFocused: () => void;
}) {
  const id = useId();
  const label = STATUS_LABELS[status];
  const stored = localDateOf(at);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A ref, so a double activation before React re-renders can't save twice.
  const savingNow = useRef(false);
  // The panel can stay open past midnight; refreshed whenever the field is focused.
  const [max, setMax] = useState(() => todayLocal());
  const input = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  // Where focus goes when the editor closes: the pencil, unless the closing came from elsewhere.
  const refocus = useRef(false);

  useLayoutEffect(() => {
    // Until the saved date arrives, the old entry (still editing, so without a pencil) is the
    // one showing: wait for the new one rather than clearing the request.
    if (!focusPencil || !pencil.current) return;
    pencil.current.focus();
    onPencilFocused();
  }, [focusPencil, onPencilFocused]);

  useLayoutEffect(() => {
    if (editing) input.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      pencil.current?.focus();
    }
  }, [editing]);

  function open() {
    setValue(stored);
    setError(null);
    setEditing(true);
  }

  function close() {
    refocus.current = true;
    setEditing(false);
  }

  async function save() {
    if (savingNow.current) return;
    if (!value) return setError('Enter a date.');
    if (value === stored) return close();
    savingNow.current = true;
    setSaving(true);
    try {
      const result = await updateHistoryDate(applicationId, { index, at }, value);
      if ('error' in result) setError(result.error);
      // Saved: this entry re-renders under a new key, and its pencil gets focus there.
      else onSaved();
    } catch (failure) {
      if (!(failure instanceof NotFoundError)) console.error('updateHistoryDate failed', failure);
      setError("Couldn't save this date.");
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  return (
    <li className="relative flex min-w-0 flex-col gap-2">
      <span
        aria-hidden="true"
        className={`absolute top-1.5 -left-[1.6875rem] size-3 rounded-full ring-4 ring-background ${STATUS_SWATCH[status]}`}
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{formatTimestampDate(at)}</span>
        </div>
        {!editing && (
          <button
            ref={pencil}
            type="button"
            onClick={open}
            aria-label={`Change the date for ${label}`}
            title="Change date"
            className="btn btn-ghost btn-icon size-8 shrink-0 text-muted-foreground"
          >
            <PencilIcon />
          </button>
        )}
      </div>
      {editing && (
        <div
          role="group"
          aria-label={`Date for ${label}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          className="flex min-w-0 flex-col gap-1"
        >
          <label htmlFor={`${id}-date`} className="sr-only">
            {label} date
          </label>
          <div className="flex min-w-0 items-center gap-3">
            <input
              ref={input}
              id={`${id}-date`}
              type="date"
              min={`${MIN_YEAR}-01-01`}
              max={max}
              onFocus={() => setMax(todayLocal())}
              value={value}
              readOnly={saving}
              aria-busy={saving || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void save();
                }
              }}
              className="field min-w-0 flex-1"
            />
            {/* Save and Cancel sit together, apart from the field. */}
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => void save()}
                aria-label={`Save the date for ${label}`}
                className="btn btn-ghost btn-icon size-8"
              >
                <CheckIcon />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Cancel"
                className="btn btn-ghost btn-icon size-8"
              >
                <XIcon />
              </button>
            </div>
          </div>
          {error && (
            <p id={`${id}-error`} className="field-error">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
