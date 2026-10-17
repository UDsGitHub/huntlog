import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { TAB_SLIDE_MS } from './TabPanels';

/** Element ids for a tab and its panel; App and TabBar must agree, so both use these. */
export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

export interface Tab<Id extends string> {
  id: Id;
  label: string;
  /** Decorative: the label names the tab. */
  icon?: ReactNode;
}

/**
 * The panel's top tab bar (spec §3): an ARIA tablist with roving focus. Arrow keys, Home and End
 * move between tabs and select them (selection follows focus; switching is instant). Each tab
 * controls the panel with id `panelId(idPrefix, tab.id)`.
 */
export function TabBar<Id extends string>({
  tabs,
  selected,
  onSelect,
  idPrefix,
  label,
}: {
  tabs: Tab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  idPrefix: string;
  label: string;
}) {
  const buttons = useRef(new Map<Id, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent) {
    // Leave modified keys (e.g. Cmd+ArrowLeft) to the browser and assistive tech.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = tabs.findIndex((tab) => tab.id === selected);
    const to =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined;
    if (to === undefined) return;
    event.preventDefault();
    const next = tabs[to]!.id;
    onSelect(next);
    buttons.current.get(next)?.focus();
  }

  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selected),
  );
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      // Equal columns, so the underline can slide between them by its own width.
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      className="relative grid border-b border-border"
    >
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) buttons.current.set(tab.id, element);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={active}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`focus-ring flex min-w-0 flex-col items-center gap-1 rounded-t-md px-1 pt-1.5 pb-2 text-xs font-medium transition-colors ${
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            <span className="max-w-full truncate">{tab.label}</span>
          </button>
        );
      })}
      {/* The selected tab's underline, sliding to it (instantly under reduced motion). */}
      <span
        aria-hidden="true"
        style={{
          width: `${100 / tabs.length}%`,
          translate: `${index * 100}% 0`,
          transitionDuration: `${TAB_SLIDE_MS}ms`,
        }}
        className="pointer-events-none absolute bottom-[-1px] left-0 h-0.5 rounded-full bg-primary transition-[translate] ease-out motion-reduce:transition-none"
      />
    </div>
  );
}
