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
import { isSubmitShortcut } from './submitShortcut';
import { registerToastLayer } from './toastLayer';

/**
 * Moves focus into the newest open sheet (its first control), for when the element that had it
 * went away and the page behind is inert. Returns whether a sheet was open.
 */
export function focusOpenSheet(): boolean {
  const sheets = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const sheet = sheets[sheets.length - 1];
  if (!sheet) return false;
  (sheet.querySelector<HTMLElement>(FOCUSABLE) ?? sheet).focus();
  return true;
}

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
    // Closing (Discard, or from outside, e.g. a capture) ends the question too: it doesn't
    // float over the slide-out.
    setConfirming(false);
    if (open) setMounted(true);
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
      // The given element, else the body's first control, else the header's (Back or Close).
      const target =
        initialFocus?.current ??
        body.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        element.querySelector<HTMLElement>(FOCUSABLE);
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
      // Keep editing goes back to where focus was; a close doesn't (focus returns to the opener).
      if (open) confirmFrom.current.focus();
      confirmFrom.current = null;
    }
  }, [confirming, open]);

  function requestClose() {
    if (!open || confirming) return;
    if (dirty) {
      confirmFrom.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirming(true);
    } else onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isSubmitShortcut(event)) {
      // Presses the sheet's main button (marked by SUBMIT_SHORTCUT) from anywhere in it. Not when
      // a control already used the key (a list picking, the inline upload), not from a toast's
      // buttons, not while the discard question is up or sliding out, and not on a held-down key,
      // so it saves once. Stopped either way, so a sheet opened from inside another (Settings'
      // confirmations) never presses the outer one's button.
      event.stopPropagation();
      const fromToast = event.target instanceof Node && toastRegion.current?.contains(event.target);
      if (event.defaultPrevented || !open || confirming || event.repeat || fromToast) return;
      const button = dialog.current?.querySelector<HTMLButtonElement>('[data-sheet-submit]');
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      button.click();
      return;
    }
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
      // overflow-clip: the browser gives a modal dialog overflow: auto, so the panel sliding up
      // from below the edge made the dialog scrollable (a scrollbar flashed) mid-slide. Not
      // overflow-hidden, which can still be scrolled by script and by focus: focusing the first
      // field as the sheet opened scrolled the dialog to the panel still below the edge, which
      // then jumped up and eased back down instead of sliding in.
      className="sheet m-0 h-full max-h-none w-full max-w-none overflow-clip border-0 bg-transparent p-0 text-foreground"
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
                <p id={`${id}-description`} className="text-sm break-words text-muted-foreground">
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
            data-sheet-body=""
            {...inert(panelInert)}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
          >
            {children}
          </div>
          <div className="relative shrink-0">
            {/* Toasts render here while this sheet is open: just above the footer. Never inert,
                and above the discard question's dimmed layer, so a toast stays usable. */}
            <div
              ref={toastRegion}
              aria-live="polite"
              className="pointer-events-none absolute inset-x-3 bottom-full z-20 mb-2 flex justify-center"
            />
            {footer && (
              <div {...inert(panelInert)} className="border-t bg-background px-4 py-3">
                {footer}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Centered over the sheet, on a dimmed layer that keeps clicks off the sheet (a click on
          it does nothing: the question needs an answer). Toasts stay above it and usable. */}
      {mounted && confirming && (
        <div className="discard-overlay absolute inset-0 z-10 flex items-center justify-center p-4">
          <div
            role="alertdialog"
            aria-labelledby={`${id}-discard`}
            aria-describedby={`${id}-discard-description`}
            className="discard-dialog flex w-full max-w-xs flex-col gap-4 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg"
          >
            <div className="flex flex-col gap-1.5">
              <h3 id={`${id}-discard`} className="text-base font-semibold">
                Discard your changes?
              </h3>
              <p id={`${id}-discard-description`} className="text-sm text-muted-foreground">
                What you've changed here won't be saved.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                ref={keepEditing}
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-outline"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmFrom.current = null;
                  onClose();
                }}
                className="btn btn-destructive"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
