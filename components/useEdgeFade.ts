import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/**
 * With scrollbars hidden (spec §3), an edge of a scroll area with more content beyond it fades
 * out, so the hidden content isn't missed. Follows scrolling, the area's size, its children's
 * sizes (e.g. a chip gaining its check mark), and `trigger` for content changes (a textarea's
 * `value`). Not the element's own input events: setting state there, before React's onChange,
 * re-renders a controlled field with its old value and the typed text is lost.
 */
export function useEdgeFade(
  ref: RefObject<HTMLElement | null>,
  axis: 'x' | 'y',
  /** How far the fade reaches in from the edge (a CSS length). */
  size: string,
  trigger?: unknown,
) {
  const [fade, setFade] = useState({ start: false, end: false });
  const update = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    update.current = () => {
      const [position, visible, total] =
        axis === 'x'
          ? [element.scrollLeft, element.clientWidth, element.scrollWidth]
          : [element.scrollTop, element.clientHeight, element.scrollHeight];
      const start = position > 1;
      const end = position + visible < total - 1;
      setFade((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    const run = () => update.current();
    run();
    element.addEventListener('scroll', run, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(run);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    return () => {
      element.removeEventListener('scroll', run);
      observer?.disconnect();
    };
  }, [ref, axis]);

  useLayoutEffect(() => update.current(), [trigger]);

  const direction = axis === 'x' ? 'to right' : 'to bottom';
  const style: CSSProperties | undefined =
    fade.start || fade.end
      ? {
          maskImage: `linear-gradient(${direction}, ${
            fade.start ? `transparent, black ${size}` : 'black'
          }, ${fade.end ? `black calc(100% - ${size}), transparent` : 'black'})`,
        }
      : undefined;
  return {
    style,
    attributes: {
      'data-fade-start': fade.start || undefined,
      'data-fade-end': fade.end || undefined,
    },
  };
}
