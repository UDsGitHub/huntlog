// Fixed status union (spec §5). Not configurable.
export type Status =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interviewing'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted';

export interface StatusHistoryEntry {
  status: Status;
  at: string; // ISO 8601 UTC
}

/** M0 subset of the spec §5 Application; later milestones add fields. */
export interface Application {
  id: string;
  url: string;
  company: string;
  title?: string;
  status: Status;
  statusHistory: StatusHistoryEntry[]; // append-only
  appliedAt?: string; // YYYY-MM-DD, local date
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
