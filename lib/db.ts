import Dexie, { type EntityTable } from 'dexie';
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
  }
}

export const db = new JobLogDB();
