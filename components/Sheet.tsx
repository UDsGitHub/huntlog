import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowLeftIcon, XIcon } from './icons';
import { inert } from './inert';
import { registerToastSlot } from './toastLayer';

/** How long the slide in or out takes. Reduced motion skips it. */
export const SHEET_ANIMATION_MS = 200;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

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
  const slot = useRef<HTMLDivElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // What had focus when the discard question opened, to go back to on Keep editing.
  const confirmFrom = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Each opening starts without the discard question (state adjusted during render, not in an
  // effect, so there's no extra render pass).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setConfirming(false);
  }
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element.showModal();
      }
      const target =
        initialFocus?.current ?? body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
      (target ?? element).focus();
      return;
    }
    if (!element.open) return;
    // Slides out (data-state="closing"), then closes.
    const finish = () => {
      element.close();
      returnFocus.current?.focus();
      returnFocus.current = null;
      onClosedRef.current?.();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    const timer = setTimeout(finish, SHEET_ANIMATION_MS);
    return () => clearTimeout(timer);
    // initialFocus is read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Unmounting while open (e.g. the view behind it went away) still closes the dialog.
  useEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  // While open, this sheet's slot is where toasts show.
  useLayoutEffect(() => {
    if (!open || !slot.current) return;
    return registerToastSlot(slot.current);
  }, [open]);

  useLayoutEffect(() => {
    if (confirming) keepEditing.current?.focus();
    else if (confirmFrom.current) {
      confirmFrom.current.focus();
      confirmFrom.current = null;
    }
  }, [confirming]);

  function requestClose() {
    if (!open) return;
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

  function onClick(event: MouseEvent) {
    // A click on the dialog itself, not its panel, is a click on the dimmed area outside.
    if (event.target === dialog.current && dismissible) requestClose();
  }

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
      onClick={onClick}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="sheet m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-foreground"
    >
      <div
        className={`sheet-panel absolute inset-x-0 bottom-0 flex flex-col rounded-t-xl border-t bg-background shadow-xl ${
          size === 'full' ? 'h-[calc(100%-0.75rem)]' : 'max-h-[calc(100%-2rem)]'
        }`}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-2">
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
          {...inert(confirming)}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
        >
          {children}
        </div>
        <div className="relative shrink-0">
          {/* Toasts render here while this sheet is open: just above the footer. */}
          <div
            ref={slot}
            className="pointer-events-none absolute inset-x-3 bottom-full mb-2 flex justify-center"
          />
          {footer && (
            <div {...inert(confirming)} className="border-t bg-background px-4 py-3">
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
    </dialog>
  );
}
