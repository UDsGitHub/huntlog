import type { Application } from './types';

const PERIOD_LABELS = { year: 'year', month: 'month', hour: 'hour' } as const;

/** "€85,000–€95,000 per year", "From $50 per hour", "Up to £40,000 per year", or undefined. */
export function formatSalary(
  app: Pick<Application, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>,
  locale?: string,
): string | undefined {
  const { salaryMin: min, salaryMax: max, salaryCurrency, salaryPeriod } = app;
  if (min === undefined && max === undefined) return undefined;
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: salaryCurrency ?? 'USD',
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value);
    } catch {
      // An unknown currency from an import shouldn't break the detail view.
      return `${salaryCurrency ?? ''} ${value.toLocaleString(locale)}`.trim();
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
