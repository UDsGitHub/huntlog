import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
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
 * Dropping a character keeps the caret where it was, rather than at the end.
 */
export const NumberField = forwardRef<HTMLInputElement, Props>(function NumberField(
  { value, onChange, kind, locale, onBlur, ...props },
  ref,
) {
  const own = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = own.current;
    if (caret.current === null || !element) return;
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <input
      {...props}
      ref={(element) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      type="text"
      inputMode={kind === 'integer' ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={value}
      onChange={(event) => {
        const raw = event.target.value;
        const kept = numberFieldText(raw, kind, locale);
        if (kept !== raw) {
          // Where the caret goes: after what's kept of the text before it.
          const before = raw.slice(0, event.target.selectionStart ?? raw.length);
          caret.current = numberFieldText(before, kind, locale).length;
          // React leaves the field alone if nothing changed; put the kept text back here.
          if (kept === value) {
            event.target.value = kept;
            event.target.setSelectionRange(caret.current, caret.current);
            caret.current = null;
          }
        }
        onChange(kept);
      }}
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
