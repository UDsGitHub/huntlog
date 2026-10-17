import { useId } from 'react';
import { formatLocalDate, formatShortLocalDate } from '@/lib/dates';
import type { Activity, ActivityUnit, GoalProgress, Stats } from '@/lib/stats';
import { STATUS_LABELS } from '@/lib/status';
import type { Status } from '@/lib/types';

/**
 * The Stats tab's two charts (spec §4.7), hand-written rather than a chart library: two simple
 * shapes don't justify the bundle (Recharts measured ~320 KB minified for one bar chart, more
 * than the whole panel). Each drawing is decorative; the same numbers are in text beside it.
 */

/** Rejections are labeled neutrally, never as a headline or in red (spec §4.7). */
export function outcomeLabel(status: Status): string {
  return status === 'rejected' ? 'Closed – not selected' : STATUS_LABELS[status];
}

// Literal class names, so Tailwind finds them. Every status gets its own color, so a segment
// matches its legend row: blues for progress, greens for offers, distinct calm grays and
// browns for the closed ones (Rejected is never red). Segments are separated by gaps and the
// bar is outlined, so even the lighter ones read against the panel.
const OUTCOME_COLORS: Record<Status, string> = {
  saved: 'bg-status-saved',
  applied: 'bg-status-applied',
  screening: 'bg-status-screening',
  interviewing: 'bg-status-interviewing',
  offer: 'bg-status-offer',
  accepted: 'bg-status-accepted',
  rejected: 'bg-status-rejected',
  withdrawn: 'bg-status-withdrawn',
  ghosted: 'bg-status-ghosted',
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
      <div
        aria-hidden="true"
        className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full border border-input bg-background p-px"
      >
        {outcomes.map(({ status, count }) => (
          <div
            key={status}
            className={`rounded-full ${OUTCOME_COLORS[status]}`}
            style={{ flexGrow: count, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {outcomes.map(({ status, count }) => (
          <li key={status} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-sm ring-1 ring-input ${OUTCOME_COLORS[status]}`}
            />
            <span className="min-w-0 flex-1">{outcomeLabel(status)}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A bucket in words: "Oct 5, 2026", "Week of Oct 5, 2026", "Oct 2026" or "2026". */
function bucketName(unit: ActivityUnit, from: string): string {
  switch (unit) {
    case 'day':
      return formatLocalDate(from);
    case 'week':
      return `Week of ${formatLocalDate(from)}`;
    case 'month':
      return formatShortLocalDate(from, 'month-year');
    case 'year':
      return from.slice(0, 4);
  }
}

/** An axis end label: short, with the year when the range crosses one (or is per month). */
function axisLabel(unit: ActivityUnit, date: string, crossesYear: boolean): string {
  if (unit === 'year') return date.slice(0, 4);
  if (unit === 'month') return formatShortLocalDate(date, 'month-year');
  return crossesYear ? formatLocalDate(date) : formatShortLocalDate(date, 'day-month');
}

const HEIGHT = 64;
const GAP_RATIO = 0.25;

/**
 * Applications per day, week, month or year across the range, as bars. `total` is the Applied
 * count shown above, so the two can't disagree. Screen readers get a one-line summary and the
 * same data as a table; sighted users get the summary and the end dates.
 */
export function ActivityChart({ activity, total }: { activity: Activity; total: number }) {
  const id = useId();
  const { unit, buckets } = activity;
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((bucket) => bucket.count));
  const busiest = buckets.find((bucket) => bucket.count === max)!;
  const per = unit;
  const busiestName = bucketName(unit, busiest.from);
  const summary =
    total === 0
      ? 'No applications in this range yet.'
      : `${total} ${total === 1 ? 'application' : 'applications'} in this range. The busiest ${per} was ${unit === 'week' ? busiestName.replace(/^Week/, 'the week') : busiestName}, with ${max}.`;
  const first = buckets[0]!.from;
  const last = buckets.at(-1)!.to;
  const crossesYear = first.slice(0, 4) !== last.slice(0, 4);

  // One unit per bar, a fraction of it a gap; the SVG stretches to the panel's width.
  const width = buckets.length;
  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-2">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">
        Applications per {per}
      </h3>
      <p className="text-xs text-muted-foreground">{summary}</p>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-1">
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" className="h-16 w-full">
          <line
            x1={0}
            x2={width}
            y1={HEIGHT - 0.5}
            y2={HEIGHT - 0.5}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {buckets.map((bucket, index) =>
            bucket.count === 0 ? null : (
              <rect
                key={bucket.from}
                x={index + GAP_RATIO / 2}
                y={HEIGHT - (bucket.count / max) * (HEIGHT - 2)}
                width={1 - GAP_RATIO}
                height={(bucket.count / max) * (HEIGHT - 2)}
                className="fill-chart-1"
              />
            ),
          )}
        </svg>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{axisLabel(unit, first, crossesYear)}</span>
          <span>{axisLabel(unit, last, crossesYear)}</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Applications per {per}</caption>
        <thead>
          <tr>
            <th scope="col">{per[0]!.toUpperCase() + per.slice(1)}</th>
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

const RING_RADIUS = 40;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The weekly goal ring (spec §4.7): this week's applications against the goal, whatever range
 * the tab shows. Full once the goal is reached; the count keeps going past it ("12 of 10").
 */
export function GoalRing({ progress }: { progress: GoalProgress }) {
  const id = useId();
  const { count, goal, fraction, remaining } = progress;
  const label = `${count} of ${goal} ${goal === 1 ? 'application' : 'applications'} this week`;
  return (
    <section aria-labelledby={`${id}-heading`} className="card flex min-w-0 items-center gap-4 p-4">
      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 100 100"
        className="size-24 shrink-0 -rotate-90"
      >
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="10"
          className="stroke-border"
        />
        {count > 0 && (
          <circle
            cx="50"
            cy="50"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="10"
            // Square ends: round caps would add length, so 1 of 200 would look 4% full and 199
            // of 200 would look complete.
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - fraction)}
            className="stroke-chart-1 transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          />
        )}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          transform="rotate(90 50 50)"
          aria-hidden="true"
          className="fill-foreground text-[1.375rem] font-semibold"
        >
          {count}
        </text>
      </svg>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          Weekly goal
        </h3>
        {/* The ring's own label says this to screen readers; once is enough. */}
        <p aria-hidden="true" className="text-sm">
          {count} of {goal} this week
        </p>
        <p className="text-xs text-muted-foreground">
          {remaining > 0
            ? `${remaining} more to reach your goal.`
            : count > goal
              ? `Goal reached, and ${count - goal} beyond it.`
              : 'Goal reached. Nice work.'}
        </p>
      </div>
    </section>
  );
}
