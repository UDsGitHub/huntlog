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

/** Spec §5 Application, without the resume fields (M4). */
export interface Application {
  id: string;
  url: string;
  /** `normalizeUrl(url)`, indexed for duplicate detection. Derived: recompute when `url` changes. */
  urlNormalized: string;
  /** `companyTitleKey(company, title)`, indexed; undefined without a title. Derived. */
  companyTitleKey?: string;
  company: string;
  title?: string;
  status: Status;
  statusHistory: StatusHistoryEntry[]; // append-only
  appliedAt?: string; // YYYY-MM-DD, local date
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
