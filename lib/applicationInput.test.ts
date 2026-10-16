import {
  MAX_LOCATION_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SOURCE_LENGTH,
  normalizeInputUrl,
  parseSalary,
  validateApplication,
  type ApplicationInput,
} from './applicationInput';

const base: ApplicationInput = { url: 'https://acme.com/jobs/1', company: 'Acme' };
// Local noon, so "today" is Oct 15 whatever time zone the tests run in.
const now = new Date(2026, 9, 15, 12, 0, 0);

function errorsOf(input: Partial<ApplicationInput>) {
  return validateApplication({ ...base, ...input }, now, 'en-US').errors;
}
function valuesOf(input: Partial<ApplicationInput>, locale = 'en-US') {
  const { values, errors } = validateApplication({ ...base, ...input }, now, locale);
  expect(errors).toEqual({});
  return values!;
}

describe('normalizeInputUrl', () => {
  it.each([
    ['https://example.com/jobs/1', 'https://example.com/jobs/1'],
    ['  http://example.com/a  ', 'http://example.com/a'],
    ['example.com/jobs/1', 'https://example.com/jobs/1'],
    [
      'boards.greenhouse.io/acme/jobs/123?gh_jid=123',
      'https://boards.greenhouse.io/acme/jobs/123?gh_jid=123',
    ],
    ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['careers.acme.com:8443/jobs/12', 'https://careers.acme.com:8443/jobs/12'],
    ['localhost:3000/jobs/1', 'https://localhost:3000/jobs/1'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeInputUrl(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<b>x</b>'],
    ['ftp://example.com/file'],
    ['chrome://extensions'],
    ['https://'],
    ['http://exa mple.com'],
    ['mailto:jobs@acme.com'],
  ])('rejects %j', (input) => {
    expect(normalizeInputUrl(input)).toBeNull();
  });
});

describe('parseSalary', () => {
  it.each([
    ['120000', 120000],
    ['120,000', 120000],
    ['120 000', 120000],
    ['120 000', 120000],
    ['120 000', 120000],
    ['45.50', 45.5],
    [' 85000 ', 85000],
    [85000, 85000],
    ['0', 0],
  ])('%j → %d', (input, expected) => {
    expect(parseSalary(input)).toBe(expected);
  });

  it.each([[undefined], [''], ['   ']])('treats %j as not given', (input) => {
    expect(parseSalary(input)).toBeUndefined();
  });

  it.each([['-5'], ['abc'], ['120k'], ['$120,000'], ['1.2.3'], ['1e6'], [NaN], [Infinity]])(
    'rejects %j',
    (input) => {
      expect(parseSalary(input)).toBeNaN();
    },
  );
});

describe('validateApplication', () => {
  it('accepts the minimum and defaults Date applied to today (local)', () => {
    expect(valuesOf({})).toEqual({
      url: 'https://acme.com/jobs/1',
      company: 'Acme',
      appliedAt: '2026-10-15',
    });
  });

  it('keeps every optional field, trimmed and typed', () => {
    expect(
      valuesOf({
        title: '  Senior  Engineer ',
        location: '  Berlin, DE ',
        workMode: 'hybrid',
        salaryMin: '85,000',
        salaryMax: 95000,
        salaryCurrency: 'eur',
        salaryPeriod: 'year',
        source: ' Referral ',
        notes: '  Line one\n\nLine two  ',
        appliedAt: '2026-10-01',
      }),
    ).toEqual({
      url: 'https://acme.com/jobs/1',
      company: 'Acme',
      title: 'Senior Engineer',
      location: 'Berlin, DE',
      workMode: 'hybrid',
      salaryMin: 85000,
      salaryMax: 95000,
      salaryCurrency: 'EUR',
      salaryPeriod: 'year',
      source: 'Referral',
      notes: 'Line one\n\nLine two',
      appliedAt: '2026-10-01',
    });
  });

  it('leaves out blank optional fields instead of storing empty strings', () => {
    const values = valuesOf({
      title: ' ',
      location: '',
      workMode: '',
      salaryMin: '',
      salaryMax: ' ',
      salaryCurrency: 'USD',
      salaryPeriod: 'month',
      source: '  ',
      notes: '\n',
    });
    expect(Object.keys(values).sort()).toEqual(['appliedAt', 'company', 'url']);
  });

  it.each([
    [{ url: '' }, 'url', 'Enter the job posting URL.'],
    [{ url: 'javascript:alert(1)' }, 'url', 'Enter a valid web address (http or https).'],
    [{ company: '   ' }, 'company', 'Enter the company name.'],
    [{ workMode: 'office' }, 'workMode', 'Choose remote, hybrid or on-site.'],
    [{ salaryMin: '-1' }, 'salaryMin', 'Enter a number, like 85,000.'],
    [{ salaryMax: 'lots' }, 'salaryMax', 'Enter a number, like 85,000.'],
    [{ salaryMin: '2000000000' }, 'salaryMin', 'That number is too large.'],
    [
      { salaryMin: '90000', salaryMax: '80000' },
      'salaryMax',
      'Maximum must be at least the minimum.',
    ],
    [
      { salaryMin: '1', salaryCurrency: 'DOLLARS' },
      'salaryCurrency',
      'Choose a currency code, like USD or EUR.',
    ],
    [
      { salaryMin: '1', salaryCurrency: 'XYZ' },
      'salaryCurrency',
      'Choose a currency code, like USD or EUR.',
    ],
    [{ salaryMin: '1', salaryPeriod: 'week' }, 'salaryPeriod', 'Choose per year, month or hour.'],
    [{ appliedAt: '' }, 'appliedAt', 'Enter the date you applied.'],
    [{ appliedAt: '2026-02-30' }, 'appliedAt', 'Enter a valid date.'],
    [{ appliedAt: '15/10/2026' }, 'appliedAt', 'Enter a valid date.'],
    [{ appliedAt: '2026-10-16' }, 'appliedAt', "The date applied can't be in the future."],
    [
      { location: 'x'.repeat(MAX_LOCATION_LENGTH + 1) },
      'location',
      'Location must be 200 characters or fewer.',
    ],
    [
      { source: 'x'.repeat(MAX_SOURCE_LENGTH + 1) },
      'source',
      'Source must be 100 characters or fewer.',
    ],
    [
      { notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) },
      'notes',
      'Notes must be 10,000 characters or fewer.',
    ],
  ])('reports %j on %s', (input, field, message) => {
    expect(errorsOf(input)).toEqual({ [field]: message });
  });

  it('accepts text exactly at each length cap', () => {
    expect(
      errorsOf({
        location: 'x'.repeat(MAX_LOCATION_LENGTH),
        source: 'x'.repeat(MAX_SOURCE_LENGTH),
        notes: 'x'.repeat(MAX_NOTES_LENGTH),
      }),
    ).toEqual({});
  });

  it('reports every invalid field at once', () => {
    expect(
      Object.keys(errorsOf({ url: '', company: '', salaryMin: 'x', appliedAt: '' })).sort(),
    ).toEqual(['appliedAt', 'company', 'salaryMin', 'url']);
  });

  it('allows a minimum or a maximum alone, and equal values', () => {
    expect(valuesOf({ salaryMin: '50000' })).toMatchObject({ salaryMin: 50000 });
    expect(valuesOf({ salaryMax: '50000' })).toMatchObject({ salaryMax: 50000 });
    expect(valuesOf({ salaryMin: '5', salaryMax: '5' })).toMatchObject({
      salaryMin: 5,
      salaryMax: 5,
    });
  });

  it('defaults currency from the locale region and the period to a year', () => {
    expect(valuesOf({ salaryMin: '1' }, 'en-GB')).toMatchObject({
      salaryCurrency: 'GBP',
      salaryPeriod: 'year',
    });
    expect(valuesOf({ salaryMin: '1' }, 'de-DE')).toMatchObject({ salaryCurrency: 'EUR' });
    expect(valuesOf({ salaryMin: '1' }, 'ja')).toMatchObject({ salaryCurrency: 'JPY' });
  });

  it('accepts today as the date applied', () => {
    expect(valuesOf({ appliedAt: '2026-10-15' }).appliedAt).toBe('2026-10-15');
  });
});
