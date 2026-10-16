import { useId, type Ref } from 'react';
import { isSortKey, isStatusFilter, type ListQuery, type SortKey } from '@/lib/listQuery';
import { ACTIVE_STATUSES, CLOSED_STATUSES, STATUS_LABELS } from '@/lib/status';

const SORT_LABELS: Record<SortKey, string> = {
  activity: 'Last activity',
  applied: 'Date applied',
  company: 'Company',
};

/** Search, status filter and sort for the list (spec §4.4), with visible labels. */
export function ListControls({
  query,
  onChange,
  searchRef,
}: {
  query: ListQuery;
  onChange: (query: ListQuery) => void;
  searchRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div role="search" aria-label="Find applications" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-search`} className="text-xs font-medium">
          Search
        </label>
        <input
          ref={searchRef}
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          placeholder="Company, title, location or notes"
          value={query.search}
          onChange={(event) => onChange({ ...query, search: event.target.value })}
          className="field"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-filter`} className="text-xs font-medium">
            Show
          </label>
          <select
            id={`${id}-filter`}
            value={query.filter}
            onChange={(event) =>
              isStatusFilter(event.target.value) &&
              onChange({ ...query, filter: event.target.value })
            }
            className="field"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <optgroup label="Active">
              {ACTIVE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Closed">
              {CLOSED_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-sort`} className="text-xs font-medium">
            Sort by
          </label>
          <select
            id={`${id}-sort`}
            value={query.sort}
            onChange={(event) =>
              isSortKey(event.target.value) && onChange({ ...query, sort: event.target.value })
            }
            className="field"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
