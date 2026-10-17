import {
  currencyLabel,
  defaultCurrency,
  FALLBACK_CURRENCY,
  knownCurrencies,
  localeWeekStart,
  orderedCurrencies,
} from './locale';

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

describe('localeWeekStart', () => {
  it.each([
    ['en-US', 0],
    ['en-CA', 0],
    ['de-DE', 1],
    ['en-GB', 1],
    ['fr-FR', 1],
    ['ar-EG', 6],
  ] as const)('%s starts the week on day %i', (locale, expected) => {
    expect(localeWeekStart(locale)).toBe(expected);
  });

  it.each([['not a locale!!'], ['']])('falls back to Monday for %j', (locale) => {
    expect(localeWeekStart(locale)).toBe(1);
  });
});

describe('currencyLabel', () => {
  it('shows the code and the name, so either finds it', () => {
    expect(currencyLabel('EUR', 'en-US')).toBe('EUR · Euro');
    expect(currencyLabel('JPY', 'en-US')).toBe('JPY · Japanese Yen');
  });
  it('falls back to the code when there is no name', () => {
    expect(currencyLabel('XYZ', 'en-US')).toBe('XYZ');
    expect(currencyLabel('not a code', 'en-US')).toBe('not a code');
  });
});
