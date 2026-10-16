import { formatLocalDate, formatTimestampDate, todayLocal } from './dates';

describe('todayLocal', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
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

describe('formatLocalDate', () => {
  it.each([
    ['2026-10-01', 'en-US', 'Oct 1, 2026'],
    ['2026-10-01', 'en-GB', '1 Oct 2026'],
    ['2026-01-31', 'de-DE', '31.01.2026'],
  ])('%s in %s → %s', (value, locale, expected) => {
    expect(formatLocalDate(value, locale)).toBe(expected);
  });

  it('never shifts the day, whatever the time zone', () => {
    // A UTC parse of "2026-10-01" shows Sep 30 west of UTC; local parts don't.
    expect(formatLocalDate('2026-10-01', 'en-US')).toBe('Oct 1, 2026');
  });

  it.each([['not a date'], ['2026-02-30'], ['']])('shows %j as stored', (value) => {
    expect(formatLocalDate(value, 'en-US')).toBe(value);
  });
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
