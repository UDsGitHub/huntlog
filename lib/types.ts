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
  /** The resume sent (spec §4.6); optional, encouraged. */
  resumeId?: string;
  /** The resume's display name when it was linked, shown if the resume itself is gone. */
  resumeNameSnapshot?: string;
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

/**
 * An uploaded resume (spec §4.6, §5): the metadata. The file's bytes live in their own table
 * (`ResumeFile`, same id), so listing resumes never loads files; the bytes are removed once a
 * deleted resume's Undo window has passed, and the record stays for future sync.
 */
export interface Resume {
  id: string;
  name: string; // display name, e.g. "Backend v3"
  fileName: string; // original file name
  mimeType: string;
  size: number; // bytes actually stored
  note?: string;
  /** Hidden from the resume picker, still viewable; kept because applications use it. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/**
 * A resume's file: raw bytes rather than a Blob, since bytes store and round-trip everywhere
 * (fake-indexeddb loses Blobs); a Blob is built when the file is opened.
 */
export interface ResumeFile {
  id: string; // the resume's id
  data: ArrayBuffer;
}
