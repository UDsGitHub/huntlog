import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EllipsisIcon } from './icons';
import { rovingIndex } from './rovingIndex';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  /** Shown in the destructive color (e.g. Delete). */
  destructive?: boolean;
}

/**
 * A ⋯ button with a small menu of actions (spec §4.3 Detail, §4.6 resume rows): for the rarer,
 * riskier actions, so they're never one mis-tap away. ARIA menu button: Enter, Space or a click
 * opens it with the first item focused; Up/Down/Home/End move; Escape closes back to the button;
 * Tab or a click elsewhere closes.
 */
export function MoreMenu({ label, items }: { label: string; items: MoreMenuItem[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  return (
    <div ref={container} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((was) => !was)}
        className="btn btn-ghost btn-icon"
      >
        <EllipsisIcon />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              return close(true);
            }
            if (event.key === 'Tab') return close(false);
            const index = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
            const to = rovingIndex(event.key, index, items.length, {
              next: 'ArrowDown',
              previous: 'ArrowUp',
            });
            if (to === undefined) return;
            event.preventDefault();
            itemRefs.current[to]?.focus();
          }}
          className="absolute top-full right-0 z-20 mt-1 flex min-w-40 flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={`focus-ring flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent ${
                item.destructive ? 'text-destructive' : ''
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
