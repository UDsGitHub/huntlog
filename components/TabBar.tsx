import { useRef, type KeyboardEvent } from 'react';

export interface Tab<Id extends string> {
  id: Id;
  label: string;
}

/**
 * The panel's top tab bar (spec §3): an ARIA tablist with roving focus. Arrow keys, Home and End
 * move between tabs and select them (selection follows focus; switching is instant). Each tab
 * controls the panel with id `${idPrefix}-panel-${tab.id}`.
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
      className="flex gap-1 border-b border-slate-200"
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
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus:outline-2 focus:outline-indigo-600 ${
              active
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
