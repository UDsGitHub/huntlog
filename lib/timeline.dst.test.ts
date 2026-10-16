// Runs in its own process with TZ set, like lib/dates.test.ts.
import { editHistoryDate, localDateOf } from './status';
import type { Application } from './types';

const base = (at: string): Application => ({
  id: 'a1',
  url: 'https://acme.com/1',
  urlNormalized: 'https://acme.com/1',
  company: 'Acme',
  status: 'screening',
  statusHistory: [{ status: 'screening', at }],
  createdAt: at,
  updatedAt: at,
});

describe.each([
  // DST starts at 02:00 here: 02:30 doesn't exist on that day.
  ['America/New_York', '2026-03-08', 2, 30],
  // DST starts at midnight here (Chile): 00:15 doesn't exist on that day.
  ['America/Santiago', '2026-09-06', 0, 15],
])('in %s', (tz, gapDay, hour, minute) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it(`a time that doesn't exist on ${gapDay} still lands on that date`, () => {
    const at = new Date(2026, 0, 10, hour, minute).toISOString();
    const result = editHistoryDate(base(at), 0, gapDay, new Date(2026, 9, 15, 12));
    if (!('application' in result)) throw new Error(result.error);
    expect(localDateOf(result.application.statusHistory[0]!.at)).toBe(gapDay);
  });
});
