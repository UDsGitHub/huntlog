import Dexie, { type EntityTable } from 'dexie';
import { derivedFields } from './dedupe';
import type { Application } from './types';

export const DB_NAME = 'job-log';

export class JobLogDB extends Dexie {
  applications!: EntityTable<Application, 'id'>;

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
  }
}

export const db = new JobLogDB();
