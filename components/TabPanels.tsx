import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { inert } from './inert';
import { prefersReducedMotion } from './motion';

/** How long switching tabs slides for. Reduced motion skips it. */
export const TAB_SLIDE_MS = 250;

export type SlideDirection = 'forward' | 'back';

/**
 * Which tab is sliding out, and which way, after the selection changes (spec §3: the next section
 * slides into view). Moving to a tab further right slides forward (in from the right); further
 * left slides back. Nothing slides under reduced motion.
 */
export function useTabSlide<Id extends string>(selected: Id, order: readonly Id[]) {
  const [slide, setSlide] = useState<{
    selected: Id;
    leaving: Id | null;
    direction: SlideDirection;
  }>({ selected, leaving: null, direction: 'forward' });
  // Adjusted during render when the selection changes, so the first frame already slides.
  if (slide.selected !== selected) {
    setSlide({
      selected,
      // A switch during a slide is instant: restarting both sections mid-move would jump.
      leaving: prefersReducedMotion() || slide.leaving ? null : slide.selected,
      direction: order.indexOf(selected) > order.indexOf(slide.selected) ? 'forward' : 'back',
    });
  }
  useEffect(() => {
    if (!slide.leaving) return;
    const timer = setTimeout(
      () => setSlide((current) => ({ ...current, leaving: null })),
      TAB_SLIDE_MS,
    );
    return () => clearTimeout(timer);
  }, [slide.leaving, slide.selected]);
  return { leaving: slide.leaving, direction: slide.direction };
}

/** Where a section is: shown, sliding in or out, or out of sight. */
export type PanelState = 'shown' | 'entering' | 'leaving' | 'idle';

/** The state of tab `id`'s section, given the selection and what `useTabSlide` reports. */
export function panelState<Id extends string>(
  id: Id,
  selected: Id,
  leaving: Id | null,
): PanelState {
  if (id === selected) return leaving ? 'entering' : 'shown';
  return id === leaving ? 'leaving' : 'idle';
}

/**
 * One tab's section. Every section stays mounted, so it keeps its state, and each scrolls on its
 * own, so it keeps its scroll position too. Only the selected one can be used: one sliding out is
 * still painted but inert and hidden from assistive tech, and the rest are invisible.
 */
export function TabPanel({
  state,
  direction,
  children,
  className = '',
  ...props
}: {
  state: PanelState;
  direction: SlideDirection;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const active = state === 'shown' || state === 'entering';
  const slide = state === 'entering' ? 'in' : state === 'leaving' ? 'out' : undefined;
  return (
    <div
      {...props}
      {...inert(!active)}
      aria-hidden={active ? undefined : true}
      data-tab-panel=""
      data-active={active || undefined}
      data-slide={slide && `${slide}-${direction}`}
      style={{
        // One source for the duration: the CSS keyframes take it from here.
        animationDuration: `${TAB_SLIDE_MS}ms`,
        // Not display: none, which would lose the section's scroll position. content-visibility
        // keeps its rendering state but skips its layout and paint while it's out of sight.
        ...(state === 'idle' && { visibility: 'hidden', contentVisibility: 'hidden' }),
      }}
      className={`tab-panel absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-1 pb-4 ${className}`}
    >
      {children}
    </div>
  );
}
