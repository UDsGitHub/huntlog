import {
  addApplication,
  NotFoundError,
  setStatus,
  softDeleteApplication,
  updateHistoryDate,
} from './applications';
import { JobLogDB } from './db';
import { editHistoryDate, localDateOf } from './status';
import type { Application } from './types';

// Local noon on Oct 15, whatever time zone the tests run in.
const now = new Date(2026, 9, 15, 12, 0, 0);
const local = (y: number, m: number, d: number, h = 9, min = 30) =>
  new Date(y, m - 1, d, h, min).toISOString();

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    url: 'https://acme.com/1',
    urlNormalized: 'https://acme.com/1',
    company: 'Acme',
    status: 'interviewing',
    statusHistory: [
      { status: 'applied', at: local(2026, 10, 1) },
      { status: 'interviewing', at: local(2026, 10, 8, 14, 5) },
    ],
    appliedAt: '2026-10-01',
    createdAt: local(2026, 10, 1),
    updatedAt: local(2026, 10, 8, 14, 5),
    ...overrides,
  };
}

const edited = (result: ReturnType<typeof editHistoryDate>) => {
  if (!('application' in result)) throw new Error(result.error);
  return result.application;
};

describe('editHistoryDate', () => {
  it('moves an entry to another date, keeping its local time of day', () => {
    const result = edited(editHistoryDate(app(), 1, '2026-10-06', now));
    const at = new Date(result.statusHistory[1]!.at);
    expect(localDateOf(result.statusHistory[1]!.at)).toBe('2026-10-06');
    expect([at.getHours(), at.getMinutes()]).toEqual([14, 5]);
    expect(result.statusHistory[0]).toEqual(app().statusHistory[0]);
    expect(result.updatedAt).toBe(now.toISOString());
  });

  it('keeps stored order, even when the new date sorts differently', () => {
    const result = edited(editHistoryDate(app(), 1, '2026-09-20', now));
    expect(result.statusHistory.map((e) => e.status)).toEqual(['applied', 'interviewing']);
  });

  it('allows backfilling to before the application was created, and today', () => {
    expect('application' in editHistoryDate(app(), 0, '2026-08-01', now)).toBe(true);
    expect('application' in editHistoryDate(app(), 1, '2026-10-15', now)).toBe(true);
  });

  it.each([
    ['2026-10-16', "This date can't be in the future."],
    ['2026-02-30', 'Enter a valid date.'],
    ['10/06/2026', 'Enter a valid date.'],
    ['', 'Enter a valid date.'],
  ])('rejects %j', (date, error) => {
    expect(editHistoryDate(app(), 1, date, now)).toEqual({ error });
  });

  it.each([[-1], [2], [99]])('rejects entry index %d', (index) => {
    expect(editHistoryDate(app(), index, '2026-10-02', now)).toEqual({
      error: 'That history entry no longer exists.',
    });
  });

  it('moves Date applied along with the first Applied entry when they matched', () => {
    expect(edited(editHistoryDate(app(), 0, '2026-09-28', now)).appliedAt).toBe('2026-09-28');
  });

  it("leaves Date applied alone when it didn't match that entry", () => {
    const result = edited(editHistoryDate(app({ appliedAt: '2026-09-15' }), 0, '2026-09-28', now));
    expect(result.appliedAt).toBe('2026-09-15');
  });

  it('follows when a later Applied entry is moved before the first one', () => {
    const twice = app({
      statusHistory: [
        { status: 'applied', at: local(2026, 5, 1) },
        { status: 'withdrawn', at: local(2026, 5, 5) },
        { status: 'applied', at: local(2026, 6, 1) },
      ],
      appliedAt: '2026-05-01',
    });
    expect(edited(editHistoryDate(twice, 2, '2026-04-01', now)).appliedAt).toBe('2026-04-01');
  });

  it('hands over to the next Applied entry when the first moves past it', () => {
    const twice = app({
      statusHistory: [
        { status: 'applied', at: local(2026, 5, 1) },
        { status: 'applied', at: local(2026, 5, 10) },
      ],
      appliedAt: '2026-05-01',
    });
    expect(edited(editHistoryDate(twice, 0, '2026-05-20', now)).appliedAt).toBe('2026-05-10');
  });

  it.each([['0202-10-10'], ['1969-12-31']])('rejects the implausible year %s', (date) => {
    expect(editHistoryDate(app(), 1, date, now)).toEqual({ error: 'Enter a valid date.' });
  });

  it('leaves Date applied alone for other entries, or a later Applied entry', () => {
    expect(edited(editHistoryDate(app(), 1, '2026-10-02', now)).appliedAt).toBe('2026-10-01');
    const twice = app({
      statusHistory: [
        { status: 'applied', at: local(2026, 10, 1) },
        { status: 'withdrawn', at: local(2026, 10, 2) },
        { status: 'applied', at: local(2026, 10, 3) },
      ],
      appliedAt: '2026-10-03',
    });
    expect(edited(editHistoryDate(twice, 2, '2026-10-04', now)).appliedAt).toBe('2026-10-03');
  });
});

describe('updateHistoryDate', () => {
  let db: JobLogDB;
  beforeEach(() => {
    db = new JobLogDB(`test-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    await db.delete();
  });

  it('saves the new date', async () => {
    // Date applied defaults to today, the same local date as the Applied entry, so it follows.
    const a = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, now);
    const result = await updateHistoryDate(
      a.id,
      { index: 0, at: a.statusHistory[0]!.at },
      '2026-10-09',
      db,
      now,
    );
    expect('application' in result).toBe(true);
    const stored = await db.applications.get(a.id);
    expect(localDateOf(stored!.statusHistory[0]!.at)).toBe('2026-10-09');
    expect(stored!.appliedAt).toBe('2026-10-09');
  });

  it('refuses an entry that changed meanwhile', async () => {
    const a = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, now);
    const stale = { index: 0, at: '2020-01-01T00:00:00.000Z' };
    expect(await updateHistoryDate(a.id, stale, '2026-10-09', db, now)).toEqual({
      error: 'This entry changed meanwhile. Check the date and try again.',
    });
    expect(await db.applications.get(a.id)).toEqual(a);
  });

  it('writes nothing for an invalid date', async () => {
    const a = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, now);
    await setStatus(a.id, 'screening', {}, db, now);
    const before = await db.applications.get(a.id);
    expect(
      await updateHistoryDate(
        a.id,
        { index: 1, at: before!.statusHistory[1]!.at },
        '2999-01-01',
        db,
        now,
      ),
    ).toEqual({ error: "This date can't be in the future." });
    expect(await db.applications.get(a.id)).toEqual(before);
  });

  it.each([['missing'], ['soft-deleted']])('fails for a %s row', async (kind) => {
    const a = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, now);
    if (kind === 'soft-deleted') await softDeleteApplication(a.id, db);
    await expect(
      updateHistoryDate(
        kind === 'missing' ? 'nope' : a.id,
        { index: 0, at: a.statusHistory[0]!.at },
        '2026-10-01',
        db,
        now,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
