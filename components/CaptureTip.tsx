import { useEffect, useState } from 'react';
import { ADD_JOB_COMMAND } from '@/lib/commands';

const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts';

/**
 * The capture shortcut as Chrome shows it (e.g. "⌥⇧J" on a Mac, "Alt+Shift+J" elsewhere), read
 * with `commands.getAll`, which needs no permission. '' when none is set (the user removed it,
 * or another extension took the key), undefined while unknown or if it can't be read. Read again
 * when the panel regains focus or is shown again, since it's changed on Chrome's own page.
 */
export function useCaptureShortcut(): string | undefined {
  const [shortcut, setShortcut] = useState<string>();
  useEffect(() => {
    let live = true;
    // Through a promise, so a call that throws is caught as well as one that rejects.
    const read = () =>
      Promise.resolve()
        .then(() => browser.commands.getAll())
        .then((commands) => {
          const command = commands.find((c) => c.name === ADD_JOB_COMMAND);
          if (live) setShortcut(command?.shortcut ?? '');
        })
        .catch(() => {});
    // The panel stays visible while the user is on Chrome's shortcuts page and comes back to a
    // tab without focusing it, so its own focus isn't enough: also when it's shown again.
    const onVisible = () => document.visibilityState === 'visible' && void read();
    void read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return shortcut;
}

/**
 * The empty list's onboarding tip (spec §4.2, §8): a button inside the panel can't read the tab,
 * so prefill comes only from the shortcut or the context menu. Names the real shortcut when one
 * is set, and otherwise offers Chrome's page for setting one.
 */
export function CaptureTip() {
  const shortcut = useCaptureShortcut();
  return (
    <p className="text-xs text-muted-foreground">
      {shortcut ? (
        <>
          Tip: on any job posting, press{' '}
          <kbd className="rounded-sm border bg-muted px-1 font-sans text-foreground">
            {shortcut}
          </kbd>{' '}
          or right-click and choose Add job to Huntlog to fill it in for you.
        </>
      ) : (
        <>
          Tip: right-click any job posting and choose Add job to Huntlog to fill it in for you.
          {shortcut === '' && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => void browser.tabs.create({ url: SHORTCUTS_PAGE })}
                className="link text-xs"
              >
                Set a keyboard shortcut
              </button>
            </>
          )}
        </>
      )}
    </p>
  );
}
