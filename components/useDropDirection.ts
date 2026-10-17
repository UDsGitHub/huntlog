import { useState, type RefObject } from 'react';

/** How tall a dropdown list can get (Tailwind's max-h-56). */
export const LIST_MAX = 224;
/** Roughly how tall one option row is, with the list's padding, for `measure`. */
export const OPTION_HEIGHT = 32;

/** The nearest ancestor whose edges clip a list (it scrolls, hides or clips); else the window. */
function scrollBounds(element: HTMLElement): { top: number; bottom: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'visible') {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

/**
 * Which way a dropdown opens: down, unless there isn't room for the list below the field within
 * whatever clips it (e.g. a sheet's scrolling body, near its sticky Save) and there's more room
 * above. Call `measure` as the list opens (from the event that opens it), with roughly how tall
 * the list will be, so a short list that fits below isn't flipped.
 */
export function useDropDirection(anchor: RefObject<HTMLElement | null>) {
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  function measure(listHeight = LIST_MAX) {
    const needed = Math.min(listHeight, LIST_MAX);
    const element = anchor.current;
    if (!element) return;
    const field = element.getBoundingClientRect();
    const bounds = scrollBounds(element);
    const below = bounds.bottom - field.bottom;
    const above = field.top - bounds.top;
    setDirection(below < needed && above > below ? 'up' : 'down');
  }
  return { direction, measure };
}
