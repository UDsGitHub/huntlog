import {
  activity,
  addDays,
  computeStats,
  daysBetween,
  resolveRange,
  startOfWeek,
  type DateRange,
} from './stats';
import type { Application, Status } from './types';

/** Local noon on a date, as stored: an ISO timestamp. */
const at = (date: string, hour = 12) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};

let seq = 0;
/** An application applied on `appliedAt`, then moved through `steps` ([status, date]). */
function app(
  appliedAt: string | undefined,
  steps: [Status, string][] = [],
  overrides: Partial<Application> = {},
): Application {
  const history = [
    ...(appliedAt ? [{ status: 'applied' as Status, at: at(appliedAt) }] : []),
    ...steps.map(([status, date]) => ({ status, at: at(date) })),
  ];
  const created = history[0]?.at ?? at('2026-01-01');
  return {
    id: `a${++seq}`,
    url: `https://acme.com/${seq}`,
    urlNormalized: `https://acme.com/${seq}`,
    company: 'Acme',
    status: history.at(-1)?.status ?? 'saved',
    statusHistory: history,
    ...(appliedAt && { appliedAt }),
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

// Friday, Oct 16 2026.
const now = new Date(2026, 9, 16, 15);

describe('date helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('counts days with both ends included', () => {
    expect(daysBetween('2026-10-16', '2026-10-16')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31);
  });

  it.each([
    [0, '2026-10-11'], // Sunday
    [1, '2026-10-12'], // Monday
    [6, '2026-10-10'], // Saturday
  ] as const)('week start %i: the week of Fri Oct 16 starts %s', (weekStartsOn, expected) => {
    expect(startOfWeek('2026-10-16', weekStartsOn)).toBe(expected);
  });

  it('a week start day is its own week start', () => {
    expect(startOfWeek('2026-10-12', 1)).toBe('2026-10-12');
    expect(startOfWeek('2026-10-11', 0)).toBe('2026-10-11');
  });
});

describe('resolveRange', () => {
  it.each([
    [0, { from: '2026-10-11', to: '2026-10-17' }],
    [1, { from: '2026-10-12', to: '2026-10-18' }],
    [6, { from: '2026-10-10', to: '2026-10-16' }],
  ] as const)('this week, starting on day %i', (weekStartsOn, expected) => {
    expect(resolveRange('this-week', { now, weekStartsOn })).toEqual(expected);
  });

  it('this week can span a year end', () => {
    const range = resolveRange('this-week', { now: new Date(2027, 0, 1), weekStartsOn: 1 });
    expect(range).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  it('last 7 and 30 days end today', () => {
    expect(resolveRange('last-7-days', { now, weekStartsOn: 1 })).toEqual({
      from: '2026-10-10',
      to: '2026-10-16',
    });
    expect(resolveRange('last-30-days', { now, weekStartsOn: 1 })).toEqual({
      from: '2026-09-17',
      to: '2026-10-16',
    });
  });

  it('this month and this year are whole calendar periods', () => {
    expect(resolveRange('this-month', { now, weekStartsOn: 1 })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const leapFeb = resolveRange('this-month', { now: new Date(2028, 1, 10), weekStartsOn: 1 });
    expect(leapFeb).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolveRange('this-year', { now, weekStartsOn: 1 })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('all time runs from the first thing logged to today', () => {
    const apps = [app('2026-03-04'), app(undefined, [['screening', '2026-02-20']])];
    expect(resolveRange('all-time', { now, weekStartsOn: 1, apps })).toEqual({
      from: '2026-02-20',
      to: '2026-10-16',
    });
  });

  it('all time with no data is just today', () => {
    expect(resolveRange('all-time', { now, weekStartsOn: 1 })).toEqual({
      from: '2026-10-16',
      to: '2026-10-16',
    });
  });

  it('custom puts the dates in order and rejects invalid ones', () => {
    const opts = { now, weekStartsOn: 1 } as const;
    expect(
      resolveRange('custom', { ...opts, custom: { from: '2026-09-01', to: '2026-09-15' } }),
    ).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(
      resolveRange('custom', { ...opts, custom: { from: '2026-09-15', to: '2026-09-01' } }),
    ).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(
      resolveRange('custom', { ...opts, custom: { from: '2026-02-30', to: '2026-03-01' } }),
    ).toBeUndefined();
    expect(resolveRange('custom', { ...opts, custom: { from: '2026-09-01' } })).toBeUndefined();
  });
});

const october: DateRange = { from: '2026-10-01', to: '2026-10-31' };

describe('computeStats', () => {
  it('an empty dataset is all zeros, with no rates', () => {
    const stats = computeStats([], october, 1);
    expect(stats).toMatchObject({
      applied: 0,
      interviews: 0,
      offers: 0,
      responseRate: { count: 0, total: 0 },
      interviewRate: { count: 0, total: 0 },
      outcomes: [],
    });
    expect(stats.activity.buckets).toHaveLength(31);
    expect(stats.activity.buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('counts Applied by Date applied, both range ends included', () => {
    const apps = [app('2026-09-30'), app('2026-10-01'), app('2026-10-31'), app('2026-11-01')];
    expect(computeStats(apps, october, 1).applied).toBe(2);
  });

  it('leaves out deleted applications', () => {
    const apps = [app('2026-10-02'), app('2026-10-03', [], { deletedAt: at('2026-10-04') })];
    expect(computeStats(apps, october, 1).applied).toBe(1);
  });

  it("ignores a Date applied that isn't a real date", () => {
    const bad = ['2026-10-1x', '2026-10-32'].map((appliedAt) =>
      app('2026-10-01', [], { appliedAt }),
    );
    expect(computeStats(bad, october, 1).applied).toBe(0);
  });

  it('a job with no Date applied (Skip) is not applied, but its interview counts', () => {
    const skipped = app(undefined, [['interviewing', '2026-10-05']]);
    const stats = computeStats([skipped], october, 1);
    expect(stats.applied).toBe(0);
    expect(stats.interviews).toBe(1);
    expect(stats.responseRate.total).toBe(0);
  });

  describe('first entered', () => {
    it('counts an interview when it was first reached, not when it was re-entered', () => {
      const back = app('2026-09-01', [
        ['interviewing', '2026-09-20'],
        ['screening', '2026-09-25'],
        ['interviewing', '2026-10-10'],
      ]);
      expect(computeStats([back], october, 1).interviews).toBe(0);
      const september = { from: '2026-09-01', to: '2026-09-30' };
      expect(computeStats([back], september, 1).interviews).toBe(1);
    });

    it('counts each application once, however often it entered the status', () => {
      const twice = app('2026-10-01', [
        ['interviewing', '2026-10-05'],
        ['screening', '2026-10-06'],
        ['interviewing', '2026-10-07'],
      ]);
      expect(computeStats([twice], october, 1).interviews).toBe(1);
    });

    it('uses the earliest date, not the stored order (dates can be backfilled)', () => {
      const backfilled = app('2026-09-01');
      backfilled.statusHistory.push(
        { status: 'interviewing', at: at('2026-10-20') },
        { status: 'interviewing', at: at('2026-09-15') },
      );
      expect(computeStats([backfilled], october, 1).interviews).toBe(0);
    });

    it('counts offers by the day they first came', () => {
      const apps = [
        app('2026-09-01', [['offer', '2026-10-31']]),
        app('2026-09-01', [['offer', '2026-11-01']]),
      ];
      expect(computeStats(apps, october, 1).offers).toBe(1);
    });

    it('uses the local date of the timestamp', () => {
      // 23:00 local on Oct 31: in some time zones that's already Nov 1 in UTC.
      const late = app('2026-10-01', [['interviewing', '2026-10-31']]);
      late.statusHistory[1]!.at = at('2026-10-31', 23);
      expect(computeStats([late], october, 1).interviews).toBe(1);
    });
  });

  describe('rates', () => {
    it('response rate: of those applied in range, any later stage counts, even after the range', () => {
      const apps = [
        app('2026-10-01', [['screening', '2026-11-05']]),
        app('2026-10-02', [['rejected', '2026-10-09']]),
        app('2026-10-03', [['ghosted', '2026-10-30']]),
        app('2026-10-04', [['withdrawn', '2026-10-10']]),
        app('2026-10-05'),
        // Applied before the range: not in the base, even with a response inside it.
        app('2026-09-01', [['screening', '2026-10-02']]),
      ];
      expect(computeStats(apps, october, 1).responseRate).toEqual({
        count: 2,
        total: 5,
        percent: 40,
      });
    });

    it('a response that went quiet later still counts', () => {
      const apps = [
        app('2026-10-01', [
          ['screening', '2026-10-03'],
          ['ghosted', '2026-10-25'],
        ]),
      ];
      expect(computeStats(apps, october, 1).responseRate.percent).toBe(100);
    });

    it('interview rate: Interviewing or later', () => {
      const apps = [
        app('2026-10-01', [['interviewing', '2026-10-08']]),
        app('2026-10-02', [
          ['interviewing', '2026-10-08'],
          ['rejected', '2026-10-20'],
        ]),
        app('2026-10-03', [['offer', '2026-10-20']]), // straight to an offer
        app('2026-10-04', [
          ['screening', '2026-10-06'],
          ['rejected', '2026-10-09'],
        ]),
      ];
      expect(computeStats(apps, october, 1).interviewRate).toEqual({
        count: 3,
        total: 4,
        percent: 75,
      });
    });

    it('rounds the percentage', () => {
      const apps = [
        app('2026-10-01', [['screening', '2026-10-02']]),
        app('2026-10-02'),
        app('2026-10-03'),
      ];
      expect(computeStats(apps, october, 1).responseRate.percent).toBe(33);
    });

    it('reads the current status when the history is missing (imported data)', () => {
      const imported = app('2026-10-01', [], { status: 'interviewing', statusHistory: [] });
      const stats = computeStats([imported], october, 1);
      expect(stats.responseRate.count).toBe(1);
      expect(stats.interviewRate.count).toBe(1);
    });
  });

  it('outcomes: current statuses of those applied in range, in pipeline order', () => {
    const apps = [
      app('2026-10-01', [['rejected', '2026-10-09']]),
      app('2026-10-02', [['rejected', '2026-10-10']]),
      app('2026-10-03'),
      app('2026-10-04', [['interviewing', '2026-10-09']]),
      app('2026-09-04', [['offer', '2026-10-09']]), // applied before the range
    ];
    expect(computeStats(apps, october, 1).outcomes).toEqual([
      { status: 'applied', count: 1 },
      { status: 'interviewing', count: 1 },
      { status: 'rejected', count: 2 },
    ]);
  });
});

describe('activity', () => {
  it('per day for a month, counted by Date applied', () => {
    const apps = [app('2026-10-01'), app('2026-10-01'), app('2026-10-31')];
    const result = computeStats(apps, october, 1).activity;
    expect(result.unit).toBe('day');
    expect(result.buckets).toHaveLength(31);
    expect(result.buckets[0]).toEqual({ from: '2026-10-01', to: '2026-10-01', count: 2 });
    expect(result.buckets[30]).toEqual({ from: '2026-10-31', to: '2026-10-31', count: 1 });
  });

  it('per day up to 31 days, per week beyond', () => {
    expect(activity([], { from: '2026-10-01', to: '2026-10-31' }, 1).unit).toBe('day');
    expect(activity([], { from: '2026-10-01', to: '2026-11-01' }, 1).unit).toBe('week');
  });

  it('weeks follow the week start, clamped to the range', () => {
    // Thu Oct 1 to Wed Nov 11, 2026.
    const range = { from: '2026-10-01', to: '2026-11-11' };
    const apps = [app('2026-10-01'), app('2026-10-04'), app('2026-10-05'), app('2026-11-11')];
    const monday = activity(apps, range, 1).buckets;
    expect(monday[0]).toEqual({ from: '2026-10-01', to: '2026-10-04', count: 2 });
    expect(monday[1]).toEqual({ from: '2026-10-05', to: '2026-10-11', count: 1 });
    expect(monday.at(-1)).toEqual({ from: '2026-11-09', to: '2026-11-11', count: 1 });
    const sunday = activity(apps, range, 0).buckets;
    expect(sunday[0]).toEqual({ from: '2026-10-01', to: '2026-10-03', count: 1 });
    expect(sunday[1]).toEqual({ from: '2026-10-04', to: '2026-10-10', count: 2 });
  });

  it('a year has a bucket per week that touches it', () => {
    const buckets = activity([], { from: '2026-01-01', to: '2026-12-31' }, 1).buckets;
    // Thu Jan 1 is in the week of Mon Dec 29; Thu Dec 31 in the week of Mon Dec 28.
    expect(buckets).toHaveLength(53);
    expect(buckets[0]?.from).toBe('2026-01-01');
    expect(buckets.at(-1)).toMatchObject({ from: '2026-12-28', to: '2026-12-31' });
  });
});

describe('across a DST change', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('days stay whole calendar days', () => {
    // DST ends Nov 1 2026 and starts Mar 8 2026 in New York.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-10-25', '2026-11-07')).toBe(14);
    const weeks = activity([], { from: '2026-10-26', to: '2026-11-08' }, 1).buckets;
    expect(weeks).toHaveLength(14); // 14 days: still per day
    expect(weeks.at(-1)!.from).toBe('2026-11-08');
  });
});
