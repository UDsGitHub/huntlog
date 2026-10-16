import type { Application } from './types';

const PERIOD_LABELS = { year: 'year', month: 'month', hour: 'hour' } as const;

/**
 * "€85,000–€95,000 per year", "From $50 per hour", "Up to £40,000 per year", or undefined.
 * Both ends of a range use the same number of decimals. Without a currency (e.g. an import),
 * the amount is shown as a plain number rather than guessing a symbol.
 */
export function formatSalary(
  app: Pick<Application, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>,
  locale?: string,
): string | undefined {
  const { salaryMin: min, salaryMax: max, salaryCurrency, salaryPeriod } = app;
  if (min === undefined && max === undefined) return undefined;
  const decimals = [min, max].some((v) => v !== undefined && !Number.isInteger(v)) ? 2 : 0;
  const plain = (value: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  const money = (value: number) => {
    if (!salaryCurrency) return plain(value);
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: salaryCurrency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    } catch {
      // A malformed currency from an import shouldn't break the detail view.
      return `${salaryCurrency} ${plain(value)}`;
    }
  };
  const range =
    min !== undefined && max !== undefined
      ? min === max
        ? money(min)
        : `${money(min)}–${money(max)}`
      : min !== undefined
        ? `From ${money(min)}`
        : `Up to ${money(max!)}`;
  return salaryPeriod ? `${range} per ${PERIOD_LABELS[salaryPeriod]}` : range;
}
