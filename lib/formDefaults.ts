import { WORK_MODES } from './applicationInput';
import type { Application, WorkMode } from './types';

/** `chrome.storage.local` key (spec §4.2, §6: settings-like data lives there). */
export const FORM_DEFAULTS_KEY = 'formDefaults';

/**
 * What a new manual Add starts with: the work mode of the last new application. The source isn't
 * remembered (it differs from one job to the next); a `source` stored by an older version is
 * ignored, and dropped at the next write.
 */
export interface FormDefaults {
  workMode?: WorkMode;
}

/** Keeps only well-formed values; anything else (old shapes, hand edits) is dropped. */
export function parseFormDefaults(raw: unknown): FormDefaults {
  if (typeof raw !== 'object' || raw === null) return {};
  const { workMode } = raw as Record<string, unknown>;
  const defaults: FormDefaults = {};
  if (typeof workMode === 'string' && (WORK_MODES as string[]).includes(workMode)) {
    defaults.workMode = workMode as WorkMode;
  }
  return defaults;
}

/** Never throws: without storage, the form just starts blank. */
export async function readFormDefaults(): Promise<FormDefaults> {
  try {
    const stored = await browser.storage.local.get(FORM_DEFAULTS_KEY);
    return parseFormDefaults(stored[FORM_DEFAULTS_KEY]);
  } catch (error) {
    console.error('Reading form defaults failed', error);
    return {};
  }
}

let writes: Promise<unknown> = Promise.resolve();

/**
 * Remembers a newly saved application's work mode (never an edit's). After a manual
 * Add they're remembered exactly, blanks included: the defaults are "what the last one had".
 * After a capture only the values it has replace the old ones, since a capture's blanks mean
 * "not captured", not "none". Writes run in order, so overlapping saves can't swap them.
 * Never throws.
 */
export function rememberFormDefaults(
  application: Pick<Application, 'workMode'>,
  { captured = false }: { captured?: boolean } = {},
): Promise<FormDefaults> {
  const write = writes.then(async () => {
    const next = parseFormDefaults(application);
    const defaults = captured ? { ...(await readFormDefaults()), ...next } : next;
    try {
      await browser.storage.local.set({ [FORM_DEFAULTS_KEY]: defaults });
    } catch (error) {
      console.error('Saving form defaults failed', error);
    }
    return defaults;
  });
  writes = write;
  return write;
}

/**
 * Calls `listener` with the new defaults whenever they change in any window, including being
 * removed by Delete all data, so no open panel keeps (and writes back) deleted ones.
 */
export function onFormDefaultsChanged(listener: (defaults: FormDefaults) => void): () => void {
  const handle = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && FORM_DEFAULTS_KEY in changes) {
      listener(parseFormDefaults(changes[FORM_DEFAULTS_KEY]!.newValue));
    }
  };
  browser.storage.onChanged.addListener(handle);
  return () => browser.storage.onChanged.removeListener(handle);
}
