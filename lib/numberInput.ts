import { parseSalary } from './applicationInput';
import { numberSeparators } from './locale';

/** `integer`: digits only (the weekly goal). `amount`: a locale-formatted number (salaries). */
export type NumberKind = 'integer' | 'amount';

/**
 * What a number field keeps of typed or pasted text (spec §3): digits, plus for an amount the
 * locale's grouping and decimal separators and spaces. Anything else is dropped, so a pasted
 * "$85,000/yr" becomes "85,000". Validation stays with the parser (`parseSalary`, spec §5).
 */
export function numberFieldText(raw: string, kind: NumberKind, locale?: string): string {
  if (kind === 'integer') return raw.replace(/\D/g, '');
  const { group, decimal } = numberSeparators(locale);
  const allowed = new Set([...'0123456789', group, decimal, ' ', ' ', ' ']);
  // Leading spaces only come from pasting around a symbol ("$ 85"); trailing ones may be the
  // start of a space-grouped number being typed ("85 000"), so they stay.
  return [...raw]
    .filter((char) => allowed.has(char))
    .join('')
    .trimStart();
}

/**
 * A number in the locale's style, grouped, with up to two decimals: 85000 → "85,000". Always in
 * Latin digits, which is what the field accepts and the parser reads (ar-EG's own digits aren't).
 */
export function formatNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    numberingSystem: 'latn',
  }).format(value);
}

/**
 * An amount as shown once its field is left: grouped in the locale's style ("85000" →
 * "85,000"). Text that isn't a valid amount is left as typed, so its error can say why.
 */
export function formatAmount(raw: string, locale?: string): string {
  const value = parseSalary(raw, locale);
  return value === undefined || Number.isNaN(value) ? raw : formatNumber(value, locale);
}
