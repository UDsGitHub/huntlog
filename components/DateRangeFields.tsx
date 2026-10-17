import type { RefObject } from 'react';
import { MIN_YEAR } from '@/lib/dates';
import type { DateRange } from '@/lib/stats';

type End = keyof DateRange;

/**
 * A Custom range's From and To, side by side: dates from 1970 up to `today`, each with its own
 * error linked to it (ids `${id}-from-error`, `${id}-to-error`, as `useFieldErrors` uses). The
 * list's date filter and the Stats tab's Custom range sheet both use it, so their bounds match.
 */
export function DateRangeFields({
  id,
  value,
  today,
  errors,
  onChange,
  refs,
}: {
  id: string;
  value: Partial<DateRange>;
  today: string;
  errors: Partial<Record<End, string>>;
  onChange: (end: End, date: string) => void;
  refs?: Partial<Record<End, RefObject<HTMLInputElement>>>;
}) {
  return (
    <fieldset className="flex min-w-0 gap-2">
      <legend className="sr-only">Custom dates</legend>
      {(['from', 'to'] as const).map((end) => {
        const errorId = `${id}-${end}-error`;
        return (
          <div key={end} className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-${end}`} className="field-label">
              {end === 'from' ? 'From' : 'To'}
            </label>
            <input
              ref={refs?.[end]}
              id={`${id}-${end}`}
              type="date"
              min={`${MIN_YEAR}-01-01`}
              max={today}
              value={value[end] ?? ''}
              onChange={(event) => onChange(end, event.target.value)}
              aria-invalid={errors[end] ? true : undefined}
              aria-describedby={errors[end] ? errorId : undefined}
              className="field"
            />
            {errors[end] && (
              <p id={errorId} className="field-error">
                {errors[end]}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
