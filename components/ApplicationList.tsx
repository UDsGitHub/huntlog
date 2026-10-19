import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WORK_MODE_LABELS } from '@/lib/applicationInput';
import { listApplications, safeHref } from '@/lib/applications';
import { formatLocalDate, formatTimestampDate } from '@/lib/dates';
import {
  activeFilterCount,
  queryApplications,
  rankOf,
  withoutFilters,
  type ListQuery,
} from '@/lib/listQuery';
import { effectiveWeekStart } from '@/lib/settings';
import type { Application } from '@/lib/types';
import { ExternalLinkIcon, PlusIcon } from './icons';
import { ListControls } from './ListControls';
import { StatusChip, type StatusPick } from './StatusChip';
import { useDebouncedSearch } from './useDebouncedSearch';
import { useSettings } from './useSettings';
import { useToday } from './useToday';

interface Props {
  /** Opens a new application (the empty state's button). */
  onAdd: () => void;
  /** Changes each time the list is shown again (e.g. a form sheet over it has gone). */
  shown?: number;
  /**
   * A row just saved: if the refresh for `shown` came before it reached the live query, the
   * list refreshes once more when it arrives, so it sorts into place rather than sitting on top.
   */
  expectRow?: string;
  /** Search, filter and sort; kept by App so they survive opening a job and coming back. */
  query: ListQuery;
  onQueryChange: (query: ListQuery) => void;
  onOpen: (id: string) => void;
  onStatusPick: (application: Application, pick: StatusPick) => void;
  /** Focus this row once the list has loaded (focus returning from its detail view). */
  focusRowId?: string;
  onRowFocused?: () => void;
  /** The row is about to appear (just restored): keep waiting for it while it's missing. */
  awaitRow?: boolean;
  /** The requested row isn't in the list any more (deleted meanwhile). */
  onRowMissing?: () => void;
  /** False while a form sheet takes over (a capture): the filter sheet closes. */
  active?: boolean;
}

export function ApplicationList({
  onAdd,
  shown = 0,
  expectRow,
  query,
  onQueryChange,
  onOpen,
  onStatusPick,
  focusRowId,
  onRowFocused,
  awaitRow,
  onRowMissing,
  active = true,
}: Props) {
  const applications = useLiveQuery(() => listApplications(), []);
  const settings = useSettings();
  const today = useToday();
  // "Today" and the first day of the week, for the date filter's presets.
  const weekStartsOn = effectiveWeekStart(settings ?? {});
  const context = useMemo(
    () => ({ now: new Date(`${today}T12:00:00`), weekStartsOn }),
    [today, weekStartsOn],
  );
  // The search filters once typing pauses (the box itself shows every keystroke), so the list
  // isn't re-filtered and re-frozen per character.
  const settledSearch = useDebouncedSearch(query.search);
  const filter = useMemo(
    () => (settledSearch === query.search ? query : { ...query, search: settledSearch }),
    [query, settledSearch],
  );
  // While the list is on screen, a status change (which bumps `updatedAt`, and may stop the row
  // matching a status filter) mustn't move or hide the row under the pointer. Order and
  // membership are frozen per query (and per day, for the date presets); they refresh when the
  // query changes or the list is shown again. New rows still appear, at the top.
  // A date filter depends on the day and the week start; nothing else does, so only then do they
  // refresh the frozen list (spec §4.4: otherwise only a query change or showing it again does).
  // Shown again (`shown`) refreshes it too, like a remount would.
  const queryKey = JSON.stringify(
    filter.dates.kind === 'any' ? [filter, shown] : [filter, shown, today, weekStartsOn],
  );
  const [frozen, setFrozen] = useState<{
    queryKey: string;
    ranks: Map<string, number>;
    shown: Set<string>;
    /** The expected row, when it wasn't there yet at this refresh. */
    awaiting?: string;
  }>();
  const awaitedArrived =
    !!frozen?.awaiting && !!applications?.some((app) => app.id === frozen.awaiting);
  if (applications && (frozen?.queryKey !== queryKey || awaitedArrived)) {
    const fresh = queryApplications(applications, filter, context);
    const missing = expectRow && !applications.some((app) => app.id === expectRow);
    setFrozen({
      queryKey,
      ranks: rankOf(fresh),
      shown: new Set(fresh.map((app) => app.id)),
      awaiting: frozen?.queryKey !== queryKey && missing ? expectRow : undefined,
    });
  }
  const current = frozen?.queryKey === queryKey ? frozen : undefined;
  const visible = useMemo(
    () =>
      applications &&
      queryApplications(applications, filter, context, current?.ranks, current?.shown),
    [applications, filter, context, current],
  );
  const usedSources = useMemo(() => applications?.map((app) => app.source) ?? [], [applications]);
  const search = useRef<HTMLInputElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());

  // The request is cleared by the parent once handled, so a remount never replays it.
  // Re-runs as the live list changes, so an awaited row is focused as soon as it shows up.
  useLayoutEffect(() => {
    if (!applications || !focusRowId) return;
    const row = rowButtons.current.get(focusRowId);
    if (row) {
      row.focus();
      onRowFocused?.();
    } else if (!awaitRow || applications.some((app) => app.id === focusRowId)) {
      // Gone, or present but hidden by the search or filter: don't wait for it.
      onRowMissing?.();
    }
  }, [applications, focusRowId, awaitRow, onRowFocused, onRowMissing]);

  if (!applications || !visible) return null;
  if (applications.length === 0) {
    // Spec §4.2: an empty list also offers a full-size button, not just the floating one.
    return (
      <div className="flex flex-col items-stretch gap-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">No applications yet.</p>
        <button type="button" onClick={onAdd} className="btn btn-primary">
          <PlusIcon />
          Add your first application
        </button>
        <p className="text-xs text-muted-foreground">
          Tip: right-click any job posting and choose Add job to Huntlog to fill it in for you.
        </p>
      </div>
    );
  }

  const narrowed = filter.search.trim() !== '' || activeFilterCount(filter, context) > 0;
  function clear() {
    onQueryChange({ ...withoutFilters(query), search: '' });
    // The button may disappear with the line; keep focus in the controls.
    search.current?.focus();
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ListControls
        query={query}
        context={context}
        usedSources={usedSources}
        onChange={onQueryChange}
        searchRef={search}
        active={active}
      />
      {narrowed && visible.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {visible.length} of {applications.length}
          </span>
          <button type="button" onClick={clear} className="btn btn-ghost btn-sm">
            Clear
          </button>
        </div>
      )}
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">No applications match.</p>
          <button type="button" onClick={clear} className="btn btn-outline">
            Clear search and filters
          </button>
        </div>
      ) : (
        <ul aria-label="Applications" className="flex flex-col divide-y divide-border">
          {visible.map((app) => (
            <li key={app.id} className="py-1">
              <Row
                app={app}
                buttonRef={(element) => {
                  if (element) rowButtons.current.set(app.id, element);
                  else rowButtons.current.delete(app.id);
                }}
                onOpen={() => onOpen(app.id)}
                onStatusPick={(pick) => onStatusPick(app, pick)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One application (spec §4.4): the company and its status chip on top; below, location and work
 * mode, the title and the date, with the posting's link on the right. The company is the row's
 * button, and its ::after covers the whole card, so the card opens the job; the chip and the
 * link sit above that layer with their own actions (no nested controls).
 */
function Row({
  app,
  buttonRef,
  onOpen,
  onStatusPick,
}: {
  app: Application;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onStatusPick: (pick: StatusPick) => void;
}) {
  const href = safeHref(app.url);
  const where = [app.location, app.workMode && WORK_MODE_LABELS[app.workMode]]
    .filter(Boolean)
    .join(' · ');
  const name = `${app.company}${app.title ? `, ${app.title}` : ''}`;
  // Unique when several roles share a company.
  const linkLabel = `Open job posting for ${app.company}${app.title ? `: ${app.title}` : ''}`;
  return (
    <div className="list-row-lazy row-card -mx-2 flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          ref={buttonRef}
          onClick={onOpen}
          aria-label={name}
          // The full name on hover when it's cut off.
          title={app.company}
          className="row-open row-button min-w-0 flex-1 truncate text-left text-sm font-semibold"
        >
          {app.company}
        </button>
        <div className="relative z-10 shrink-0">
          <StatusChip application={app} onPick={onStatusPick} />
        </div>
      </div>
      {/* The text column stops well short of the link icon, so long text doesn't crowd it. */}
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex max-w-[65%] min-w-0 flex-1 flex-col gap-0.5">
          {where && <span className="truncate text-xs text-muted-foreground">{where}</span>}
          {app.title && <span className="text-sm break-words">{app.title}</span>}
          <span className="text-xs text-muted-foreground">
            {app.appliedAt
              ? `Applied ${formatLocalDate(app.appliedAt)}`
              : `Added ${formatTimestampDate(app.createdAt)}`}
          </span>
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={linkLabel}
            title={linkLabel}
            className="btn btn-ghost btn-icon relative z-10 size-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon />
          </a>
        ) : (
          // Not a web link (e.g. imported): shown as text, never as a link.
          <span
            title={app.url}
            className="max-w-28 shrink-0 truncate text-xs text-muted-foreground"
          >
            {app.url}
          </span>
        )}
      </div>
    </div>
  );
}
