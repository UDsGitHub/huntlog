import { parseSalary } from './applicationInput';
import { formatAmount, formatNumber, numberFieldText } from './numberInput';

describe('numberFieldText', () => {
  it('keeps only digits for an integer', () => {
    expect(numberFieldText('12', 'integer')).toBe('12');
    expect(numberFieldText('1e1', 'integer')).toBe('11');
    expect(numberFieldText('-3', 'integer')).toBe('3');
    expect(numberFieldText('2.5', 'integer')).toBe('25');
    expect(numberFieldText('abc', 'integer')).toBe('');
  });

  it("keeps the locale's separators for an amount, dropping symbols and letters", () => {
    expect(numberFieldText('$85,000/yr', 'amount', 'en-US')).toBe('85,000');
    expect(numberFieldText('22.50', 'amount', 'en-US')).toBe('22.50');
    expect(numberFieldText('€ 85.000,50', 'amount', 'de-DE')).toBe('85.000,50');
    expect(numberFieldText('8,50,000 INR', 'amount', 'en-IN')).toBe('8,50,000 ');
  });

  it('keeps spaces, which group digits in some locales, even while typing', () => {
    expect(numberFieldText('85 ', 'amount', 'fr-FR')).toBe('85 ');
    expect(numberFieldText('85 000', 'amount', 'fr-FR')).toBe('85 000');
    expect(numberFieldText('  85', 'amount', 'en-US')).toBe('85');
  });

  it('never turns valid input into something else', () => {
    for (const [text, locale] of [
      ['85,000', 'en-US'],
      ['85.000', 'de-DE'],
      ['8,50,000', 'en-IN'],
      ['22.5', 'en-US'],
    ] as const) {
      expect(numberFieldText(text, 'amount', locale)).toBe(text);
    }
  });
});

describe('formatAmount', () => {
  it("groups a valid amount in the locale's style", () => {
    expect(formatAmount('85000', 'en-US')).toBe('85,000');
    expect(formatAmount('85000', 'de-DE')).toBe('85.000');
    expect(formatAmount('850000', 'en-IN')).toBe('8,50,000');
    expect(formatAmount('22.5', 'en-US')).toBe('22.5');
    expect(formatAmount('85,000.25', 'en-US')).toBe('85,000.25');
  });

  it('leaves blank or invalid text as typed, for its error to explain', () => {
    expect(formatAmount('', 'en-US')).toBe('');
    expect(formatAmount('85.000', 'en-US')).toBe('85.000');
    expect(formatAmount('1,2,3', 'en-US')).toBe('1,2,3');
  });

  it('shows numbers that read back as the same number, in every locale', () => {
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'en-IN']) {
      expect(parseSalary(formatNumber(123456.78, locale), locale)).toBe(123456.78);
    }
  });
});
