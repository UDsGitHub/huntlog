import { useState, type RefObject } from 'react';

/** How tall a dropdown list can get (Tailwind's max-h-56). */
const LIST_MAX = 224;

/** The nearest ancestor that scrolls vertically, whose edges clip a list; else the window. */
function scrollBounds(element: HTMLElement): { top: number; bottom: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

/**
 * Which way a dropdown opens: down, unless there isn't room for the list below the field within
 * whatever clips it (e.g. a sheet's scrolling body, near its sticky Save) and there's more room
 * above. Call `measure` as the list opens (from the event that opens it).
 */
export function useDropDirection(anchor: RefObject<HTMLElement | null>) {
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  function measure() {
    const element = anchor.current;
    if (!element) return;
    const field = element.getBoundingClientRect();
    const bounds = scrollBounds(element);
    const below = bounds.bottom - field.bottom;
    const above = field.top - bounds.top;
    setDirection(below < LIST_MAX && above > below ? 'up' : 'down');
  }
  return { direction, measure };
}
