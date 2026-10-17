import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Field errors for a small form: each linked to its field (`described`, `errorText`), and on
 * `fail` the first invalid field (in `order`) takes focus once its error has rendered.
 */
export function useFieldErrors<K extends string>(
  id: string,
  order: readonly K[],
  refs: Record<K, RefObject<HTMLElement | null>>,
) {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const pendingFocus = useRef<K | null>(null);
  useLayoutEffect(() => {
    const field = pendingFocus.current;
    if (!field) return;
    pendingFocus.current = null;
    refs[field].current?.focus();
  }, [errors, refs]);

  function fail(fields: Partial<Record<K, string>>) {
    pendingFocus.current = order.find((field) => fields[field]) ?? null;
    setErrors(fields);
  }
  const errorId = (field: K) => `${id}-${field}-error`;
  /** aria-invalid, and aria-describedby joining the hints given with the error. */
  function described(field: K, ...hints: (string | false)[]) {
    const ids = [...hints, errors[field] && errorId(field)].filter(Boolean).join(' ');
    return {
      'aria-invalid': errors[field] ? (true as const) : undefined,
      'aria-describedby': ids || undefined,
    };
  }
  const errorText = (field: K) =>
    errors[field] && (
      <p id={errorId(field)} className="field-error">
        {errors[field]}
      </p>
    );
  return { errors, fail, clear: () => setErrors({}), described, errorText };
}
