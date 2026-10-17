import { forwardRef, type InputHTMLAttributes } from 'react';
import { formatAmount, numberFieldText, type NumberKind } from '@/lib/numberInput';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  kind: NumberKind;
  /** Defaults to the browser's; tests pass one. */
  locale?: string;
};

/**
 * A number field (spec §3): a text field that keeps only what a number can contain as it's
 * typed or pasted (`numberFieldText`), not `type="number"` (which takes "e", changes on scroll
 * and can't show grouping). An amount is shown grouped in the locale's style once it's left.
 */
export const NumberField = forwardRef<HTMLInputElement, Props>(function NumberField(
  { value, onChange, kind, locale, onBlur, ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode={kind === 'integer' ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(numberFieldText(event.target.value, kind, locale))}
      onBlur={(event) => {
        if (kind === 'amount') {
          const shown = formatAmount(value, locale);
          if (shown !== value) onChange(shown);
        }
        onBlur?.(event);
      }}
    />
  );
});
