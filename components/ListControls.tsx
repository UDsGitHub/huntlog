import { useId, useState, type ReactNode, type Ref } from 'react';
import { MIN_YEAR, todayLocal } from '@/lib/dates';
import {
  activeFilterCount,
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
import { CheckIcon, SearchIcon, SlidersHorizontalIcon } from './icons';
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
}: {
  query: ListQuery;
  /** Today and the first day of the week, as the list filters with them. */
  context: QueryContext;
  onChange: (query: ListQuery) => void;
  searchRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
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
        className="btn btn-outline btn-icon relative"
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
 * Sort, Date applied and Status (spec §4.4). Changes apply as they're made; Reset clears the
 * filters and the sort (not the search), Done closes.
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
  const changed =
    query.statuses.length > 0 || query.dates.kind !== 'any' || query.sort !== DEFAULT_QUERY.sort;
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
            disabled={!changed}
            onClick={() => onChange({ ...withoutFilters(query), sort: DEFAULT_QUERY.sort })}
            className="btn btn-outline flex-1"
          >
            Reset
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary flex-1">
            Done
          </button>
        </div>
      }
    >
      <ChoiceGroup
        legend="Sort by"
        options={(Object.keys(SORT_LABELS) as SortKey[]).map((value) => ({
          value,
          label: SORT_LABELS[value],
        }))}
        value={query.sort}
        onChange={(sort) => onChange({ ...query, sort })}
        layout="segmented"
      />
      <DateFilterField query={query} context={context} onChange={onChange} />
      <StatusChips query={query} onChange={onChange} />
    </Sheet>
  );
}

/** A single choice as native radios (arrow keys move between them), drawn as chips or segments. */
function ChoiceGroup<Value extends string>({
  legend,
  options,
  value,
  onChange,
  layout,
}: {
  legend: string;
  options: { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  layout: 'segmented' | 'chips';
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="field-label mb-1.5">{legend}</legend>
      <div
        className={
          layout === 'segmented'
            ? 'grid grid-cols-3 gap-1 rounded-lg bg-muted p-1'
            : 'flex flex-wrap gap-1.5'
        }
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={
              layout === 'segmented'
                ? 'flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-center text-sm font-medium text-muted-foreground transition-colors has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring'
                : 'chip has-[:checked]:chip-on has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring'
            }
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
        layout="chips"
      />
      {dates.kind === 'custom' && (
        <fieldset className="flex min-w-0 gap-2">
          <legend className="sr-only">Custom dates</legend>
          {(['from', 'to'] as const).map((end) => (
            <div key={end} className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={`${id}-${end}`} className="field-label">
                {end === 'from' ? 'From' : 'To'}
              </label>
              <input
                id={`${id}-${end}`}
                type="date"
                min={`${MIN_YEAR}-01-01`}
                max={today}
                value={dates[end] ?? ''}
                onChange={(event) =>
                  onChange({
                    ...query,
                    dates: { ...dates, [end]: event.target.value || undefined },
                  })
                }
                aria-invalid={errors[end] ? true : undefined}
                aria-describedby={errors[end] ? `${id}-${end}-error` : undefined}
                className="field"
              />
              {errors[end] && (
                <p id={`${id}-${end}-error`} className="field-error">
                  {errors[end]}
                </p>
              )}
            </div>
          ))}
        </fieldset>
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
