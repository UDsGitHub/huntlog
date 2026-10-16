import { defaultCurrency, FALLBACK_CURRENCY, knownCurrencies, orderedCurrencies } from './locale';

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

describe('orderedCurrencies', () => {
  it('puts the locale default and USD, EUR, GBP first, without repeats', () => {
    expect(orderedCurrencies('ja').common).toEqual(['JPY', 'USD', 'EUR', 'GBP']);
    expect(orderedCurrencies('en-US').common).toEqual(['USD', 'EUR', 'GBP']);
    expect(orderedCurrencies('de-DE').common).toEqual(['EUR', 'USD', 'GBP']);
  });

  it('lists every other known code once, alphabetically', () => {
    const { common, others } = orderedCurrencies('ja');
    expect(others).toEqual([...others].sort());
    expect(others.some((code) => common.includes(code))).toBe(false);
    expect(new Set([...common, ...others])).toEqual(new Set(knownCurrencies()));
  });
});

it('keeps a stored currency the runtime does not know', () => {
  expect(orderedCurrencies('en-US', 'XYZ').common).toEqual(['USD', 'EUR', 'GBP', 'XYZ']);
  expect(orderedCurrencies('en-US', 'EUR').common).toEqual(['USD', 'EUR', 'GBP']);
});
