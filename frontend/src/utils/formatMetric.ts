/**
 * Unified metric formatter — zero-safe, tnum-ready.
 *
 * All numeric formatting flows through this function to guarantee:
 *   1. Zero renders as a value (never treated as missing)
 *   2. null/undefined render as '—'
 *   3. Consistent decimal precision per type
 *   4. Sign prefix when requested
 *
 * The caller must still apply the `tnum` CSS class for tabular alignment.
 *
 * Usage:
 *   formatMetric(1234.5, { type: 'currency' })              → '$1,234.50'
 *   formatMetric(-0.032, { type: 'percent' })                → '-3.20%'
 *   formatMetric(0, { type: 'currency', showSign: true })    → '+$0.00'
 *   formatMetric(null, { type: 'number' })                   → '—'
 */

type MetricType = 'currency' | 'percent' | 'number' | 'greek'

interface FormatOptions {
  type: MetricType
  precision?: number
  showSign?: boolean
}

/** Zero-safe presence check */
export function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined
}

const FORMATTERS = {
  currency: (n: number, p: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    }).format(n),
  number: (n: number, p: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    }).format(n),
  greek: (n: number, p: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    }).format(n),
  percent: (n: number, p: number) =>
    `${n.toFixed(p)}%`,
}

const DEFAULT_PRECISION: Record<MetricType, number> = {
  currency: 2,
  percent:  2,
  number:   2,
  greek:    4,
}

export function formatMetric(
  value: string | number | null | undefined,
  options: FormatOptions,
): string {
  // null/undefined → missing
  if (value === null || value === undefined) return '—'

  // Parse if string
  const n = typeof value === 'string' ? parseFloat(value) : value

  // NaN → missing (but preserve 0)
  if (typeof n !== 'number' || isNaN(n)) return '—'

  const precision = options.precision ?? DEFAULT_PRECISION[options.type]
  const formatter = FORMATTERS[options.type]
  const formatted = formatter(Math.abs(n), precision)

  if (options.showSign) {
    const sign = n >= 0 ? '+' : '-'
    return options.type === 'currency'
      ? `${sign}${formatted}`
      : `${sign}${formatted}`
  }

  return n < 0
    ? (options.type === 'currency' ? `-${formatted}` : `-${formatted}`)
    : formatted
}
