import { useEffect, useState } from 'react';
import { prefersReducedMotion } from './motion';

/** How long an accordion section takes to slide open or shut (`.details-panel`). */
export const COLLAPSE_MS = 250;

/**
 * Whether a section that was just collapsed is still sliding shut: keep it shown (and inert)
 * until then, then hide it. Never true under reduced motion, which hides it at once.
 */
export function useCollapsing(open: boolean): boolean {
  const [closing, setClosing] = useState(false);
  // Adjusted during render, not in an effect, so the section never flashes hidden first.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open && !prefersReducedMotion());
  }
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  return closing;
}
