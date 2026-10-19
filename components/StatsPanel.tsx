import { useLiveQuery } from 'dexie-react-hooks';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { listApplications } from '@/lib/applications';
import { formatLocalDate } from '@/lib/dates';
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
import { DateRangeFields } from './DateRangeFields';
import { CheckIcon } from './icons';
import { rovingIndex } from './rovingIndex';
import { Sheet } from './Sheet';
import { ActivityChart, applicationWord, OutcomesBar, WeeklyGoalCard } from './StatsCharts';
import { useEdgeFade } from './useEdgeFade';
import { useFieldErrors } from './useFieldErrors';
import { useToday } from './useToday';
import { useSettings } from './useSettings';
import { SUBMIT_SHORTCUT } from './submitShortcut';

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
      // A goal that isn't a positive number counts as none (no goal card, the no-goal layout).
      apps && resultNow && goal !== undefined && goal > 0 && weekStartsOn !== undefined
        ? weeklyGoalProgress(apps, resultNow, weekStartsOn, goal)
        : undefined,
    [apps, resultNow, goal, weekStartsOn],
  );

  if (!apps || !result) return null;
  const { range, stats } = result;

  return (
    <section aria-labelledby="stats-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="stats-heading" className="section-heading">
        Stats
      </h2>

      {/* Nothing logged: nothing to pick a range of. */}
      <div hidden={apps.length === 0} className="flex min-w-0 flex-col gap-1">
        <RangeChips
          kind={kind}
          active={active}
          onPick={setKind}
          onCustom={() => setCustomOpen(true)}
        />
        {range && <p className="text-xs text-muted-foreground">{rangeText(range)}</p>}
      </div>
      <CustomRangeSheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        // The applied dates, or the last 30 days the first time.
        initial={customStart(custom ?? {}, today)}
        today={today}
        onApply={(dates) => {
          setCustom(dates);
          setKind('custom');
          setCustomOpen(false);
        }}
      />

      {/* The goal shows whenever one is set, even before anything is logged. */}
      {apps.length === 0 && progress && <WeeklyGoalCard progress={progress} />}
      {apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your stats show up here once you log applications. Every one you send counts.
        </p>
      ) : !stats ? (
        progress && <WeeklyGoalCard progress={progress} />
      ) : (
        stats && (
          <>
            <div role="group" aria-label="Headline numbers" className="flex flex-col gap-2">
              {/* With a goal, its card leads and the range's Applied joins Interviews and Offers;
                  without one, Applied leads on its own. */}
              {progress ? (
                <>
                  <WeeklyGoalCard progress={progress} />
                  <dl className="grid grid-cols-3 gap-2">
                    <Count label="Applied" value={stats.applied} />
                    <Count label="Interviews" value={stats.interviews} />
                    <Count label="Offers" value={stats.offers} />
                  </dl>
                </>
              ) : (
                <>
                  <AppliedCard applied={stats.applied} />
                  <dl className="grid grid-cols-2 gap-2">
                    <Count label="Interviews" value={stats.interviews} />
                    <Count label="Offers" value={stats.offers} />
                  </dl>
                </>
              )}
            </div>
            <dl aria-label="Rates" className="grid grid-cols-2 gap-2">
              <RateCard label="Response rate" rate={stats.responseRate} outcome="heard back" />
              <RateCard label="Interview rate" rate={stats.interviewRate} outcome="interviewed" />
            </dl>
            {stats.applied === 0 && (
              <p className="text-sm text-muted-foreground">
                {apps.some((app) => app.appliedAt)
                  ? 'Nothing applied in this range. Pick a longer one to see the rest.'
                  : 'Nothing applied yet. The rates fill in as you apply.'}
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
 * The range (spec §4.7): a radio group of chips that scrolls sideways, one Tab stop. Arrow keys,
 * Home and End move between chips without changing the range (as in a toggle group); Enter,
 * Space or a tap picks. Custom opens its dates in a sheet, so landing on it never pops one up.
 */
function RangeChips({
  kind,
  active,
  onPick,
  onCustom,
}: {
  kind: RangeKind;
  /** The tab is shown: the chosen chip is scrolled back into view. */
  active: boolean;
  onPick: (kind: RangeKind) => void;
  onCustom: () => void;
}) {
  const chips = useRef(new Map<RangeKind, HTMLButtonElement>());
  const row = useRef<HTMLDivElement>(null);
  // Fades as wide as the gutter, so a chip scrolled clear of the edge is never faded.
  const fade = useEdgeFade(row, 'x', 'var(--tab-gutter)');

  // Each time the tab is shown (or the range changes), the chosen chip comes back into view if
  // the row was scrolled away from it. Sideways only, and instantly: scrollIntoView would also
  // scroll the tab itself to the row.
  useLayoutEffect(() => {
    const element = row.current;
    const chip = chips.current.get(kind);
    if (!active || !element || !chip) return;
    const style = getComputedStyle(element);
    // The chip's place within the row's scrolled content (the panel is left-to-right only).
    const left = chip.getBoundingClientRect().left - element.getBoundingClientRect().left;
    const start = element.scrollLeft + left - (parseFloat(style.scrollPaddingLeft) || 0);
    const end =
      element.scrollLeft + left + chip.offsetWidth + (parseFloat(style.scrollPaddingRight) || 0);
    if (start < element.scrollLeft) element.scrollLeft = start;
    else if (end > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = end - element.clientWidth;
    }
  }, [active, kind]);

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
      ref={row}
      role="radiogroup"
      aria-label="Range"
      {...fade.attributes}
      style={fade.style}
      onKeyDown={onKeyDown}
      // Edge to edge across the tab (through its --tab-gutter padding), so chips scroll out under
      // the edge; scroll padding keeps a focused chip clear of it. Room for focus rings above and
      // below.
      className="-mx-(--tab-gutter) flex min-w-0 scroll-px-(--tab-gutter) gap-1.5 overflow-x-auto px-(--tab-gutter) py-1"
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
            role="radio"
            aria-checked={pressed}
            // Only the chosen chip is a Tab stop; the arrows reach the others.
            tabIndex={pressed ? 0 : -1}
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
  today,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  initial: DateRange;
  today: string;
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
        <button type="submit" form={formId} {...SUBMIT_SHORTCUT} className="btn btn-primary w-full">
          Apply
        </button>
      }
    >
      <CustomRangeForm id={formId} initial={initial} today={today} onApply={onApply} />
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so each opening starts from the applied dates. */
function CustomRangeForm({
  id,
  initial,
  today,
  onApply,
}: {
  id: string;
  initial: DateRange;
  today: string;
  onApply: (dates: DateRange) => void;
}) {
  const [dates, setDates] = useState(initial);
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const refs = useMemo(() => ({ from: fromInput, to: toInput }), []);
  const { errors, fail, clear } = useFieldErrors(id, ['from', 'to'] as const, refs);

  function apply(event: FormEvent) {
    event.preventDefault();
    const now = new Date(`${today}T12:00:00`);
    const found = { from: customDateError(dates.from, now), to: customDateError(dates.to, now) };
    if (found.from || found.to) return fail(found);
    const { from, to } = dates;
    onApply(from <= to ? { from, to } : { from: to, to: from });
  }

  return (
    <form id={id} onSubmit={apply} noValidate aria-label="Custom range" className="min-w-0">
      <DateRangeFields
        id={id}
        value={dates}
        today={today}
        errors={errors}
        refs={refs}
        onChange={(end, date) => {
          setDates((current) => ({ ...current, [end]: date }));
          // Only this field's error goes: the other one may still be wrong.
          clear(end);
        }}
      />
      {/* Enter in a date field applies; the visible Apply is in the sheet's footer. */}
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
    </form>
  );
}

/**
 * The range's Applied count when no weekly goal is set: the headline number in a card of its own,
 * laid out like the goal card (label on top, the number large, left-aligned), with a quiet pointer
 * to the goal setting.
 */
function AppliedCard({ applied }: { applied: number }) {
  return (
    <div className="card flex min-w-0 flex-col gap-4 p-4">
      <dl className="min-w-0">
        <Count label="Applied" value={applied} size="lg" />
      </dl>
      <p className="text-xs text-muted-foreground">
        Set a weekly goal in Settings to track how each week is going.
      </p>
    </div>
  );
}

const card = 'card flex min-w-0 flex-col-reverse gap-0.5 p-2';

/**
 * A label and its number. `lg`: the Applied number alone in its card (no weekly goal), with
 * "applications submitted" beside it, like the goal card.
 */
function Count({
  label,
  value,
  size = 'md',
}: {
  label: string;
  value: number;
  size?: 'md' | 'lg';
}) {
  return size === 'lg' ? (
    <div className="flex flex-col gap-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-4xl leading-none font-semibold tabular-nums">{value}</span>{' '}
        <span className="text-sm text-muted-foreground">{applicationWord(value)} submitted</span>
      </dd>
    </div>
  ) : (
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
