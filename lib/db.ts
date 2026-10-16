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
