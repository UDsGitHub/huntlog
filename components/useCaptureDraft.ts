import { useEffect, useState } from 'react';
import { draftKey, isFresh, parseDraft, type CaptureDraft } from '@/lib/captureDraft';

export interface CapturePrefill {
  draft: CaptureDraft;
  /** Changes on every consumed draft, so two identical captures in a row both apply. */
  nonce: number;
}

/**
 * Consumes this window's capture draft from `storage.session` (spec §4.1). The panel can open
 * before the background script writes the draft, so it reads on mount and also on change.
 */
export function useCaptureDraft(): CapturePrefill | null {
  const [prefill, setPrefill] = useState<CapturePrefill | null>(null);

  useEffect(() => {
    let cancelled = false;
    let key: string | null = null;
    let lastConsumed: string | null = null;

    async function consume(raw: unknown) {
      if (!key || raw === undefined || raw === null) return;
      // The mount read and the change event can both deliver the same draft.
      const serialized = JSON.stringify(raw);
      if (serialized === lastConsumed) return;
      lastConsumed = serialized;
      try {
        await browser.storage.session.remove(key);
      } catch (error) {
        console.error('Clearing the capture draft failed', error);
      }
      const draft = parseDraft(raw);
      if (!draft || !isFresh(draft) || cancelled) return;
      // Derive from the previous state: a re-run of this effect (StrictMode, hot reload) must not
      // restart the count, or a repeated key would skip the form remount.
      setPrefill((previous) => ({ draft, nonce: (previous?.nonce ?? 0) + 1 }));
    }

    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (key && key in changes) void consume(changes[key]?.newValue);
    };
    browser.storage.session.onChanged.addListener(onChanged);

    void (async () => {
      try {
        const current = await browser.windows.getCurrent();
        if (cancelled || current?.id === undefined) return;
        key = draftKey(current.id);
        const stored = await browser.storage.session.get(key);
        await consume(stored[key]);
      } catch (error) {
        console.error('Reading the capture draft failed', error);
      }
    })();

    return () => {
      cancelled = true;
      browser.storage.session.onChanged.removeListener(onChanged);
    };
  }, []);

  return prefill;
}
