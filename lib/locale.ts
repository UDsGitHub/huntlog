const EURO_REGIONS = [
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
];

/** Intl can't map a region to its currency, so common regions are listed; everything else is USD. */
const REGION_CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, 'EUR'])),
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  IN: 'INR',
  JP: 'JPY',
  CN: 'CNY',
  KR: 'KRW',
  SG: 'SGD',
  HK: 'HKD',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BR: 'BRL',
  MX: 'MXN',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  ZA: 'ZAR',
  NG: 'NGN',
  KE: 'KES',
  EG: 'EGP',
  IL: 'ILS',
  AE: 'AED',
  SA: 'SAR',
  TR: 'TRY',
  PH: 'PHP',
  ID: 'IDR',
  MY: 'MYR',
  TH: 'THB',
  VN: 'VND',
  PK: 'PKR',
  BD: 'BDT',
  UA: 'UAH',
};

export const FALLBACK_CURRENCY = 'USD';

/** Default salary currency (spec §5): from the locale's region, or USD. Never throws. */
export function defaultCurrency(locale?: string): string {
  try {
    const tag = locale ?? globalThis.navigator?.language ?? 'en-US';
    const region = new Intl.Locale(tag).maximize().region;
    return (region && REGION_CURRENCY[region]) || FALLBACK_CURRENCY;
  } catch {
    return FALLBACK_CURRENCY;
  }
}

let currencies: string[] | undefined;
let currencySet: Set<string> | undefined;

/** ISO 4217 codes the runtime knows, for the currency picker. Computed once per session. */
export function knownCurrencies(): string[] {
  if (!currencies) {
    try {
      currencies = Intl.supportedValuesOf('currency');
    } catch {
      currencies = [...new Set(Object.values(REGION_CURRENCY))].sort();
    }
  }
  return currencies;
}

export function isKnownCurrency(code: string): boolean {
  currencySet ??= new Set(knownCurrencies());
  return currencySet.has(code);
}

/**
 * The locale's grouping and decimal separators (`.` and `,` for de-DE), and whether it groups
 * in twos above the thousands, like en-IN's `12,34,567`.
 */
export function numberSeparators(locale?: string): {
  group: string;
  decimal: string;
  indianGrouping: boolean;
} {
  try {
    const format = new Intl.NumberFormat(locale);
    const parts = format.formatToParts(1234567.5);
    const integerGroups = parts.filter((p) => p.type === 'integer').map((p) => p.value);
    return {
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
      indianGrouping: integerGroups.join(',') === '12,34,567',
    };
  } catch {
    return { group: ',', decimal: '.', indianGrouping: false };
  }
}

/** Shown first in the currency picker, after the locale's own (spec §4.2). */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP'];

const ordered = new Map<string, { common: string[]; others: string[] }>();

/**
 * Currencies for the picker: the locale's default plus USD, EUR and GBP first (no repeats), then
 * every other known code alphabetically. `include` adds a stored code the runtime doesn't know
 * (old or imported data), so editing never silently swaps it for another.
 */
export function orderedCurrencies(
  locale?: string,
  include?: string,
): { common: string[]; others: string[] } {
  const key = locale ?? '';
  let lists = ordered.get(key);
  if (!lists) {
    const common = [...new Set([defaultCurrency(locale), ...COMMON_CURRENCIES])].filter((code) =>
      isKnownCurrency(code),
    );
    const others = knownCurrencies()
      .filter((code) => !common.includes(code))
      .sort();
    lists = { common, others };
    ordered.set(key, lists);
  }
  if (include && !lists.common.includes(include) && !lists.others.includes(include)) {
    return { common: [...lists.common, include], others: lists.others };
  }
  return lists;
}
