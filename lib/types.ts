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

export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type SalaryPeriod = 'year' | 'month' | 'hour';

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
  location?: string;
  workMode?: WorkMode;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string; // ISO 4217; stored only with a salary
  salaryPeriod?: SalaryPeriod;
  source?: string; // free text with suggestions
  notes?: string; // plain text, shown with line breaks
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
