import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowLeftIcon, XIcon } from './icons';
import { inert } from './inert';
import { prefersReducedMotion } from './motion';
import { registerToastLayer } from './toastLayer';

/** How long the slide in or out takes. Reduced motion skips it. */
export const SHEET_ANIMATION_MS = 200;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  /** Asked to close: Escape, the header button, or (when `dismissible`) a click outside. */
  onClose: () => void;
  /** After the slide-out finishes and the dialog has closed. */
  onClosed?: () => void;
  title: string;
  /** Optional line under the title. */
  description?: ReactNode;
  children: ReactNode;
  /** Sticky bottom area, e.g. a full-width Save. */
  footer?: ReactNode;
  /**
   * A click outside closes the sheet. On for sheets without typing (status, filters, menus); off
   * for ones that hold typing (forms, uploads, renames), so a stray click can't lose it (spec §3).
   */
  dismissible?: boolean;
  /** Unsaved changes: closing asks to discard them first. */
  dirty?: boolean;
  /** The header button: back arrow (a page-like sheet such as a form) or close (×). */
  closeButton?: 'back' | 'close';
  /** Near full height (forms) instead of fitting its content. */
  size?: 'auto' | 'full';
  /** What gets focus when the sheet opens. Defaults to the first control in its body. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * A bottom sheet (spec §3): a native modal <dialog> that slides up over the panel. The rest of
 * the panel is inert while it's open, Escape and the header button close it, and focus returns
 * to where it was. Toasts show inside it while it's open (see `toastLayer`).
 */
export function Sheet({
  open,
  onClose,
  onClosed,
  title,
  description,
  children,
  footer,
  dismissible = false,
  dirty = false,
  closeButton = 'close',
  size = 'auto',
  initialFocus,
}: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const toastRegion = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Set from showModal until the dialog has closed: this sheet's toast layer.
  const unregisterLayer = useRef<(() => void) | null>(null);
  // What had focus when the discard question opened, to go back to on Keep editing.
  const confirmFrom = useRef<HTMLElement | null>(null);
  // A press that started on the dimmed area (not a drag that ended there).
  const pressedOutside = useRef(false);
  const [confirming, setConfirming] = useState(false);
  // Each opening starts without the discard question (state adjusted during render, not in an
  // effect, so there's no extra render pass).
  const [wasOpen, setWasOpen] = useState(open);
  // Its content exists only from opening until it has finished closing: a closed sheet adds
  // nothing to the page (no hidden fields, no duplicate labels).
  const [mounted, setMounted] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setConfirming(false);
      setMounted(true);
    }
  }
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  /** Closes the dialog for good: toasts move back to the page, and focus goes back. */
  function finishClosing(element: HTMLDialogElement, { unmounting = false } = {}) {
    if (element.open) element.close();
    // Gone anyway when the whole sheet is unmounting: no state to set.
    if (!unmounting) setMounted(false);
    unregisterLayer.current?.();
    unregisterLayer.current = null;
    // Back to the opener, unless something else already took focus.
    const opener = returnFocus.current;
    returnFocus.current = null;
    const active = document.activeElement;
    if (opener?.isConnected && (!active || active === document.body || element.contains(active))) {
      opener.focus();
    }
    onClosedRef.current?.();
  }
  const finishRef = useRef(finishClosing);
  useEffect(() => {
    finishRef.current = finishClosing;
  });

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element.showModal();
        // Registered as it enters the top layer, so the newest layer is the one on top.
        if (toastRegion.current) {
          unregisterLayer.current = registerToastLayer({ region: toastRegion.current });
        }
      }
      const target =
        initialFocus?.current ?? body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
      (target ?? element).focus();
      return;
    }
    if (!element.open) return;
    // Slides out (data-state="closing", everything inert), then closes. Toasts stay in it until
    // then: the page behind is still inert while it slides out.
    if (prefersReducedMotion()) {
      finishRef.current(element);
      return;
    }
    const timer = setTimeout(() => finishRef.current(element), SHEET_ANIMATION_MS);
    return () => clearTimeout(timer);
    // initialFocus is read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Unmounting while open or sliding out (e.g. the view behind it went away) still closes the
  // dialog properly: toasts go back to the page, focus is returned, and onClosed runs.
  useEffect(() => {
    const element = dialog.current;
    return () => {
      if (element && (element.open || unregisterLayer.current)) {
        finishRef.current(element, { unmounting: true });
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (confirming) keepEditing.current?.focus();
    else if (confirmFrom.current) {
      confirmFrom.current.focus();
      confirmFrom.current = null;
    }
  }, [confirming]);

  function requestClose() {
    if (!open || confirming) return;
    if (dirty) {
      confirmFrom.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirming(true);
    } else onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    // Handled here rather than by the dialog's own cancel, so every close goes one way.
    event.preventDefault();
    event.stopPropagation();
    if (confirming) setConfirming(false);
    else requestClose();
  }

  // A click on the dialog itself, not its panel, is a click on the dimmed area outside. Both the
  // press and the release must be there: a text selection dragged out of the panel isn't one.
  function onPointerDown(event: PointerEvent) {
    pressedOutside.current = event.target === dialog.current;
  }
  function onClick(event: MouseEvent) {
    const outside = pressedOutside.current && event.target === dialog.current;
    pressedOutside.current = false;
    if (outside && dismissible) requestClose();
  }

  // Sliding out: nothing in it can be used any more (a second click on Save does nothing).
  // Asking to discard: only the question can be used.
  const panelInert = !open || confirming;

  return (
    // The dialog fills the panel; its ::backdrop dims the page and the panel slides up from the
    // bottom. Escape is handled on keydown (see onKeyDown); cancel is a fallback for other
    // close requests.
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      // While open: 'open'. Once asked to close, it stays shown just long enough to slide out.
      data-state={open ? 'open' : 'closing'}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="sheet m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-foreground"
    >
      {mounted && (
        <div
          className={`sheet-panel absolute inset-x-0 bottom-0 flex flex-col rounded-t-xl border-t bg-background shadow-xl ${
            size === 'full' ? 'h-[calc(100%-0.75rem)]' : 'max-h-[calc(100%-2rem)]'
          }`}
        >
          <div {...inert(panelInert)} className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-2">
            {closeButton === 'back' && (
              <button
                type="button"
                onClick={requestClose}
                aria-label="Back"
                className="btn btn-ghost btn-icon -ml-2"
              >
                <ArrowLeftIcon />
              </button>
            )}
            <div className="flex min-w-0 flex-1 flex-col py-1.5">
              <h2 id={`${id}-title`} className="section-heading break-words">
                {title}
              </h2>
              {description && (
                <p id={`${id}-description`} className="text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {closeButton === 'close' && (
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="btn btn-ghost btn-icon -mr-2"
              >
                <XIcon />
              </button>
            )}
          </div>
          <div
            ref={body}
            {...inert(panelInert)}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
          >
            {children}
          </div>
          <div className="relative shrink-0">
            {/* Toasts render here while this sheet is open: just above the footer. Never inert. */}
            <div
              ref={toastRegion}
              aria-live="polite"
              className="pointer-events-none absolute inset-x-3 bottom-full mb-2 flex justify-center"
            />
            {footer && (
              <div {...inert(panelInert)} className="border-t bg-background px-4 py-3">
                {footer}
              </div>
            )}
          </div>
          {confirming && (
            <div
              role="alertdialog"
              aria-labelledby={`${id}-discard`}
              className="absolute inset-x-0 bottom-0 flex flex-col gap-3 rounded-t-xl border-t bg-popover p-4 text-popover-foreground shadow-xl"
            >
              <p id={`${id}-discard`} className="text-sm font-medium">
                Discard your changes?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    confirmFrom.current = null;
                    onClose();
                  }}
                  className="btn btn-destructive flex-1"
                >
                  Discard
                </button>
                <button
                  ref={keepEditing}
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="btn btn-outline flex-1"
                >
                  Keep editing
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
