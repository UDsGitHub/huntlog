import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { foldText } from '@/lib/listQuery';
import { CheckIcon, ChevronDownIcon } from './icons';
import { rovingIndex } from './rovingIndex';
import { isSubmitShortcut } from './submitShortcut';
import { OPTION_HEIGHT, useDropDirection } from './useDropDirection';

export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface Props {
  id: string;
  value: string;
  /** Options, or labeled groups of them (e.g. Active / Closed). */
  options: (SelectOption | SelectGroup)[];
  onChange: (value: string) => void;
  name?: string;
  /** The list's name, e.g. "Statuses" (the button's own name is its label). */
  listLabel: string;
  /** Ids describing the field (hint, error). */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /** Receives the button (e.g. to focus it for an error). */
  buttonRef?: Ref<HTMLButtonElement>;
}

const isGroup = (item: SelectOption | SelectGroup): item is SelectGroup => 'options' in item;

/** How long typed letters keep adding to one search (typeahead). */
const TYPEAHEAD_MS = 500;

/**
 * A select (spec §3, shadcn's look; ARIA's select-only combobox): a button showing the choice,
 * opening a list of options. The button keeps focus throughout, pointing at the highlighted
 * option. Closed: Enter, Space, Up or Down open it on the choice; Home and End open it at either
 * end; typing letters opens it on the first match. Open: Up, Down, Home, End and typing move the
 * highlight without choosing; Enter or Space chooses and closes; Escape and Tab close without
 * choosing (Escape on a closed select is left to the sheet around it). A click chooses too.
 * A `<label htmlFor>` names it (a button is labelable).
 */
export function Select({
  id,
  value,
  options,
  onChange,
  name,
  listLabel,
  buttonRef,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: Props) {
  const listId = `${id}-list`;
  const flat = options.flatMap((item) => (isGroup(item) ? item.options : [item]));
  const optionId = (index: number) => `${id}-option-${index}`;
  const chosen = flat.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const { direction, measure } = useDropDirection(root);

  // The highlighted option stays in view as it moves through a long list.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView?.({
      block: 'nearest',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function show(index: number) {
    setActive(Math.max(0, Math.min(index, flat.length - 1)));
    // Options plus group headings, each about a row tall.
    const groups = options.filter(isGroup).length;
    if (!open) measure((flat.length + groups) * OPTION_HEIGHT + 8);
    setOpen(true);
  }
  function choose(index: number) {
    const option = flat[index];
    if (option && option.value !== value) onChange(option.value);
    setOpen(false);
  }
  /** The next option (after the highlighted one) whose label starts with what's typed. */
  function typeahead(key: string, now: number): number | undefined {
    const text = now - typed.current.at < TYPEAHEAD_MS ? typed.current.text + key : key;
    typed.current = { text, at: now };
    const needle = foldText(text);
    const from = open ? active : Math.max(chosen, 0);
    // A new search starts after the current option; a longer one can stay on it.
    const start = text.length === 1 ? from + 1 : from;
    for (let step = 0; step < flat.length; step++) {
      const index = (start + step) % flat.length;
      if (foldText(flat[index]!.label).startsWith(needle)) return index;
    }
    return undefined;
  }

  function onKeyDown(event: KeyboardEvent) {
    // ⌘/Ctrl+Enter on an open list picks the highlighted option, like Enter, rather than reaching
    // the sheet's submit shortcut with the list still open (a closed one leaves it to the sheet).
    if (open && isSubmitShortcut(event)) {
      event.preventDefault();
      choose(active);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    const last = flat.length - 1;
    // Any other key (an arrow, Escape) ends a typed search, so the next letter starts afresh.
    if (key.length !== 1 || key === ' ') typed.current.text = '';
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(key)) {
        event.preventDefault();
        show(Math.max(chosen, 0));
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault();
        show(key === 'Home' ? 0 : last);
      } else if (key.length === 1 && key !== ' ') {
        const match = typeahead(key, event.timeStamp);
        if (match !== undefined) show(match);
      }
      return;
    }
    const to = rovingIndex(key, active, flat.length, {
      next: 'ArrowDown',
      previous: 'ArrowUp',
      wrap: false,
    });
    if (to !== undefined) {
      event.preventDefault();
      setActive(to);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (key === 'Escape') {
      // Closes the list only, not the sheet around it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (key === 'Tab') {
      setOpen(false);
    } else if (key.length === 1) {
      const match = typeahead(key, event.timeStamp);
      if (match !== undefined) setActive(match);
    }
  }

  const positions = new Map(flat.map((option, at) => [option.value, at]));
  const renderOption = (option: SelectOption) => {
    const at = positions.get(option.value)!;
    const selected = option.value === value;
    return (
      <div
        key={option.value}
        id={optionId(at)}
        role="option"
        aria-selected={selected}
        // Keeps focus on the button, so choosing with the pointer doesn't blur it first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(at)}
        onMouseMove={() => setActive(at)}
        className={`flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm break-words ${
          at === active ? 'bg-accent text-accent-foreground' : ''
        } relative`}
      >
        {selected && <CheckIcon className="absolute left-2 size-4" />}
        {option.label}
      </div>
    );
  };

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={buttonRef}
        id={id}
        name={name}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        data-value={value}
        onClick={() => (open ? setOpen(false) : show(Math.max(chosen, 0)))}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className="field flex items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 truncate">{flat[chosen]?.label ?? ''}</span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          // A press anywhere in the list keeps focus on the button.
          onMouseDown={(event) => event.preventDefault()}
          data-direction={direction}
          className={`absolute inset-x-0 z-20 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg ${
            direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {options.map((item, group) =>
            isGroup(item) ? (
              <div key={item.label} role="group" aria-labelledby={`${id}-group-${group}`}>
                <div
                  id={`${id}-group-${group}`}
                  role="presentation"
                  className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {item.label}
                </div>
                {item.options.map(renderOption)}
              </div>
            ) : (
              renderOption(item)
            ),
          )}
        </div>
      )}
    </div>
  );
}
