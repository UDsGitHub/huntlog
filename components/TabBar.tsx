import { useRef, type KeyboardEvent } from 'react';

/** Element ids for a tab and its panel; App and TabBar must agree, so both use these. */
export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

export interface Tab<Id extends string> {
  id: Id;
  label: string;
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

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 border-b border-border"
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
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-ring ${
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
