import { DRAFT_KEY_PREFIX } from './captureDraft';
import { db as defaultDb, type JobLogDB } from './db';
import { FORM_DEFAULTS_KEY } from './formDefaults';

/** The applications and resumes were deleted, but the cleanup after them failed. */
export class LeftoversError extends Error {
  constructor(cause: unknown) {
    super('Data deleted, but its leftovers could not all be cleared', { cause });
    this.name = 'LeftoversError';
  }
}

/**
 * Delete all data (spec §4.8): every application and resume, with its file, permanently. This is
 * the one delete that isn't soft (spec §5): it's a privacy promise, and nothing needs tombstones
 * yet. What's stored beside them goes too: the remembered form defaults (taken from the last
 * application) and any pending capture. Settings stay; Reset settings is separate.
 *
 * The tables clear in one transaction, so a failure there leaves them all as they were. A
 * failure after that rejects with `LeftoversError`: the data is gone, only the cleanup beside it
 * didn't finish. Running it again finishes the job.
 */
export async function deleteAllData(database: JobLogDB = defaultDb): Promise<void> {
  await database.transaction(
    'rw',
    database.applications,
    database.resumes,
    database.resumeFiles,
    async () => {
      await database.applications.clear();
      await database.resumes.clear();
      await database.resumeFiles.clear();
    },
  );
  try {
    await browser.storage.local.remove(FORM_DEFAULTS_KEY);
    const session = await browser.storage.session.get(null);
    const drafts = Object.keys(session).filter((key) => key.startsWith(DRAFT_KEY_PREFIX));
    if (drafts.length) await browser.storage.session.remove(drafts);
  } catch (error) {
    throw new LeftoversError(error);
  }
}
