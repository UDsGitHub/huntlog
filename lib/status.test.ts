import {
  ACTIVE_STATUSES,
  applyStatusChange,
  appliedAtAction,
  CLOSED_STATUSES,
  firstEnteredAt,
  isStatus,
  STATUS_LABELS,
  STATUSES,
} from './status';
import type { Application, Status } from './types';

const created = '2026-10-01T09:00:00.000Z';
// Local noon, so "today" is Oct 15 in any time zone the tests run in.
const now = new Date(2026, 9, 15, 12, 0, 0);

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    url: 'https://acme.com/1',
    urlNormalized: 'https://acme.com/1',
    company: 'Acme',
    status: 'applied',
    statusHistory: [{ status: 'applied', at: created }],
    appliedAt: '2026-10-01',
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

describe('status lists', () => {
  it('has the 9 fixed statuses, each with a label', () => {
    expect(STATUSES).toHaveLength(9);
    for (const status of STATUSES) expect(STATUS_LABELS[status]).toBeTruthy();
  });

  it('splits into Active and Closed with no gaps or overlap', () => {
    expect([...ACTIVE_STATUSES, ...CLOSED_STATUSES].sort()).toEqual([...STATUSES].sort());
    expect(ACTIVE_STATUSES.some((s) => CLOSED_STATUSES.includes(s))).toBe(false);
  });

  it.each([
    ['applied', true],
    ['Applied', false],
    ['', false],
    [undefined, false],
    [3, false],
  ])('isStatus(%j) → %s', (value, expected) => {
    expect(isStatus(value)).toBe(expected);
  });
});

describe('applyStatusChange', () => {
  const pairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as [Status, Status]));

  it.each(pairs)('%s → %s', (from, to) => {
    const before = app({ status: from, statusHistory: [{ status: from, at: created }] });
    const after = applyStatusChange(before, to, { now, appliedAt: '2026-10-10' });
    if (from === to) {
      expect(after).toBe(before);
      return;
    }
    expect(after.status).toBe(to);
    expect(after.statusHistory).toEqual([
      { status: from, at: created },
      { status: to, at: now.toISOString() },
    ]);
    expect(after.updatedAt).toBe(now.toISOString());
    // The stored date is never overwritten.
    expect(after.appliedAt).toBe('2026-10-01');
    // Append-only: the earlier entry object is untouched.
    expect(before.statusHistory).toHaveLength(1);
  });

  it('starts history for a row that has none', () => {
    const after = applyStatusChange(app({ statusHistory: [] }), 'screening', { now });
    expect(after.statusHistory).toEqual([{ status: 'screening', at: now.toISOString() }]);
    const legacy = { ...app(), statusHistory: undefined } as unknown as Application;
    expect(applyStatusChange(legacy, 'offer', { now }).statusHistory).toHaveLength(1);
  });
});

describe('Date applied when it is empty', () => {
  // Built without an appliedAt key at all, as a stored Saved job would be.
  const saved = () => {
    const { appliedAt: _unused, ...rest } = app({
      status: 'saved',
      statusHistory: [{ status: 'saved', at: created }],
    });
    void _unused;
    return rest as Application;
  };

  it.each([
    ['applied', 'set-today'],
    ['screening', 'ask'],
    ['interviewing', 'ask'],
    ['offer', 'ask'],
    ['accepted', 'ask'],
    ['rejected', 'ask'],
    ['ghosted', 'ask'],
    ['withdrawn', 'none'],
    ['saved', 'none'],
  ] as const)('moving to %s → %s', (next, action) => {
    expect(appliedAtAction(saved(), next)).toBe(action);
  });

  it('never acts when a date is stored', () => {
    for (const next of STATUSES) expect(appliedAtAction(app(), next)).toBe('none');
  });

  it('Applied sets today, as a local date', () => {
    expect(applyStatusChange(saved(), 'applied', { now }).appliedAt).toBe('2026-10-15');
  });

  it('a status that asks uses the date given, or none after Skip', () => {
    expect(
      applyStatusChange(saved(), 'interviewing', { now, appliedAt: '2026-10-03' }).appliedAt,
    ).toBe('2026-10-03');
    expect(applyStatusChange(saved(), 'interviewing', { now })).not.toHaveProperty('appliedAt');
  });

  it('Withdrawn ignores a date and sets none', () => {
    expect(
      applyStatusChange(saved(), 'withdrawn', { now, appliedAt: '2026-10-03' }),
    ).not.toHaveProperty('appliedAt');
  });

  it('a date passed for Applied is ignored in favour of today', () => {
    expect(applyStatusChange(saved(), 'applied', { now, appliedAt: '2026-10-03' }).appliedAt).toBe(
      '2026-10-15',
    );
  });
});

describe('firstEnteredAt', () => {
  it('uses the earliest entry when a status repeats', () => {
    const history = [
      { status: 'interviewing' as const, at: '2026-10-05T10:00:00.000Z' },
      { status: 'screening' as const, at: '2026-10-06T10:00:00.000Z' },
      { status: 'interviewing' as const, at: '2026-10-08T10:00:00.000Z' },
    ];
    expect(firstEnteredAt({ statusHistory: history }, 'interviewing')).toBe(
      '2026-10-05T10:00:00.000Z',
    );
  });

  it('goes by date, not stored order, after a backfill', () => {
    const history = [
      { status: 'interviewing' as const, at: '2026-10-09T10:00:00.000Z' },
      { status: 'interviewing' as const, at: '2026-10-02T10:00:00.000Z' },
    ];
    expect(firstEnteredAt({ statusHistory: history }, 'interviewing')).toBe(
      '2026-10-02T10:00:00.000Z',
    );
  });

  it('is undefined for a status never entered, or no history', () => {
    expect(firstEnteredAt(app(), 'offer')).toBeUndefined();
    expect(firstEnteredAt({ statusHistory: [] }, 'applied')).toBeUndefined();
  });

  it('skips an unreadable timestamp, so a readable later entry still counts', () => {
    const history = [
      { status: 'interviewing' as const, at: 'garbage' },
      { status: 'interviewing' as const, at: '2026-10-05T12:00:00.000Z' },
    ];
    expect(firstEnteredAt({ statusHistory: history }, 'interviewing')).toBe(
      '2026-10-05T12:00:00.000Z',
    );
  });
});
