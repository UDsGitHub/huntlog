import { WORK_MODES } from './applicationInput';
import type { Application, WorkMode } from './types';

/** `chrome.storage.local` key (spec §4.2, §6: settings-like data lives there). */
export const FORM_DEFAULTS_KEY = 'formDefaults';

/** What a new manual Add starts with: the source and work mode of the last new application. */
export interface FormDefaults {
  source?: string;
  workMode?: WorkMode;
}

/** Keeps only well-formed values; anything else (old shapes, hand edits) is dropped. */
export function parseFormDefaults(raw: unknown): FormDefaults {
  if (typeof raw !== 'object' || raw === null) return {};
  const { source, workMode } = raw as Record<string, unknown>;
  const defaults: FormDefaults = {};
  if (typeof source === 'string' && source.trim() && source.length <= 100) {
    defaults.source = source.trim();
  }
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

/**
 * Remembers a newly saved application's source and work mode. A blank one is remembered as
 * blank: the defaults are "what the last application had". Never throws.
 */
export async function rememberFormDefaults(
  application: Pick<Application, 'source' | 'workMode'>,
): Promise<FormDefaults> {
  const defaults = parseFormDefaults(application);
  try {
    await browser.storage.local.set({ [FORM_DEFAULTS_KEY]: defaults });
  } catch (error) {
    console.error('Saving form defaults failed', error);
  }
  return defaults;
}
