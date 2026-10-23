import Dexie, { type EntityTable } from 'dexie';
import { derivedFields } from './dedupe';
import type { Application, Resume, ResumeFile } from './types';

// The project's working name. Never rename it: the browser keys each user's data by it, so a new
// name would open an empty database and leave theirs behind.
export const DB_NAME = 'job-log';

export class JobLogDB extends Dexie {
  applications!: EntityTable<Application, 'id'>;
  resumes!: EntityTable<Resume, 'id'>;
  resumeFiles!: EntityTable<ResumeFile, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);
    // Never edit a shipped version: add a new one with an upgrade path (CLAUDE.md DoD #5).
    // deletedAt is not indexed because Dexie skips undefined values; queries filter it instead.
    this.version(1).stores({
      applications: 'id, status, appliedAt, updatedAt',
    });
    // v2 (M2): duplicate detection. Only adds derived fields; no user data changes.
    this.version(2)
      .stores({
        applications: 'id, status, appliedAt, updatedAt, urlNormalized, companyTitleKey',
      })
      .upgrade((tx) =>
        tx
          .table<Application, string>('applications')
          .toCollection()
          .modify((app) => {
            const { urlNormalized, companyTitleKey } = derivedFields(app);
            app.urlNormalized = urlNormalized;
            if (companyTitleKey) app.companyTitleKey = companyTitleKey;
          }),
      );
    // v3 (M4): the resume library. Adds tables and an index; no existing data changes.
    // Files live apart from their metadata so listing resumes never loads the bytes. `archived`
    // isn't indexed: IndexedDB can't index booleans. `resumeId` on applications answers "is this
    // resume used?" without scanning every row.
    this.version(3).stores({
      applications: 'id, status, appliedAt, updatedAt, urlNormalized, companyTitleKey, resumeId',
      resumes: 'id, createdAt, updatedAt',
      resumeFiles: 'id',
    });

    // Derived fields are enforced here, not by convention: every add, put, update or modify that
    // touches url, company or title recomputes them, whatever code path made the write.
    this.applications.hook('creating', (_key, app) => {
      const { urlNormalized, companyTitleKey } = derivedFields(app);
      app.urlNormalized = urlNormalized;
      if (companyTitleKey) app.companyTitleKey = companyTitleKey;
      else delete app.companyTitleKey;
    });
    this.applications.hook('updating', (mods, _key, app) => {
      const changes = mods as Partial<Application>;
      if (!('url' in changes || 'company' in changes || 'title' in changes)) return undefined;
      const { urlNormalized, companyTitleKey } = derivedFields({ ...app, ...changes });
      // An undefined companyTitleKey is stored as an undefined-valued property, which the index
      // skips, so the row drops out of company + title matching.
      return { urlNormalized, companyTitleKey };
    });
  }
}

export const db = new JobLogDB();
