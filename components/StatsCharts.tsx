import { useId, type ReactNode } from 'react';
import { formatLocalDate, formatShortLocalDate } from '@/lib/dates';
import type { Activity, ActivityUnit, GoalProgress, Stats } from '@/lib/stats';
import { STATUS_LABELS } from '@/lib/status';
import { STATUS_SWATCH } from './statusColors';
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

/** Where the applications applied in the range stand now: a stacked bar and its legend. */
export function OutcomesBar({ outcomes }: { outcomes: Stats['outcomes'] }) {
  const id = useId();
  const total = outcomes.reduce((sum, outcome) => sum + outcome.count, 0);
  if (total === 0) return null;
  return (
    <section aria-labelledby={`${id}-heading`} className={chartCard}>
      <ChartHeader id={`${id}-heading`} title="Where they stand now">
        Applications from this range, by their status today.
      </ChartHeader>
      <div aria-hidden="true" className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {outcomes.map(({ status, count }) => (
          <div
            key={status}
            className={STATUS_SWATCH[status]}
            style={{ flexGrow: count, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1.5 text-xs">
        {outcomes.map(({ status, count }) => (
          <li key={status} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-full ${STATUS_SWATCH[status]}`}
            />
            <span className="min-w-0 flex-1">{outcomeLabel(status)}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Each chart sits in a card (shadcn's chart card): a title, a line under it, then the chart. */
const chartCard = 'card flex min-w-0 flex-col gap-3 p-4';

function ChartHeader({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
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

  return (
    <section aria-labelledby={`${id}-heading`} className={chartCard}>
      <ChartHeader id={`${id}-heading`} title={`Applications per ${per}`}>
        {summary}
      </ChartHeader>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-1.5">
        {/* HTML bars rather than a stretched SVG, so their rounded tops keep their shape. */}
        <div className="relative h-24">
          <div className="absolute inset-x-0 top-0 border-t border-dashed" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed" />
          <div className="absolute inset-0 flex items-end border-b">
            {buckets.map((bucket) => (
              <div
                key={bucket.from}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
              >
                {bucket.count > 0 && (
                  <div
                    data-bar=""
                    // At least 2px, so one application still shows beside a busy day.
                    className="min-h-0.5 w-3/4 rounded-t-[3px] bg-chart-1"
                    style={{ height: `${(bucket.count / max) * 100}%` }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
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

/** What the weekly goal card says under the numbers: how far to go, or that it's reached. */
export function goalMessage({ count, goal, remaining }: GoalProgress): string {
  if (remaining > 0) return `${remaining} more to reach your goal.`;
  return count > goal ? `Goal reached, and ${count - goal} beyond it.` : 'Goal reached. Nice work.';
}

/**
 * The weekly goal ring (spec §4.7), beside the Applied number: this week's applications against
 * the goal, whatever range the tab shows. Full once the goal is reached; the count keeps going
 * past it ("12 of 10"). `describedBy` names the line that says how far there is to go.
 */
export function GoalRing({
  progress,
  describedBy,
}: {
  progress: GoalProgress;
  /** The element saying how far there is to go (`goalMessage`), which the caller lays out. */
  describedBy: string;
}) {
  const id = useId();
  const { count, goal, fraction } = progress;
  const label = `${count} of ${goal} ${goal === 1 ? 'application' : 'applications'} this week`;
  return (
    <section
      aria-labelledby={`${id}-heading`}
      aria-describedby={describedBy}
      className="flex min-w-0 items-center gap-3"
    >
      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 100 100"
        className="size-20 shrink-0 -rotate-90"
      >
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="12"
          className="stroke-border"
        />
        {count > 0 && (
          <circle
            cx="50"
            cy="50"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="12"
            // Square ends: round caps would add length, so 1 of 200 would look 4% full and 199
            // of 200 would look complete.
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - fraction)}
            className="stroke-chart-1 transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          />
        )}
      </svg>
      <div className="flex min-w-0 flex-col">
        <h3 id={`${id}-heading`} className="text-xs text-muted-foreground">
          Weekly goal
        </h3>
        {/* The ring's own label says this to screen readers; once is enough. */}
        <p aria-hidden="true" className="text-2xl leading-tight font-semibold tabular-nums">
          {count} of {goal}{' '}
          <span className="block text-xs font-normal text-muted-foreground">this week</span>
        </p>
      </div>
    </section>
  );
}
