import { useId } from 'react';
import { formatLocalDate } from '@/lib/dates';
import type { Activity, Stats } from '@/lib/stats';
import { STATUS_LABELS } from '@/lib/status';
import type { Status } from '@/lib/types';

/**
 * The Stats tab's two charts (spec §4.7), hand-written rather than a chart library: two simple
 * shapes don't justify the bundle (Recharts measured ~320 KB minified for one bar chart, more
 * than the whole panel). Each chart is decorative; the same numbers are in text beside it.
 */

/** Rejections are labeled neutrally, never as a headline or in red (spec §4.7). */
export function outcomeLabel(status: Status): string {
  return status === 'rejected' ? 'Closed – not selected' : STATUS_LABELS[status];
}

// Literal class names, so Tailwind finds them. Rejected is a calm gray like the other closed
// statuses; color only tells progress apart, and the legend carries every label.
const OUTCOME_COLORS: Record<Status, string> = {
  saved: 'bg-slate-200',
  applied: 'bg-indigo-200',
  screening: 'bg-indigo-400',
  interviewing: 'bg-indigo-600',
  offer: 'bg-emerald-500',
  accepted: 'bg-emerald-700',
  rejected: 'bg-slate-400',
  withdrawn: 'bg-slate-300',
  ghosted: 'bg-slate-200',
};

/** Where the applications applied in the range stand now: a stacked bar and its legend. */
export function OutcomesBar({ outcomes }: { outcomes: Stats['outcomes'] }) {
  const id = useId();
  const total = outcomes.reduce((sum, outcome) => sum + outcome.count, 0);
  if (total === 0) return null;
  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-2">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">
        Where they stand now
      </h3>
      <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full">
        {outcomes.map(({ status, count }) => (
          <div
            key={status}
            className={OUTCOME_COLORS[status]}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {outcomes.map(({ status, count }) => (
          <li key={status} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-sm ${OUTCOME_COLORS[status]}`}
            />
            <span className="min-w-0 flex-1">{outcomeLabel(status)}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Oct 5" for a YYYY-MM-DD date, without the year (the range above shows it). */
function short(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return shortDate.format(new Date(Date.UTC(y, m - 1, d)));
}

/** A bucket's name in text: "Oct 5", or "Week of Oct 5" (with its clamped start). */
function bucketName(unit: Activity['unit'], from: string): string {
  return unit === 'day' ? formatLocalDate(from) : `Week of ${formatLocalDate(from)}`;
}

const HEIGHT = 64;
const GAP_RATIO = 0.25;

/**
 * Applications per day or per week across the range, as bars. Screen readers get a one-line
 * summary and the same data as a table; sighted users get the busiest count and the end dates.
 */
export function ActivityChart({ activity }: { activity: Activity }) {
  const id = useId();
  const { unit, buckets } = activity;
  if (buckets.length === 0) return null;
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const max = Math.max(...buckets.map((bucket) => bucket.count));
  const busiest = buckets.find((bucket) => bucket.count === max)!;
  const per = unit === 'day' ? 'day' : 'week';
  const summary =
    total === 0
      ? `No applications in this range yet.`
      : `${total} ${total === 1 ? 'application' : 'applications'} in this range. The busiest ${per} was ${unit === 'day' ? '' : 'the week of '}${formatLocalDate(busiest.from)}, with ${max}.`;

  // One unit per bar, a fraction of it a gap; the SVG stretches to the panel's width.
  const width = buckets.length;
  const barWidth = 1 - GAP_RATIO;
  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-2">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">
        Applications per {per}
      </h3>
      <p className="text-xs text-slate-600">{summary}</p>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-1">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-16 w-full"
          role="presentation"
        >
          <line
            x1={0}
            x2={width}
            y1={HEIGHT - 0.5}
            y2={HEIGHT - 0.5}
            className="stroke-slate-300"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {buckets.map((bucket, index) => {
            const height = max === 0 ? 0 : (bucket.count / max) * (HEIGHT - 2);
            return (
              <rect
                key={bucket.from}
                x={index + GAP_RATIO / 2}
                y={HEIGHT - height}
                width={barWidth}
                height={height}
                className="fill-indigo-500"
              >
                <title>{`${bucketName(unit, bucket.from)}: ${bucket.count}`}</title>
              </rect>
            );
          })}
        </svg>
        <div className="flex justify-between text-xs text-slate-600">
          <span>{short(buckets[0]!.from)}</span>
          <span>{short(buckets.at(-1)!.to)}</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Applications per {per}</caption>
        <thead>
          <tr>
            <th scope="col">{unit === 'day' ? 'Day' : 'Week'}</th>
            <th scope="col">Applications</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.from}>
              <th scope="row">{bucketName(unit, bucket.from)}</th>
              <td>{bucket.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
