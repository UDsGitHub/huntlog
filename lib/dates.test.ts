import { todayLocal } from './dates';

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
