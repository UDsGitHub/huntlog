import { todayLocal } from './dates';
import type { Application, Status } from './types';

/** The fixed status pipeline (spec §5), in display order. Not configurable. */
export const STATUSES: readonly Status[] = [
  'saved',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'ghosted',
];

export const STATUS_LABELS: Record<Status, string> = {
  saved: 'Saved',
  applied: 'Applied',
  screening: 'Screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
};

/** Status filter groups (spec §4.4). Together they cover every status exactly once. */
export const ACTIVE_STATUSES: readonly Status[] = [
  'saved',
  'applied',
  'screening',
  'interviewing',
  'offer',
];
export const CLOSED_STATUSES: readonly Status[] = ['accepted', 'rejected', 'withdrawn', 'ghosted'];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** Statuses that don't mean an application was sent, so Date applied stays optional. */
export function appliedAtOptional(status: Status): boolean {
  return status === 'saved' || status === 'withdrawn';
}

/**
 * What a status change does to an empty Date applied (spec §4.3, §5):
 * - `set-today`: moving to Applied sets it to today.
 * - `ask`: moving to any status that implies an application asks for the date.
 * - `none`: a stored date is never overwritten, and Saved or Withdrawn don't need one.
 */
export type AppliedAtAction = 'set-today' | 'ask' | 'none';

export function appliedAtAction(
  app: Pick<Application, 'appliedAt'>,
  next: Status,
): AppliedAtAction {
  if (app.appliedAt) return 'none';
  if (next === 'applied') return 'set-today';
  return appliedAtOptional(next) ? 'none' : 'ask';
}

/**
 * Returns the application after a status change: one history entry appended (history is
 * append-only), the Date applied rule applied, `updatedAt` moved forward. Picking the current
 * status returns the same object, unchanged.
 *
 * `appliedAt` is the date the user gave when asked (`ask`); omit it for Skip. It never replaces
 * a stored date. Callers validate it first (`checkAppliedAt`).
 */
export function applyStatusChange(
  app: Application,
  next: Status,
  { now = new Date(), appliedAt }: { now?: Date; appliedAt?: string } = {},
): Application {
  if (next === app.status) return app;
  const at = now.toISOString();
  const action = appliedAtAction(app, next);
  const date = action === 'set-today' ? todayLocal(now) : action === 'ask' ? appliedAt : undefined;
  return {
    ...app,
    status: next,
    statusHistory: [...(app.statusHistory ?? []), { status: next, at }],
    ...(date && { appliedAt: date }),
    updatedAt: at,
  };
}

/**
 * When the application first entered `status`, by date rather than stored order (dates can be
 * backfilled). Stats count "first entered" (spec §4.7). Undefined if it never did.
 */
export function firstEnteredAt(app: Pick<Application, 'statusHistory'>, status: Status) {
  let first: string | undefined;
  for (const entry of app.statusHistory ?? []) {
    if (entry.status !== status) continue;
    if (first === undefined || Date.parse(entry.at) < Date.parse(first)) first = entry.at;
  }
  return first;
}
