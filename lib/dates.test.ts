import {
  formatLocalDate,
  formatShortLocalDate,
  formatTimestampDate,
  msUntilNextDay,
  todayLocal,
} from './dates';

describe('todayLocal', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    // Assigning undefined would store the string "undefined" (read as UTC), not unset it.
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('formats as zero-padded YYYY-MM-DD', () => {
    process.env.TZ = 'UTC';
    expect(todayLocal(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05');
  });

  it('uses the local date late in the evening west of UTC', () => {
    process.env.TZ = 'America/Chicago';
    // 23:30 in Chicago on Oct 15 is already Oct 16 in UTC.
    expect(todayLocal(new Date('2026-10-16T04:30:00Z'))).toBe('2026-10-15');
  });

  it('uses the local date early in the morning east of UTC', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 00:30 in Tokyo on Oct 16 is still Oct 15 in UTC.
    expect(todayLocal(new Date('2026-10-15T15:30:00Z'))).toBe('2026-10-16');
  });
});

describe('msUntilNextDay', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  const HOUR = 3_600_000;

  it('counts to the next local midnight', () => {
    process.env.TZ = 'America/New_York';
    expect(msUntilNextDay(new Date(2026, 9, 16, 23, 30))).toBe(HOUR / 2);
    expect(msUntilNextDay(new Date(2026, 9, 16, 0, 0))).toBe(24 * HOUR);
  });

  it('follows a DST day: 23 hours in spring, 25 in autumn', () => {
    process.env.TZ = 'America/New_York';
    expect(msUntilNextDay(new Date(2026, 2, 8, 0, 0))).toBe(23 * HOUR);
    expect(msUntilNextDay(new Date(2026, 10, 1, 0, 0))).toBe(25 * HOUR);
  });
});

describe('formatLocalDate', () => {
  it.each([
    ['2026-10-01', 'en-US', 'Oct 1, 2026'],
    ['2026-10-01', 'en-GB', '1 Oct 2026'],
    ['2026-01-31', 'de-DE', '31.01.2026'],
  ])('%s in %s → %s', (value, locale, expected) => {
    expect(formatLocalDate(value, locale)).toBe(expected);
  });

  it.each([['America/Chicago'], ['Pacific/Auckland'], ['UTC']])(
    'never shifts the day in %s',
    (tz) => {
      // A UTC parse of "2026-10-01" shows Sep 30 west of UTC; local parts don't.
      const original = process.env.TZ;
      process.env.TZ = tz;
      try {
        expect(formatLocalDate('2026-10-01', 'en-US')).toBe('Oct 1, 2026');
      } finally {
        process.env.TZ = original;
      }
    },
  );

  it.each([['not a date'], ['2026-02-30'], ['']])('shows %j as stored', (value) => {
    expect(formatLocalDate(value, 'en-US')).toBe(value);
  });
});

it('keeps formatting the right day after the time zone changes (cached formatters)', () => {
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Pacific/Auckland', 'America/Chicago', 'Asia/Kolkata']) {
      process.env.TZ = tz;
      expect(formatLocalDate('2026-10-01', 'en-US')).toBe('Oct 1, 2026');
      expect(formatTimestampDate(new Date(2026, 9, 1, 23, 30).toISOString(), 'en-US')).toBe(
        'Oct 1, 2026',
      );
    }
  } finally {
    process.env.TZ = original;
  }
});

describe('formatTimestampDate', () => {
  it('formats the local calendar date of a timestamp', () => {
    const local = new Date(2026, 9, 1, 23, 30).toISOString();
    expect(formatTimestampDate(local, 'en-US')).toBe('Oct 1, 2026');
  });

  it('shows an unreadable timestamp as stored', () => {
    expect(formatTimestampDate('garbage', 'en-US')).toBe('garbage');
  });
});

describe('formatShortLocalDate', () => {
  it.each([
    ['2026-10-01', 'day-month', 'en-US', 'Oct 1'],
    ['2026-10-01', 'day-month', 'en-GB', '1 Oct'],
    ['2026-10-01', 'month-year', 'en-US', 'Oct 2026'],
    ['2026-01-01', 'day-month', 'en-US', 'Jan 1'],
  ] as const)('%s as %s in %s → %s', (value, style, locale, expected) => {
    expect(formatShortLocalDate(value, style, locale)).toBe(expected);
  });

  it('never shifts a day west of UTC', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatShortLocalDate('2026-10-01', 'day-month', 'en-US')).toBe('Oct 1');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('shows an invalid value as stored', () => {
    expect(formatShortLocalDate('2026-02-30', 'day-month', 'en-US')).toBe('2026-02-30');
  });
});
