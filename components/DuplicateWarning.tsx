import { useLayoutEffect, useRef } from 'react';
import type { Application } from '@/lib/types';

interface Props {
  matches: Application[];
  /** Normalized URL of what's being saved, to say why each match matched. */
  urlNormalized: string;
  onViewExisting: (id: string) => void;
  onSaveAnyway: () => void;
}

const button =
  'rounded border border-amber-700 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600';

/** Non-blocking duplicate warning (spec §4.5). Shows the newest match; the user decides. */
export function DuplicateWarning({ matches, urlNormalized, onViewExisting, onSaveAnyway }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [match] = matches;

  // Move keyboard users to the warning; its buttons come next in tab order.
  useLayoutEffect(() => {
    box.current?.focus();
  }, [matches]);

  if (!match) return null;
  const reason =
    match.urlNormalized === urlNormalized ? 'Same job posting URL' : 'Same company and title';
  const more = matches.length - 1;

  return (
    <div
      ref={box}
      role="alert"
      tabIndex={-1}
      aria-labelledby="duplicate-heading"
      className="flex min-w-0 flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 focus:outline-2 focus:outline-indigo-600"
    >
      <p id="duplicate-heading" className="font-medium">
        You may have logged this already
      </p>
      <p className="break-words">
        {match.company}
        {match.title && ` · ${match.title}`}
        {match.appliedAt && `, applied ${match.appliedAt}`}
        <span className="block text-xs text-amber-900">
          {reason}
          {more > 0 && ` · and ${more} more ${more === 1 ? 'match' : 'matches'}`}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onViewExisting(match.id)} className={button}>
          View existing
        </button>
        <button type="button" onClick={onSaveAnyway} className={button}>
          Save anyway
        </button>
      </div>
    </div>
  );
}
