import { defaultCurrency, FALLBACK_CURRENCY, knownCurrencies } from './locale';

describe('defaultCurrency', () => {
  it.each([
    ['en-US', 'USD'],
    ['en-GB', 'GBP'],
    ['en-CA', 'CAD'],
    ['fr-CA', 'CAD'],
    ['de-DE', 'EUR'],
    ['fr', 'EUR'],
    ['ja', 'JPY'],
    ['en-IN', 'INR'],
    ['pt-BR', 'BRL'],
    ['en-NG', 'NGN'],
  ])('%s → %s', (locale, expected) => {
    expect(defaultCurrency(locale)).toBe(expected);
  });

  it.each([['en-AQ'], ['tlh'], ['not a locale!!'], ['']])('falls back to USD for %j', (locale) => {
    expect(defaultCurrency(locale)).toBe(FALLBACK_CURRENCY);
  });
});

describe('knownCurrencies', () => {
  it('includes the common ISO 4217 codes', () => {
    expect(knownCurrencies()).toEqual(expect.arrayContaining(['USD', 'EUR', 'GBP', 'JPY', 'NGN']));
  });
});
