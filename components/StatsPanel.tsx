import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useMemo, useState } from 'react';
import { listApplications } from '@/lib/applications';
import { formatLocalDate, todayLocal } from '@/lib/dates';
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

const field =
  'w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-600 aria-invalid:border-red-700';

const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent' });

/** "Oct 11 – Oct 17, 2026"-style text for a range, or one date when it's a single day. */
function rangeText({ from, to }: DateRange): string {
  return from === to ? formatLocalDate(from) : `${formatLocalDate(from)} – ${formatLocalDate(to)}`;
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
  // M6 adds a Settings override.
  const weekStartsOn = useMemo(() => localeWeekStart(), []);

  if (!apps) return null;
  const now = new Date();
  const range = resolveRange(kind, { now, weekStartsOn, apps, custom });
  const stats = range && computeStats(apps, range, weekStartsOn);

  function pickKind(next: RangeKind) {
    // Custom starts from the last 30 days, so both dates have a sensible value to edit.
    if (next === 'custom' && !custom.from && !custom.to) {
      const today = todayLocal(now);
      setCustom({ from: addDays(today, -29), to: today });
    }
    setKind(next);
  }

  const today = todayLocal(now);
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
                  max={today}
                  value={custom[end] ?? ''}
                  onChange={(event) => setCustom((c) => ({ ...c, [end]: event.target.value }))}
                  aria-invalid={!range || undefined}
                  aria-describedby={!range ? `${id}-custom-error` : undefined}
                  className={field}
                />
              </div>
            ))}
          </fieldset>
        )}
        {range ? (
          <p className="text-xs text-slate-600">{rangeText(range)}</p>
        ) : (
          <p id={`${id}-custom-error`} className="text-xs text-red-700">
            Enter both dates.
          </p>
        )}
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
              <RateCard label="Response rate" rate={stats.responseRate} />
              <RateCard label="Interview rate" rate={stats.interviewRate} />
            </dl>
            {stats.applied === 0 && (
              <p className="text-sm text-slate-600">
                Nothing applied in this range yet. The rates fill in as you apply.
              </p>
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

function RateCard({ label, rate }: { label: string; rate: Rate }) {
  const shown = rate.percent === undefined ? '—' : percentFormat.format(rate.percent / 100);
  return (
    <div className={card}>
      <dt className="text-xs text-slate-600">
        {label}
        <span className="block">
          {rate.total === 0 ? 'None applied in range' : `${rate.count} of ${rate.total} applied`}
        </span>
      </dt>
      <dd className="text-xl font-semibold tabular-nums">
        {rate.percent === undefined ? (
          <>
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">No rate yet</span>
          </>
        ) : (
          shown
        )}
      </dd>
    </div>
  );
}
