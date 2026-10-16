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

/** ISO 4217 codes the runtime knows, for validation and the currency picker. */
export function knownCurrencies(): string[] {
  try {
    return Intl.supportedValuesOf('currency');
  } catch {
    return Object.values(REGION_CURRENCY)
      .filter((c, i, all) => all.indexOf(c) === i)
      .sort();
  }
}
