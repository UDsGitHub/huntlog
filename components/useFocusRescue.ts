import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Calls `rescue` if the element still has focus inside it when it unmounts (a row that a live
 * update removed, an empty state replaced by a list), so focus doesn't fall to the page.
 * Layout-effect cleanup runs while the element is still in the page, so its focus is still known.
 */
export function useFocusRescue(element: RefObject<HTMLElement | null>, rescue: () => void) {
  const latest = useRef(rescue);
  useLayoutEffect(() => {
    latest.current = rescue;
  });
  useLayoutEffect(() => {
    const node = element.current;
    return () => {
      if (node?.contains(document.activeElement)) latest.current();
    };
  }, [element]);
}
