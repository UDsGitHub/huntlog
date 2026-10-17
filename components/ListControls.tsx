import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { todayLocal } from '@/lib/dates';
import {
  activeFilterCount,
  sameFiltersAndSort,
  DEFAULT_QUERY,
  groupState,
  toggleGroup,
  toggleStatus,
  withoutFilters,
  type DateFilterKind,
  type ListQuery,
  type QueryContext,
  type SortKey,
  type StatusGroup,
} from '@/lib/listQuery';
import { customDateError, customStart } from '@/lib/stats';
import { STATUS_LABELS, STATUSES } from '@/lib/status';
import { DateRangeFields } from './DateRangeFields';
import { CheckIcon, SearchIcon, SlidersHorizontalIcon } from './icons';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';

const SORT_LABELS: Record<SortKey, string> = {
  activity: 'Last activity',
  applied: 'Date applied',
  company: 'Company',
};

const DATE_LABELS: Record<DateFilterKind, string> = {
  any: 'Any time',
  'this-week': 'This week',
  'this-month': 'This month',
  'last-30-days': 'Last 30 days',
  custom: 'Custom',
};

const GROUP_LABELS: Record<StatusGroup, string> = { active: 'Active', closed: 'Closed' };

/**
 * Search, with a filter button beside it that opens the filter sheet (spec §4.4). The button
 * shows how many filters are on.
 */
export function ListControls({
  query,
  context,
  onChange,
  searchRef,
  active = true,
}: {
  /** False while a form sheet takes over (a capture): the filter sheet closes, its draft gone. */
  active?: boolean;
  query: ListQuery;
  /** Today and the first day of the week, as the list filters with them. */
  context: QueryContext;
  onChange: (query: ListQuery) => void;
  searchRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!active && open) setOpen(false);
  const count = activeFilterCount(query, context);
  return (
    <div role="search" aria-label="Find applications" className="flex min-w-0 gap-2">
      <div className="relative min-w-0 flex-1">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search
        </label>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          placeholder="Search applications"
          value={query.search}
          onChange={(event) => onChange({ ...query, search: event.target.value })}
          className="field pl-8"
        />
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count ? `Filters, ${count} on` : 'Filters'}
        aria-haspopup="dialog"
        className="btn btn-ghost btn-icon relative"
      >
        <SlidersHorizontalIcon />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-semibold text-primary-foreground"
          >
            {count}
          </span>
        )}
      </button>
      <FilterSheet
        open={open}
        query={query}
        context={context}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/**
 * Sort, Date applied and Status (spec §4.4), chosen as a draft: only Apply changes the list, and
 * closing the sheet any other way (Escape, ×, a click outside) discards the draft. Reset clears
 * the draft's filters and sort (still to be applied); the search isn't part of the sheet.
 */
function FilterSheet({
  open,
  query,
  context,
  onChange,
  onClose,
}: {
  open: boolean;
  query: ListQuery;
  context: QueryContext;
  onChange: (query: ListQuery) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(query);
  // Each opening starts from what the list shows.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(query);
  }
  const sheet = useRef<HTMLDivElement>(null);
  function apply() {
    // A Custom range with a missing or impossible date isn't applied: the sheet stays open on
    // the date that's wrong (its error already says why), as Stats' Custom range does.
    if (
      draft.dates.kind === 'custom' &&
      (customDateError(draft.dates.from, context.now) ||
        customDateError(draft.dates.to, context.now))
    ) {
      sheet.current?.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus();
      return;
    }
    // Only a real change applies, so a frozen list isn't refreshed for nothing (spec §4.4).
    if (!sameFiltersAndSort(draft, query)) onChange({ ...draft, search: query.search });
    onClose();
  }
  const resettable =
    draft.statuses.length > 0 || draft.dates.kind !== 'any' || draft.sort !== DEFAULT_QUERY.sort;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissible
      title="Filter and sort"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!resettable}
            onClick={() => setDraft({ ...withoutFilters(draft), sort: DEFAULT_QUERY.sort })}
            className="btn btn-outline flex-1"
          >
            Reset
          </button>
          <button type="button" onClick={apply} className="btn btn-primary flex-1">
            Apply
          </button>
        </div>
      }
    >
      <SegmentedControl
        legend="Sort by"
        options={(Object.keys(SORT_LABELS) as SortKey[]).map((value) => ({
          value,
          label: SORT_LABELS[value],
        }))}
        value={draft.sort}
        onChange={(sort) => setDraft({ ...draft, sort })}
      />
      <div ref={sheet} className="contents">
        <DateFilterField query={draft} context={context} onChange={setDraft} />
        <StatusChips query={draft} onChange={setDraft} />
      </div>
    </Sheet>
  );
}

/** A single choice as native radios (arrow keys move between them), drawn as chips. */
function ChoiceGroup<Value extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="field-label mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="chip has-[:checked]:chip-on has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Date applied: a preset, or Custom with From and To (spec §4.4). */
function DateFilterField({
  query,
  context,
  onChange,
}: {
  query: ListQuery;
  context: QueryContext;
  onChange: (query: ListQuery) => void;
}) {
  const id = useId();
  const { dates } = query;
  // The list's "today", so the fields and the filter always agree, past midnight too.
  const today = todayLocal(context.now);
  const errors =
    dates.kind === 'custom'
      ? {
          from: customDateError(dates.from, context.now),
          to: customDateError(dates.to, context.now),
        }
      : {};
  // Only while the dates really filter (an unfinished Custom range doesn't yet).
  const filtering = activeFilterCount({ ...query, statuses: [] }, context) > 0;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ChoiceGroup
        legend="Date applied"
        options={(Object.keys(DATE_LABELS) as DateFilterKind[]).map((value) => ({
          value,
          label: DATE_LABELS[value],
        }))}
        value={dates.kind}
        onChange={(kind) =>
          onChange({
            ...query,
            // The Custom dates stay while a preset is picked, so switching back finds them;
            // the first time, Custom starts from the last 30 days.
            dates: kind === 'custom' ? { kind, ...customStart(dates, today) } : { ...dates, kind },
          })
        }
      />
      {dates.kind === 'custom' && (
        <DateRangeFields
          id={id}
          value={dates}
          today={today}
          errors={errors}
          onChange={(end, date) =>
            onChange({ ...query, dates: { ...dates, [end]: date || undefined } })
          }
        />
      )}
      {filtering && (
        <p className="field-hint">Jobs without a date applied (such as Saved ones) are hidden.</p>
      )}
    </div>
  );
}

/**
 * Status chips (spec §4.4): any number can be on, none means every status. Active and Closed
 * turn on their whole group; they show "mixed" when only part of it is on.
 */
function StatusChips({
  query,
  onChange,
}: {
  query: ListQuery;
  onChange: (query: ListQuery) => void;
}) {
  const id = useId();
  const { statuses } = query;
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex min-w-0 flex-col gap-1.5">
      <p id={`${id}-label`} className="field-label mb-1.5">
        Status
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(GROUP_LABELS) as StatusGroup[]).map((group) => {
          const state = groupState(statuses, group);
          return (
            <Chip
              key={group}
              pressed={state === 'all' ? true : state === 'some' ? 'mixed' : false}
              onClick={() => onChange({ ...query, statuses: toggleGroup(statuses, group) })}
              strong
            >
              {GROUP_LABELS[group]}
            </Chip>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((status) => (
          <Chip
            key={status}
            pressed={statuses.includes(status)}
            onClick={() => onChange({ ...query, statuses: toggleStatus(statuses, status) })}
          >
            {STATUS_LABELS[status]}
          </Chip>
        ))}
      </div>
      <p className="field-hint">
        {statuses.length === 0 ? 'None chosen: every status shows.' : `${statuses.length} chosen.`}
      </p>
    </div>
  );
}

/** A toggle chip: a button with aria-pressed. */
function Chip({
  pressed,
  onClick,
  strong = false,
  children,
}: {
  pressed: boolean | 'mixed';
  onClick: () => void;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`chip focus-ring ${pressed === true ? 'chip-on' : pressed === 'mixed' ? 'chip-mixed' : ''} ${strong ? 'font-semibold' : ''}`}
    >
      {pressed === true && <CheckIcon className="size-3.5" />}
      {children}
    </button>
  );
}
