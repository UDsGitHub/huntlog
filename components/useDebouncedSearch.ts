import { useEffect, useState } from 'react';

/** How long a search box waits after the last keystroke before it filters. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * A search box's text, held back until typing has paused for `delay` ms, so a list filters (and
 * re-freezes its order) once per pause rather than on every keystroke. A blank search passes at
 * once: clearing the box shows everything without a wait.
 */
export function useDebouncedSearch(value: string, delay = SEARCH_DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);
  const blank = value.trim() === '';
  if (blank && settled !== value) setSettled(value);
  useEffect(() => {
    if (blank) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, blank]);
  return settled;
}
