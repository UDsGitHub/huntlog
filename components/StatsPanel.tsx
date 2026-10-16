import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useMemo, useState } from 'react';
import { listApplications } from '@/lib/applications';
import {
  checkPastLocalDate,
  formatLocalDate,
  MIN_YEAR,
  msUntilNextDay,
  todayLocal,
} from '@/lib/dates';
import { localeWeekStart } from '@/lib/locale';
import {
  addDays,
  computeStats,
  RANGE_KINDS,
  RANGE_LABELS,
  resolveRange,
  type DateRange,
  type RangeKind,
  type Rate,
} from '@/lib/stats';
import { ActivityChart, OutcomesBar } from './StatsCharts';

const field =
  'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';

const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent' });

/** "Oct 11 – Oct 17, 2026"-style text for a range, or one date when it's a single day. */
function rangeText({ from, to }: DateRange): string {
  return from === to ? formatLocalDate(from) : `${formatLocalDate(from)} – ${formatLocalDate(to)}`;
}

/**
 * Today's local date, kept current: a panel left open overnight moves This week, the Custom
 * limit and every "today"-based range on at midnight, with no data change to trigger it.
 */
function useToday(): string {
  const [today, setToday] = useState(() => todayLocal());
  useEffect(() => {
    // Re-checked rather than trusted: a timer can fire a little early, or late after sleep.
    const check = () => {
      if (todayLocal() !== today) setToday(todayLocal());
      else schedule();
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(check, msUntilNextDay() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [today]);
  return today;
}

/** A Custom date's error: empty, or outside what any entered date allows (1970 to today). */
function customDateError(value: string | undefined, now: Date): string | undefined {
  if (!value) return 'Enter a date.';
  return checkPastLocalDate(value, now);
}

/**
 * The Stats tab (spec §4.7): a range (This week by default, kept while switching tabs), then the
 * headline numbers. Counting lives in `lib/stats.ts`; this only picks the range and shows it.
 */
export function StatsPanel() {
  const apps = useLiveQuery(() => listApplications(), []);
  const id = useId();
  const [kind, setKind] = useState<RangeKind>('this-week');
  const [custom, setCustom] = useState<Partial<DateRange>>({});
  const today = useToday();
  // M6 adds a Settings override.
  const weekStartsOn = useMemo(() => localeWeekStart(), []);
  // The tab stays mounted while hidden, and every write elsewhere reloads `apps`: only recount
  // when something the numbers depend on changed.
  const result = useMemo(() => {
    if (!apps) return undefined;
    // Noon on today's date: a "now" that stays on that day.
    const now = new Date(`${today}T12:00:00`);
    const range = resolveRange(kind, { now, weekStartsOn, apps, custom });
    return { now, range, stats: range && computeStats(apps, range, weekStartsOn) };
  }, [apps, kind, custom, weekStartsOn, today]);

  if (!apps || !result) return null;
  const { now, range, stats } = result;
  const errors =
    kind === 'custom'
      ? { from: customDateError(custom.from, now), to: customDateError(custom.to, now) }
      : {};

  function pickKind(next: RangeKind) {
    // Custom starts from the last 30 days, so both dates have a sensible value to edit.
    if (next === 'custom') {
      setCustom((c) => ({ from: c.from || addDays(today, -29), to: c.to || today }));
    }
    setKind(next);
  }

  return (
    <section aria-labelledby="stats-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="stats-heading" className="text-base font-semibold">
        Stats
      </h2>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-range`} className="text-sm font-medium">
            Range
          </label>
          <select
            id={`${id}-range`}
            value={kind}
            onChange={(event) => pickKind(event.target.value as RangeKind)}
            className={field}
          >
            {RANGE_KINDS.map((option) => (
              <option key={option} value={option}>
                {RANGE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        {kind === 'custom' && (
          <fieldset className="flex min-w-0 gap-2">
            <legend className="sr-only">Custom range</legend>
            {(['from', 'to'] as const).map((end) => (
              <div key={end} className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`${id}-${end}`} className="text-sm font-medium">
                  {end === 'from' ? 'From' : 'To'}
                </label>
                <input
                  id={`${id}-${end}`}
                  type="date"
                  min={`${MIN_YEAR}-01-01`}
                  max={today}
                  value={custom[end] ?? ''}
                  onChange={(event) => setCustom((c) => ({ ...c, [end]: event.target.value }))}
                  aria-invalid={errors[end] ? true : undefined}
                  aria-describedby={errors[end] ? `${id}-${end}-error` : undefined}
                  className={field}
                />
                {errors[end] && (
                  <p id={`${id}-${end}-error`} className="text-xs text-red-700">
                    {errors[end]}
                  </p>
                )}
              </div>
            ))}
          </fieldset>
        )}
        {range && <p className="text-xs text-slate-600">{rangeText(range)}</p>}
      </div>

      {apps.length === 0 ? (
        <p className="text-sm text-slate-600">
          Your stats show up here once you log applications. Every one you send counts.
        </p>
      ) : (
        stats && (
          <>
            <dl aria-label="Headline numbers" className="grid grid-cols-3 gap-2">
              <Count label="Applied" value={stats.applied} />
              <Count label="Interviews" value={stats.interviews} />
              <Count label="Offers" value={stats.offers} />
            </dl>
            <dl aria-label="Rates" className="grid grid-cols-2 gap-2">
              <RateCard label="Response rate" rate={stats.responseRate} outcome="heard back" />
              <RateCard label="Interview rate" rate={stats.interviewRate} outcome="interviewed" />
            </dl>
            {stats.applied === 0 && (
              <p className="text-sm text-slate-600">
                Nothing applied in this range yet. The rates fill in as you apply.
              </p>
            )}
            {stats.applied > 0 && (
              <>
                <OutcomesBar outcomes={stats.outcomes} />
                <ActivityChart activity={stats.activity} total={stats.applied} />
              </>
            )}
          </>
        )
      )}
    </section>
  );
}

const card = 'flex min-w-0 flex-col-reverse gap-0.5 rounded border border-slate-200 p-2';

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className={card}>
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** A rate, with its counts: "40%", "4 of 10 heard back". */
function RateCard({ label, rate, outcome }: { label: string; rate: Rate; outcome: string }) {
  const counts =
    rate.total === 0 ? 'None applied in range' : `${rate.count} of ${rate.total} ${outcome}`;
  return (
    <div className={card}>
      <dt className="text-xs text-slate-600">
        {label}
        {/* A separate sentence, so screen readers don't run it into the label. */}
        <span className="sr-only">. </span>
        <span className="block">{counts}</span>
      </dt>
      <dd className="text-xl font-semibold tabular-nums">
        {rate.percent === undefined ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">No rate yet</span>
          </>
        ) : (
          percentFormat.format(rate.percent / 100)
        )}
      </dd>
    </div>
  );
}
