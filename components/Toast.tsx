import { useCallback, useEffect, useRef, useState } from 'react';

export const TOAST_DURATION_MS = 5000;

/** Why a toast closed: it timed out, the user dismissed it, or the user took its action. */
export type DismissReason = 'timeout' | 'dismiss' | 'action';

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; onAction: () => void };
}

/** One toast at a time: showing a new one replaces the old (and its Undo). */
export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const nextId = useRef(0);
  const show = useCallback((data: Omit<ToastData, 'id'>) => {
    nextId.current += 1;
    setToast({ ...data, id: nextId.current });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}

/**
 * Bottom-of-panel toast in an always-mounted polite live region. It disappears after 5 seconds,
 * and the timer stops while the pointer or keyboard focus is on it (WCAG 2.2.1), restarting in
 * full when they leave.
 */
export function Toast({
  toast,
  onDismiss,
  duration = TOAST_DURATION_MS,
  raised = false,
}: {
  toast: ToastData | null;
  onDismiss: (reason: DismissReason) => void;
  duration?: number;
  /** Sit higher, clear of a sticky bottom bar. */
  raised?: boolean;
}) {
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-4 flex justify-center ${raised ? 'bottom-20' : 'bottom-4'}`}
    >
      {/* Keyed per toast, so pause state never carries over to the next one. */}
      {toast && (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
      )}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
  duration,
}: {
  toast: ToastData;
  onDismiss: (reason: DismissReason) => void;
  duration: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss('timeout'), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, onDismiss]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className="pointer-events-auto flex w-full max-w-sm min-w-0 items-center gap-3 rounded bg-slate-900 px-3 py-2 text-sm text-white shadow-lg"
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onAction();
            onDismiss('action');
          }}
          className="rounded px-2 py-1 font-semibold text-indigo-200 underline hover:text-white focus:outline-2 focus:outline-white"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss('dismiss')}
        aria-label="Dismiss"
        className="rounded px-1.5 py-1 text-slate-300 hover:text-white focus:outline-2 focus:outline-white"
      >
        ×
      </button>
    </div>
  );
}
