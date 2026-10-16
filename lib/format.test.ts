import { formatBytes, formatSalary } from './format';

describe('formatSalary', () => {
  it.each([
    [
      { salaryMin: 85000, salaryMax: 95000, salaryCurrency: 'EUR', salaryPeriod: 'year' },
      'en-US',
      '€85,000–€95,000 per year',
    ],
    [{ salaryMin: 50, salaryCurrency: 'USD', salaryPeriod: 'hour' }, 'en-US', 'From $50 per hour'],
    [
      { salaryMax: 40000, salaryCurrency: 'GBP', salaryPeriod: 'year' },
      'en-GB',
      'Up to £40,000 per year',
    ],
    [
      { salaryMin: 5000, salaryMax: 5000, salaryCurrency: 'USD', salaryPeriod: 'month' },
      'en-US',
      '$5,000 per month',
    ],
    [
      { salaryMin: 45.5, salaryCurrency: 'USD', salaryPeriod: 'hour' },
      'en-US',
      'From $45.50 per hour',
    ],
    [{ salaryMin: 100 }, 'en-US', 'From 100'],
    [
      { salaryMin: 85000, salaryCurrency: undefined, salaryPeriod: 'year' },
      'de-DE',
      'From 85.000 per year',
    ],
    [
      { salaryMin: 45.5, salaryMax: 50, salaryCurrency: 'USD', salaryPeriod: 'hour' },
      'en-US',
      '$45.50–$50.00 per hour',
    ],
  ] as const)('%j in %s → %s', (app, locale, expected) => {
    expect(formatSalary(app, locale)).toBe(expected);
  });

  it('is undefined without a salary', () => {
    expect(formatSalary({ salaryCurrency: 'USD', salaryPeriod: 'year' })).toBeUndefined();
  });

  it('falls back to plain text for a currency Intl rejects', () => {
    // Intl accepts any well-formed 3-letter code; a malformed one (e.g. from an import) throws.
    expect(
      formatSalary({ salaryMin: 1000, salaryCurrency: 'DOLLARS', salaryPeriod: 'year' }, 'en-US'),
    ).toBe('From DOLLARS 1,000 per year');
  });
});

describe('formatBytes', () => {
  it.each([
    [1, '1 byte'],
    [512, '512 bytes'],
    [1024, '1 kB'],
    [245_760, '240 kB'],
    [1_258_291, '1.2 MB'],
    [10 * 1024 * 1024, '10 MB'],
    [1_048_575, '1 MB'],
    [1023, '1,023 bytes'],
    [1_048_064, '1 MB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes, 'en-US')).toBe(expected);
  });
});
