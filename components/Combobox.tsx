import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { foldText } from '@/lib/listQuery';
import { ChevronDownIcon } from './icons';
import { useDropDirection } from './useDropDirection';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface Props {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  /** Ids describing the field (hint, error). */
  describedBy?: string;
  invalid?: boolean;
  /** Receives the field (e.g. to focus it for an error). */
  inputRef?: (element: HTMLInputElement | null) => void;
  /** The listbox's name, e.g. "Resumes". */
  listLabel: string;
}

/**
 * A searchable dropdown (spec §4.2, the ARIA 1.2 combobox with a listbox): it shows the chosen
 * option; typing filters the options (accent- and case-insensitive), Up/Down move through them,
 * Enter picks, Escape closes (and restores the chosen one), and leaving the field without picking
 * restores it too. Escape on a closed list is left to the sheet around it.
 */
export function Combobox({
  id,
  value,
  options,
  onChange,
  describedBy,
  invalid,
  inputRef,
  listLabel,
}: Props) {
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const [open, setOpen] = useState(false);
  // What's typed while searching; null shows the chosen option's label.
  const [query, setQuery] = useState<string | null>(null);
  // The highlighted option, by value: it stays on the same option if the list changes under it.
  const [activeValue, setActiveValue] = useState<string | null>(null);
  // Set by a focus from the pointer: the mouseup that follows mustn't undo the selection.
  const keepSelection = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { direction, measure } = useDropDirection(root);
  const noMatches = useId();
  const setInput = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      inputRef?.(element);
    },
    [inputRef],
  );

  const chosen = options.find((option) => option.value === value);
  const needle = query === null ? null : foldText(query);
  const shown =
    needle === null ? options : options.filter((option) => foldText(option.label).includes(needle));
  const active = Math.max(
    0,
    shown.findIndex((option) => option.value === activeValue),
  );
  const setActive = (index: number) => setActiveValue(shown[index]?.value ?? null);

  function openList() {
    measure();
    setOpen(true);
    setActiveValue(query === null ? (chosen?.value ?? null) : (shown[0]?.value ?? null));
  }
  function close() {
    setOpen(false);
    setQuery(null);
  }
  function choose(option: ComboboxOption) {
    onChange(option.value);
    close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openList();
      if (shown.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + shown.length) % shown.length);
    } else if (event.key === 'Enter' && open) {
      // Picks rather than submitting the form.
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === 'Escape' && (open || query !== null)) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if ((event.key === 'Home' || event.key === 'End') && open && shown.length) {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : shown.length - 1);
    }
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <input
        ref={setInput}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // The empty choice (e.g. "No resume") shows as a placeholder, so typing starts clean.
        value={query ?? (chosen?.value ? chosen.label : '')}
        placeholder={options.find((option) => option.value === '')?.label}
        // Typing replaces the shown name rather than adding to it.
        onFocus={(event) => event.target.select()}
        onMouseDown={(event) => {
          if (document.activeElement !== event.currentTarget) keepSelection.current = true;
        }}
        onMouseUp={(event) => {
          // A click that focused the field would otherwise place the caret, undoing select().
          if (keepSelection.current) {
            keepSelection.current = false;
            event.preventDefault();
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (!open) measure();
          setOpen(true);
          // The first match is highlighted.
          setActiveValue(
            options.find((option) => foldText(option.label).includes(foldText(next)))?.value ??
              null,
          );
        }}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        onBlur={close}
        className="field pr-8"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Show ${listLabel.toLowerCase()}`}
        // Keeps focus in the field.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          input.current?.focus();
          if (open) close();
          else openList();
        }}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground"
      >
        <ChevronDownIcon />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          // A press anywhere in the list (its padding, its scrollbar) keeps focus in the field.
          onMouseDown={(event) => event.preventDefault()}
          data-direction={direction}
          className={`absolute inset-x-0 z-20 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg ${
            direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {shown.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              // Keeps focus in the field, so picking with the pointer doesn't blur it first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              onMouseMove={() => setActive(index)}
              className={`cursor-pointer rounded-sm px-2 py-1.5 text-sm break-words ${
                index === active ? 'bg-accent text-accent-foreground' : ''
              } ${option.value === value ? 'font-medium' : ''}`}
            >
              {option.label}
            </li>
          ))}
          {shown.length === 0 && (
            <li
              id={noMatches}
              role="presentation"
              className="px-2 py-1.5 text-sm text-muted-foreground"
            >
              No matches
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
