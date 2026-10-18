import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inert } from './inert';
import { XIcon } from './icons';
import { prefersReducedMotion } from './motion';
import { useToastLayer } from './toastLayer';

export const TOAST_DURATION_MS = 5000;
/** How long a toast takes to slide out. Reduced motion skips it. */
export const TOAST_EXIT_MS = 150;

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
 * The bottom-of-panel toast. It disappears after 5 seconds, and the timer stops while the pointer
 * or keyboard focus is on it (WCAG 2.2.1), restarting in full when they leave. It slides in, and
 * slides out before it goes (spec §3).
 *
 * While a sheet is open, it shows inside that sheet, which keeps it visible and clickable over
 * the modal. Both the page and an open sheet have a polite live region that exists before any
 * toast arrives, so a new toast is announced wherever it appears. A toast that moves (a sheet
 * opened over it, or closed under it) arrives inside `aria-live="off"`: it was already announced
 * where it first appeared, so the move is silent, and its timer (kept here) doesn't restart.
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
  const layer = useToastLayer();
  const region = layer?.region ?? null;

  // Where the current toast first appeared (null: the page). Showing it anywhere else is a move.
  const [arrived, setArrived] = useState<{ id: number; region: HTMLElement | null } | null>(null);
  if ((toast?.id ?? null) !== (arrived?.id ?? null)) {
    setArrived(toast ? { id: toast.id, region } : null);
  }
  const moved = !!toast && arrived?.id === toast.id && arrived.region !== region;

  // Paused while the pointer or focus is on the card. Kept here, not in the card, so the card
  // moving between the page and a sheet doesn't restart the time.
  const [pause, setPause] = useState({ id: -1, hovered: false, focused: false });
  const paused = pause.id === toast?.id && (pause.hovered || pause.focused);
  const reportPause = useCallback(
    (id: number, change: { hovered?: boolean; focused?: boolean }) =>
      setPause((current) => {
        const base = current.id === id ? current : { id, hovered: false, focused: false };
        return { ...base, ...change };
      }),
    [],
  );
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(() => onDismiss('timeout'), duration);
    return () => clearTimeout(timer);
  }, [toast, paused, duration, onDismiss]);

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

  // Keyed per toast, so nothing carries over to the next one.
  const current = toast ?? leaving;
  const card = current && (
    <div
      key={current.id}
      aria-live={moved ? 'off' : undefined}
      className="flex w-full justify-center"
    >
      <ToastCard toast={current} onDismiss={onDismiss} onPause={reportPause} leaving={!toast} />
    </div>
  );

  return (
    <>
      {/* The page's region: always mounted, so a toast appearing in it is announced. */}
      <div
        aria-live="polite"
        // Clear of the floating button when it shows (it publishes the room it takes). Inside a
        // sheet, its region already sits above the sheet's footer.
        style={{ bottom: 'calc(var(--fab-clearance, 0px) + 1rem)' }}
        // Above everything on the page: the rows' chips and links (z-10) and the floating button.
        className="pointer-events-none fixed inset-x-4 z-30 flex justify-center"
      >
        {!region && card}
      </div>
      {region && card && createPortal(card, region)}
    </>
  );
}

function ToastCard({
  toast,
  onDismiss,
  onPause,
  leaving = false,
}: {
  toast: ToastData;
  onDismiss: (reason: DismissReason) => void;
  onPause: (id: number, change: { hovered?: boolean; focused?: boolean }) => void;
  /** Sliding out: shown, but no longer usable or announced. */
  leaving?: boolean;
}) {
  const { id } = toast;
  // Moved (remounted) or gone: no pointer or focus is on this card any more.
  useEffect(() => () => onPause(id, { hovered: false, focused: false }), [id, onPause]);

  return (
    <div
      {...inert(leaving)}
      // Sliding out: still painted, but gone for assistive tech.
      aria-hidden={leaving || undefined}
      data-state={leaving ? 'closing' : 'open'}
      onMouseEnter={() => onPause(id, { hovered: true })}
      onMouseLeave={() => onPause(id, { hovered: false })}
      onFocus={() => onPause(id, { focused: true })}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPause(id, { focused: false });
      }}
      className={`toast flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg ${leaving ? 'pointer-events-none' : 'pointer-events-auto'}`}
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {/* The action and close sit together, closer than the gap to the message. */}
      <div className="flex shrink-0 items-center gap-1">
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
    </div>
  );
}
