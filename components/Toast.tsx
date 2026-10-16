import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inert } from './inert';
import { XIcon } from './icons';
import { useToastSlot } from './toastLayer';

export const TOAST_DURATION_MS = 5000;
/** How long a toast takes to slide out. Reduced motion skips it. */
export const TOAST_EXIT_MS = 150;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Why a toast closed: it timed out, the user dismissed it, or the user took its action. */
export type DismissReason = 'timeout' | 'dismiss' | 'action';

/** Every way a toast goes: the DismissReasons, or replaced by a newer toast. */
export type CloseReason = DismissReason | 'replaced';

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; onAction: () => void };
  /**
   * Runs exactly once when this toast goes, however it goes, e.g. to finalize what its Undo
   * could have reverted. (If the panel closes first it never runs; callers clean up at startup.)
   */
  onClose?: (reason: CloseReason) => void;
}

/** One toast at a time: showing a new one replaces the old (and its Undo). */
export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const current = useRef<ToastData | null>(null);
  const nextId = useRef(0);
  const show = useCallback((data: Omit<ToastData, 'id'>) => {
    const previous = current.current;
    nextId.current += 1;
    current.current = { ...data, id: nextId.current };
    setToast(current.current);
    previous?.onClose?.('replaced');
  }, []);
  const dismiss = useCallback((reason: DismissReason = 'dismiss') => {
    const previous = current.current;
    current.current = null;
    setToast(null);
    previous?.onClose?.(reason);
  }, []);
  return { toast, show, dismiss };
}

/**
 * Bottom-of-panel toast in an always-mounted polite live region. It disappears after 5 seconds,
 * and the timer stops while the pointer or keyboard focus is on it (WCAG 2.2.1), restarting in
 * full when they leave. It slides in, and slides out before it goes (spec §3). While a sheet is
 * open, it shows inside that sheet, which keeps it visible and clickable over the modal.
 */
export function Toast({
  toast,
  onDismiss,
  duration = TOAST_DURATION_MS,
}: {
  toast: ToastData | null;
  onDismiss: (reason: DismissReason) => void;
  duration?: number;
}) {
  const slot = useToastSlot();
  // The toast that just went, kept on screen (inert) while it slides out.
  const [leaving, setLeaving] = useState<ToastData | null>(null);
  const shown = useRef<ToastData | null>(null);
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = toast;
    if (toast || !previous || prefersReducedMotion()) {
      setLeaving(null);
      return;
    }
    setLeaving(previous);
    const timer = setTimeout(() => setLeaving(null), TOAST_EXIT_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const region = (
    <div
      aria-live="polite"
      // Clear of a sticky bottom bar or the floating button when one is showing; each publishes
      // the room it takes. Inside a sheet, the slot already sits above its footer.
      style={
        slot
          ? undefined
          : {
              bottom: 'calc(var(--sticky-bar-height, 0px) + var(--fab-clearance, 0px) + 1rem)',
            }
      }
      className={
        slot
          ? 'flex w-full justify-center'
          : 'pointer-events-none fixed inset-x-4 flex justify-center'
      }
    >
      {/* Keyed per toast, so pause state never carries over to the next one. */}
      {toast ? (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
      ) : (
        leaving && (
          <ToastCard
            key={leaving.id}
            toast={leaving}
            onDismiss={onDismiss}
            duration={duration}
            leaving
          />
        )
      )}
    </div>
  );
  return slot ? createPortal(region, slot) : region;
}

function ToastCard({
  toast,
  onDismiss,
  duration,
  leaving = false,
}: {
  toast: ToastData;
  onDismiss: (reason: DismissReason) => void;
  duration: number;
  /** Sliding out: shown, but no longer usable or timed. */
  leaving?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused || leaving) return;
    const timer = setTimeout(() => onDismiss('timeout'), duration);
    return () => clearTimeout(timer);
  }, [paused, leaving, duration, onDismiss]);

  return (
    <div
      {...inert(leaving)}
      // Sliding out: still painted, but gone for assistive tech.
      aria-hidden={leaving || undefined}
      data-state={leaving ? 'closing' : 'open'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className={`toast flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg ${leaving ? 'pointer-events-none' : 'pointer-events-auto'}`}
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onAction();
            onDismiss('action');
          }}
          className="btn btn-outline btn-sm"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss('dismiss')}
        aria-label="Dismiss"
        className="btn btn-ghost btn-icon size-7 text-muted-foreground"
      >
        <XIcon />
      </button>
    </div>
  );
}

/**
 * Publishes a sticky bottom bar's height as `--sticky-bar-height` on the document while it's
 * mounted, so the toast and focus scrolling keep clear of it, whatever its size.
 */
export function useStickyBar(bar: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty('--sticky-bar-height', `${element.offsetHeight}px`);
    publish();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--sticky-bar-height');
    };
  }, [bar]);
}
