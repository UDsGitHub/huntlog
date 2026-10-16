import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SETTINGS,
  onSettingsChanged,
  readStoredSettings,
  type Settings,
} from '@/lib/settings';

/**
 * One shared copy of the settings for the whole page: one storage read and one change listener,
 * however many components use them, so they all show the same settings in the same render.
 */
let current: Settings | undefined;
/** Defaults shown because reading failed, not settings anyone chose. */
const fallbacks = new WeakSet<Settings>();

/** True for the defaults shown after a failed read: display them, but don't persist them. */
export function isFallbackSettings(settings: Settings): boolean {
  return fallbacks.has(settings);
}
const subscribers = new Set<() => void>();
/** While anyone is subscribed: stops listening. Each session's reads only update that session. */
let session: { stop: () => void } | undefined;

function publish(settings: Settings) {
  current = settings;
  subscribers.forEach((notify) => notify());
}

function start() {
  let changed = false;
  // Listen before reading, so a change made meanwhile isn't missed.
  const stop = onSettingsChanged((settings) => {
    changed = true;
    publish(settings);
  });
  const started = { stop };
  session = started;
  readStoredSettings().then(
    (settings) => {
      // A change that arrived during the read is newer than what the read returned.
      if (session === started && !changed) publish(settings);
    },
    (error: unknown) => {
      console.error('Reading settings failed', error);
      // Show the defaults, marked as such, so nothing writes them back as if chosen.
      const fallback = { ...DEFAULT_SETTINGS };
      fallbacks.add(fallback);
      if (session === started && !changed) publish(fallback);
    },
  );
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (!session) start();
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && session) {
      session.stop();
      session = undefined;
      // Unknown again until the next subscriber reads them.
      current = undefined;
    }
  };
}

const snapshot = () => current;

/**
 * The current settings, kept live: a change made in this window or another one shows up at
 * once (spec §4.8). Undefined until the first read finishes.
 */
export function useSettings(): Settings | undefined {
  return useSyncExternalStore(subscribe, snapshot);
}
