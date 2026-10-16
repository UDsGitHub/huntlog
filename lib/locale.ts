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
