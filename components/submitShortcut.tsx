import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * ⌘+Enter (Ctrl+Enter off a Mac) presses a sheet's main button from anywhere in the sheet: a
 * Select, a chip, Notes. Both modifiers work everywhere, so a habit from either system carries.
 */
export function isSubmitShortcut(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey;
}

/**
 * Spread on the one button a sheet's submit shortcut presses (Save, Apply, Upload, Set date).
 * Not on a destructive one: Delete all data and Reset settings stay a deliberate press.
 */
export const SUBMIT_SHORTCUT = {
  'data-sheet-submit': '',
  'aria-keyshortcuts': 'Meta+Enter Control+Enter',
} as const;

// navigator.platform still names the OS in Chrome (user-agent reduction keeps it); the newer
// userAgentData.platform is checked first where there is one.
const IS_MAC = /mac|iphone|ipad/i.test(
  (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ||
    navigator.platform,
);

/**
 * The shortcut drawn at the right of a full-width Save (give the button `relative`). Hidden from
 * assistive tech: the button's aria-keyshortcuts names it.
 */
export function SubmitShortcutHint() {
  return (
    <kbd
      aria-hidden="true"
      className="absolute right-3 rounded border border-primary-foreground/30 px-1.5 font-sans text-xs font-normal text-primary-foreground/80"
    >
      {IS_MAC ? '⌘↵' : 'Ctrl+↵'}
    </kbd>
  );
}
