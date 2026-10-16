import { useEffect, useState } from 'react';
import { onSettingsChanged, readSettings, type Settings } from '@/lib/settings';

/**
 * The current settings, kept live: a change made in this window or another one shows up at
 * once (spec §4.8). Undefined until the first read finishes.
 */
export function useSettings(): Settings | undefined {
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => {
    let cancelled = false;
    // Subscribe before reading, so a change made meanwhile isn't missed.
    const unsubscribe = onSettingsChanged((next) => setSettings(next));
    void readSettings().then((read) => {
      // A change that arrived during the read is newer than what the read returned.
      if (!cancelled) setSettings((current) => current ?? read);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return settings;
}
