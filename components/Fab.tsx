import { forwardRef, useRef, type ReactNode } from 'react';
import { usePublishedHeight } from './usePublishedHeight';

/**
 * A floating action button at the bottom right of the panel (spec §3): an icon and a short
 * label, with a fuller accessible name ("Add application" for a visible "Add"). While mounted it
 * publishes the space it takes as `--fab-clearance`, so toasts sit above it and lists can pad
 * their end clear of it.
 */
export const Fab = forwardRef<
  HTMLButtonElement,
  { label: string; icon: ReactNode; children: ReactNode; onClick: () => void }
>(function Fab({ label, icon, children, onClick }, ref) {
  const own = useRef<HTMLButtonElement | null>(null);
  usePublishedHeight(own, '--fab-clearance', { withBottomOffset: true });
  return (
    <button
      ref={(element) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      type="button"
      aria-label={label}
      onClick={onClick}
      className="btn btn-primary fixed right-4 bottom-4 z-10 h-11 rounded-full px-5 shadow-lg"
    >
      {icon}
      {children}
    </button>
  );
});
