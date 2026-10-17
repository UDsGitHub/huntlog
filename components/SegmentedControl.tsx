import { useId, type CSSProperties, type ReactNode } from 'react';

export interface Segment<Value extends string> {
  value: Value;
  label: string;
  /** Decorative, before the label. */
  icon?: ReactNode;
}

/**
 * A single choice as a segmented control (shadcn's tabs look): native radios, so arrow keys
 * move between them and the group is announced as one. A marker slides under the chosen segment
 * (instant under reduced motion). Its size and travel come from the same padding and gap
 * variables the grid uses, so the two can't drift apart.
 */
export function SegmentedControl<Value extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Segment<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const name = useId();
  const chosen = options.findIndex((option) => option.value === value);
  const count = options.length;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="field-label mb-1.5">{legend}</legend>
      <div
        className="relative grid gap-(--seg-gap) rounded-lg bg-muted p-(--seg-pad)"
        style={
          {
            '--seg-pad': '0.25rem',
            '--seg-gap': '0.25rem',
            gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
          } as CSSProperties
        }
      >
        {chosen >= 0 && (
          <span
            aria-hidden="true"
            data-marker=""
            className="absolute inset-y-(--seg-pad) left-(--seg-pad) rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              width: `calc((100% - 2 * var(--seg-pad) - ${count - 1} * var(--seg-gap)) / ${count})`,
              transform: `translateX(calc(${chosen} * (100% + var(--seg-gap))))`,
            }}
          />
        )}
        {options.map((option) => (
          <label
            key={option.value}
            className="relative flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-center text-sm font-medium text-muted-foreground transition-colors has-[:checked]:text-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
