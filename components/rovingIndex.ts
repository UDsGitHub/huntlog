/**
 * Where a roving-focus key moves to (wrapping), or undefined for any other key: the shared rule
 * for the tab bar (Left/Right) and the status list (Up/Down). Home and End go to either end.
 */
export function rovingIndex(
  key: string,
  index: number,
  length: number,
  { next, previous }: { next: string; previous: string },
): number | undefined {
  if (key === next) return (index + 1) % length;
  if (key === previous) return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return undefined;
}
