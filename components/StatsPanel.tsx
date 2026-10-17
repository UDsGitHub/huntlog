import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { listApplications } from '@/lib/applications';
import { formatLocalDate, MIN_YEAR, todayLocal } from '@/lib/dates';
import { effectiveWeekStart } from '@/lib/settings';
import {
  computeStats,
  RANGE_KINDS,
  RANGE_LABELS,
  customDateError,
  customStart,
  resolveRange,
  weeklyGoalProgress,
  type DateRange,
  type RangeKind,
  type Rate,
} from '@/lib/stats';
import { CheckIcon } from './icons';
import { rovingIndex } from './rovingIndex';
import { Sheet } from './Sheet';
import { ActivityChart, GoalRing, OutcomesBar } from './StatsCharts';
import { useFieldErrors } from './useFieldErrors';
import { useToday } from './useToday';
import { useSettings } from './useSettings';

const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent' });

/** "Oct 11 – Oct 17, 2026"-style text for a range, or one date when it's a single day. */
function rangeText({ from, to }: DateRange): string {
  return from === to ? formatLocalDate(from) : `${formatLocalDate(from)} – ${formatLocalDate(to)}`;
}

/**
 * The Stats tab (spec §4.7): a range (This week by default, kept while switching tabs), then the
 * headline numbers. Counting lives in `lib/stats.ts`; this only picks the range and shows it.
 */
export function StatsPanel({ active }: { active: boolean }) {
  const apps = useLiveQuery(() => listApplications(), []);
  const [kind, setKind] = useState<RangeKind>('this-week');
  // The last Custom dates applied (the sheet only applies valid ones).
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  // A capture switching tabs mustn't leave this tab's sheet open behind the next one.
  if (!active && customOpen) setCustomOpen(false);
  const today = useToday();
  const settings = useSettings();
  // Settings → First day of the week, else the locale's (spec §4.7). Undefined while loading.
  const loaded = settings !== undefined;
  const chosen = settings?.weekStartsOn;
  // Memoized on the choice alone: other settings changing don't redo the locale lookup.
  const weekStartsOn = useMemo(
    () => (loaded ? effectiveWeekStart({ weekStartsOn: chosen }) : undefined),
    [loaded, chosen],
  );
  // The tab stays mounted while hidden, and every write elsewhere reloads `apps`: only recount
  // when something the numbers depend on changed.
  const result = useMemo(() => {
    if (!apps || weekStartsOn === undefined) return undefined;
    // Noon on today's date: a "now" that stays on that day.
    const now = new Date(`${today}T12:00:00`);
    const range = resolveRange(kind, { now, weekStartsOn, apps, custom });
    return { now, range, stats: range && computeStats(apps, range, weekStartsOn) };
  }, [apps, kind, custom, weekStartsOn, today]);

  const goal = settings?.weeklyGoal;
  // This week against the goal, whatever range is picked (spec §4.7).
  const resultNow = result?.now;
  const progress = useMemo(
    () =>
      apps && resultNow && goal !== undefined && weekStartsOn !== undefined
        ? weeklyGoalProgress(apps, resultNow, weekStartsOn, goal)
        : undefined,
    [apps, resultNow, goal, weekStartsOn],
  );

  if (!apps || !result) return null;
  const { now, range, stats } = result;

  return (
    <section aria-labelledby="stats-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="stats-heading" className="section-heading">
        Stats
      </h2>
      {progress && <GoalRing progress={progress} />}

      <div className="flex min-w-0 flex-col gap-1">
        <RangeChips
          kind={kind}
          onPick={setKind}
          onCustom={() => setCustomOpen(true)}
          customOpen={customOpen}
        />
        {range && <p className="text-xs text-muted-foreground">{rangeText(range)}</p>}
      </div>
      <CustomRangeSheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        // The applied dates, or the last 30 days the first time.
        initial={customStart(custom ?? {}, today)}
        now={now}
        onApply={(dates) => {
          setCustom(dates);
          setKind('custom');
          setCustomOpen(false);
        }}
      />

      {apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">
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

/**
 * The range (spec §4.7): a row of chips that scrolls sideways, one Tab stop. Arrow keys, Home
 * and End move between chips without changing the range; Enter, Space or a tap picks. Custom
 * opens its dates in a sheet, so landing on it never pops a sheet up.
 */
function RangeChips({
  kind,
  onPick,
  onCustom,
  customOpen,
}: {
  kind: RangeKind;
  onPick: (kind: RangeKind) => void;
  onCustom: () => void;
  customOpen: boolean;
}) {
  const chips = useRef(new Map<RangeKind, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = RANGE_KINDS.findIndex((k) => chips.current.get(k) === document.activeElement);
    if (index === -1) return;
    const to = rovingIndex(event.key, index, RANGE_KINDS.length, {
      next: 'ArrowRight',
      previous: 'ArrowLeft',
    });
    if (to === undefined) return;
    event.preventDefault();
    chips.current.get(RANGE_KINDS[to]!)?.focus();
  }

  return (
    <div
      role="group"
      aria-label="Range"
      onKeyDown={onKeyDown}
      // Edge to edge across the tab (its padding is px-4), so chips scroll out under the edge;
      // scroll padding keeps a focused chip clear of it. Room above and below for focus rings.
      className="-mx-4 flex min-w-0 scroll-px-4 gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none]"
    >
      {RANGE_KINDS.map((option) => {
        const pressed = option === kind;
        return (
          <button
            key={option}
            ref={(element) => {
              if (element) chips.current.set(option, element);
              else chips.current.delete(option);
            }}
            type="button"
            aria-pressed={pressed}
            // Only the chosen chip is a Tab stop; the arrows reach the others.
            tabIndex={pressed ? 0 : -1}
            {...(option === 'custom' && {
              'aria-haspopup': 'dialog' as const,
              'aria-expanded': customOpen,
            })}
            onClick={() => (option === 'custom' ? onCustom() : onPick(option))}
            className={`chip focus-ring shrink-0 whitespace-nowrap ${pressed ? 'chip-on' : ''}`}
          >
            {pressed && <CheckIcon className="size-3.5" />}
            {option === 'custom' ? 'Custom…' : RANGE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Custom's From and To (spec §4.7), applied together by Apply: closing any other way keeps the
 * range that was showing. Dates the wrong way round are swapped.
 */
function CustomRangeSheet({
  open,
  onClose,
  initial,
  now,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  initial: DateRange;
  now: Date;
  onApply: (dates: DateRange) => void;
}) {
  const formId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Custom range"
      description="Both dates are included."
      footer={
        <button type="submit" form={formId} className="btn btn-primary w-full">
          Apply
        </button>
      }
    >
      <CustomRangeForm id={formId} initial={initial} now={now} onApply={onApply} />
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so each opening starts from the applied dates. */
function CustomRangeForm({
  id,
  initial,
  now,
  onApply,
}: {
  id: string;
  initial: DateRange;
  now: Date;
  onApply: (dates: DateRange) => void;
}) {
  const [dates, setDates] = useState(initial);
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const refs = useMemo(() => ({ from: fromInput, to: toInput }), []);
  const { fail, clear, described, errorText } = useFieldErrors(id, ['from', 'to'] as const, refs);
  const today = todayLocal(now);

  function apply(event: FormEvent) {
    event.preventDefault();
    const errors = { from: customDateError(dates.from, now), to: customDateError(dates.to, now) };
    if (errors.from || errors.to) return fail(errors);
    const { from, to } = dates;
    onApply(from <= to ? { from, to } : { from: to, to: from });
  }

  return (
    <form
      id={id}
      onSubmit={apply}
      noValidate
      aria-label="Custom range"
      className="flex min-w-0 gap-2"
    >
      {(['from', 'to'] as const).map((end) => (
        <div key={end} className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-${end}`} className="field-label">
            {end === 'from' ? 'From' : 'To'}
          </label>
          <input
            ref={end === 'from' ? fromInput : toInput}
            id={`${id}-${end}`}
            type="date"
            min={`${MIN_YEAR}-01-01`}
            max={today}
            value={dates[end]}
            onChange={(event) => {
              setDates((current) => ({ ...current, [end]: event.target.value }));
              clear();
            }}
            className="field"
            {...described(end)}
          />
          {errorText(end)}
        </div>
      ))}
      {/* Enter in a date field applies; the visible Apply is in the sheet's footer. */}
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
    </form>
  );
}

const card = 'card flex min-w-0 flex-col-reverse gap-0.5 p-2';

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className={card}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
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
      <dt className="text-xs text-muted-foreground">
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
