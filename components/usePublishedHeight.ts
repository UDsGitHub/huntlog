import { useLayoutEffect, type RefObject } from 'react';

/**
 * Publishes the room an element takes at the bottom of the panel as a CSS variable on <html>
 * while it's mounted, kept current as it resizes, so toasts and scrolling keep clear of it.
 * `withBottomOffset` adds its `bottom` offset, for a floating element.
 */
export function usePublishedHeight(
  ref: RefObject<HTMLElement | null>,
  variable: string,
  { withBottomOffset = false }: { withBottomOffset?: boolean } = {},
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const publish = () => {
      const offset = withBottomOffset ? parseFloat(getComputedStyle(element).bottom) || 0 : 0;
      root.style.setProperty(variable, `${element.offsetHeight + offset}px`);
    };
    publish();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(variable);
    };
  }, [ref, variable, withBottomOffset]);
}
