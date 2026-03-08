/**
 * Formatting utilities for financial data.
 * Backend returns Decimal values as strings (e.g. "499.25781500").
 * All functions accept string | null | undefined and degrade gracefully.
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUM2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUM4 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

// ── Core formatters ───────────────────────────────────────────────────────────

/** "$250,000.00" */
export function fmtUSD(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isNaN(n) ? '—' : USD.format(n)
}

/** "+$15,000.00" or "-$3,000.00" */
export function fmtUSDSigned(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '—'
  return (n >= 0 ? '+' : '') + USD.format(n)
}

/** "499.26" (2 decimal places, thousands separator) */
export function fmtNum(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isNaN(n) ? '—' : NUM2.format(n)
}

/** "-0.9985" (4 decimal places) — for Greeks */
export function fmtGreek(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isNaN(n) ? '—' : NUM4.format(n)
}

/** "+499.26" with explicit sign */
export function fmtSigned(v: string | number | null | undefined, places = 2): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '—'
  const abs = Math.abs(n).toFixed(places)
  const formatted = parseFloat(abs).toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
  return (n >= 0 ? '+' : '-') + formatted
}

/** Compact: "250K" / "1.2M" */
export function fmtCompact(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(n) >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

// ── DTE badge helper ──────────────────────────────────────────────────────────

/** Returns Tailwind colour classes for DTE urgency (light theme). */
export function dteBadgeClass(dte: number): string {
  if (dte <= 7)  return 'text-rose-600 bg-rose-50 border border-rose-200'
  if (dte <= 30) return 'text-amber-600 bg-amber-50 border border-amber-200'
  if (dte <= 90) return 'text-sky-600 bg-sky-50 border border-sky-200'
  return 'text-slate-500 bg-slate-100 border border-slate-200'
}

// ── Sign-based colour helper ──────────────────────────────────────────────────

/** "text-emerald-600" for positive, "text-rose-600" for negative, "text-slate-400" for zero. */
export function signClass(v: string | number | null | undefined): string {
  if (v == null || v === '') return 'text-slate-400'
  const n = typeof v === 'string' ? parseFloat(v) : v
  if (isNaN(n) || n === 0) return 'text-slate-400'
  return n > 0 ? 'text-emerald-600' : 'text-rose-600'
}

/** True if the numeric string represents a positive value. */
export function isPositive(v: string | null | undefined): boolean {
  if (!v) return false
  return parseFloat(v) > 0
}
