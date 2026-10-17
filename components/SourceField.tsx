import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SOURCE_SUGGESTIONS } from '@/lib/applicationInput';
import { CheckIcon } from './icons';

/** The common sources as chips; "Other" is the chip that opens a text field. */
const CHIPS = SOURCE_SUGGESTIONS.filter((source) => source !== 'Other');
type Mode = (typeof CHIPS)[number] | 'other' | null;

function modeOf(value: string): Mode {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return CHIPS.find((chip) => chip.toLowerCase() === trimmed.toLowerCase()) ?? 'other';
}

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** The Other field, e.g. so an error can focus it. */
  inputRef?: (element: HTMLInputElement | null) => void;
}

/**
 * Source (spec §4.2): one tap on a chip (LinkedIn, Indeed, Company site, Referral, Recruiter),
 * or Other… for anything else, which opens a short text field. Tapping the chosen chip again
 * clears it (Source is optional). Toggle buttons, so the arrow keys don't change the choice.
 */
export function SourceField({ id, value, onChange, error, inputRef }: Props) {
  // Which chip is on. Kept as state, so typing "Indeed" into Other doesn't jump to that chip.
  const [mode, setMode] = useState<Mode>(() => modeOf(value));
  const other = useRef<HTMLInputElement | null>(null);
  const focusOther = useRef(false);

  useLayoutEffect(() => {
    if (mode === 'other' && focusOther.current) {
      focusOther.current = false;
      other.current?.focus();
    }
  }, [mode]);

  function pick(next: Mode) {
    if (next === mode) {
      setMode(null);
      onChange('');
    } else if (next === 'other') {
      focusOther.current = true;
      setMode('other');
      // A chip's value isn't kept as the other source's text.
      if (mode !== null) onChange('');
    } else {
      setMode(next);
      onChange(next ?? '');
    }
  }

  const errorId = `${id}-error`;
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex min-w-0 flex-col gap-1.5">
      <p id={`${id}-label`} className="field-label">
        Source <span className="font-normal text-muted-foreground">(optional)</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((chip) => (
          <Chip key={chip} pressed={mode === chip} onClick={() => pick(chip)}>
            {chip}
          </Chip>
        ))}
        <Chip pressed={mode === 'other'} onClick={() => pick('other')}>
          Other…
        </Chip>
      </div>
      {mode === 'other' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium">
            Other source
          </label>
          <input
            ref={(element) => {
              other.current = element;
              inputRef?.(element);
            }}
            id={id}
            name="source"
            type="text"
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="field"
          />
        </div>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`chip focus-ring ${pressed ? 'chip-on' : ''}`}
    >
      {pressed && <CheckIcon className="size-3.5" />}
      {children}
    </button>
  );
}
