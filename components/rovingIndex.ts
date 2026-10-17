/**
 * Where a roving-focus key moves to, or undefined for any other key: the shared rule for the
 * tab bar (Left/Right), the status list and selects (Up/Down). Home and End go to either end.
 * It wraps around, unless `wrap` is false (a select's list stops at its ends).
 */
export function rovingIndex(
  key: string,
  index: number,
  length: number,
  { next, previous, wrap = true }: { next: string; previous: string; wrap?: boolean },
): number | undefined {
  if (key === next) return wrap ? (index + 1) % length : Math.min(index + 1, length - 1);
  if (key === previous) return wrap ? (index - 1 + length) % length : Math.max(index - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return undefined;
}
