import type { Status } from '@/lib/types';

/** Status colors, as literal Tailwind classes (so Tailwind finds them), from the theme tokens. */

/**
 * Chips: calm colors. Closed outcomes are neutral, never red: rejections aren't highlighted
 * (spec §4.7); offers and acceptances get the only accent.
 */
export const STATUS_CHIP: Record<Status, string> = {
  saved: 'bg-status-neutral text-status-neutral-foreground',
  applied: 'bg-status-progress text-status-progress-foreground',
  screening: 'bg-status-progress text-status-progress-foreground',
  interviewing: 'bg-status-progress-strong text-status-progress-strong-foreground',
  offer: 'bg-status-success text-status-success-foreground',
  accepted: 'bg-status-success-strong text-status-success-strong-foreground',
  rejected: 'bg-status-neutral text-status-neutral-foreground',
  withdrawn: 'bg-status-neutral text-status-neutral-foreground',
  ghosted: 'bg-status-neutral text-status-neutral-foreground',
};

// Swatches (chart segments, legend, timeline dots): every status gets its own color, so a segment
// matches its legend row: blues for progress, greens for offers, distinct calm grays and
// browns for the closed ones (Rejected is never red). Segments are separated by gaps and the
// bar is outlined, so even the lighter ones read against the panel.
export const STATUS_SWATCH: Record<Status, string> = {
  saved: 'bg-status-saved',
  applied: 'bg-status-applied',
  screening: 'bg-status-screening',
  interviewing: 'bg-status-interviewing',
  offer: 'bg-status-offer',
  accepted: 'bg-status-accepted',
  rejected: 'bg-status-rejected',
  withdrawn: 'bg-status-withdrawn',
  ghosted: 'bg-status-ghosted',
};
