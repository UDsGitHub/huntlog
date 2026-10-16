import { useId, useLayoutEffect, useRef } from 'react';
import type { DuplicateMatch } from '@/lib/applications';
import { formatLocalDate } from '@/lib/dates';

interface Props {
  matches: DuplicateMatch[];
  /** Editing an existing application: viewing another one discards the unsaved changes. */
  editing: boolean;
  onViewExisting: (id: string) => void;
  onSaveAnyway: () => void;
}

const button =
  'btn border border-warning-foreground/60 text-warning-foreground hover:bg-warning-border/20';

/**
 * Non-blocking duplicate warning (spec §4.5). Shows the newest match; the user decides.
 * Focus moves to it, which is how it's announced: it isn't also a live region, so screen
 * readers don't read it twice.
 */
export function DuplicateWarning({ matches, editing, onViewExisting, onSaveAnyway }: Props) {
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [first] = matches;

  useLayoutEffect(() => {
    box.current?.focus();
  }, [matches]);

  if (!first) return null;
  const { application: match, reason } = first;
  const more = matches.length - 1;

  return (
    <div
      ref={box}
      role="group"
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-warning-border bg-warning p-3 text-sm text-warning-foreground focus-ring"
    >
      <p id={headingId} className="font-medium">
        You may have logged this already
      </p>
      <p className="break-words">
        {match.company}
        {match.title && ` · ${match.title}`}
        {match.appliedAt && `, applied ${formatLocalDate(match.appliedAt)}`}
        <span className="block text-xs text-warning-foreground">
          {reason === 'url' ? 'Same job posting URL' : 'Same company and title'}
          {more > 0 && ` · and ${more} more ${more === 1 ? 'match' : 'matches'}`}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onViewExisting(match.id)} className={button}>
          {editing ? 'Discard changes and view existing' : 'View existing'}
        </button>
        <button type="button" onClick={onSaveAnyway} className={button}>
          Save anyway
        </button>
      </div>
    </div>
  );
}
