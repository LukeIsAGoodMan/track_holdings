/**
 * Chart data transformation utilities for the Holding Chart Panel.
 *
 * All transformations are deterministic, frontend-only, and assume
 * ascending chronological input from the backend.
 */
import type { IntradayBar, EodLightBar } from '@/types'

export interface ChartPoint {
  label: string  // x-axis label
  close: number
}

/** Intraday: extract time + close from 5-min bars (same-day line) */
export function buildIntradaySeries(bars: IntradayBar[]): ChartPoint[] {
  return bars
    .filter(b => b.close != null)
    .map(b => ({
      label: (b.date.split(' ')[1] ?? b.date).slice(0, 5),  // "09:35"
      close: b.close!,
    }))
}

/** 1D tab: 6-month daily line from EOD light */
export function buildSixMonthDailySeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-130)  // ~6 months of trading days
  return slice.map(b => ({
    label: fmtShortDate(b.date),  // "Mar 27"
    close: b.close,
  }))
}

/** 5D tab: 1-year trend, 5-trading-day bins (last close per bucket) */
export function buildOneYear5DBinnedSeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-252)  // ~1 year of trading days
  if (slice.length === 0) return []

  const points: ChartPoint[] = []
  for (let i = 0; i < slice.length; i += 5) {
    const bucket = slice.slice(i, i + 5)
    const last = bucket[bucket.length - 1]
    points.push({
      label: fmtShortDate(last.date),
      close: last.close,
    })
  }
  return points
}

/** 1M tab: 5-year trend, monthly bins (last close per calendar month) */
export function buildFiveYearMonthlySeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-1260)  // ~5 years of trading days
  if (slice.length === 0) return []

  const monthMap = new Map<string, EodLightBar>()  // "YYYY-MM" → last bar
  for (const b of slice) {
    const ym = b.date.slice(0, 7)  // "2026-03"
    monthMap.set(ym, b)  // overwrites → last bar per month wins
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, bar]) => ({
      label: fmtYearMonth(ym),
      close: bar.close,
    }))
}

/** Derive latest price + daily change from available data */
export function getLatestPriceSummary(
  intraday: IntradayBar[],
  eod: EodLightBar[],
): { price: number | null; change: number | null; changePct: number | null } {
  // Prefer latest intraday close
  let price: number | null = null
  for (let i = intraday.length - 1; i >= 0; i--) {
    if (intraday[i].close != null) { price = intraday[i].close!; break }
  }
  // Fallback to latest EOD close
  if (price == null && eod.length > 0) {
    price = eod[eod.length - 1].close
  }

  // Daily change: derive from last two EOD bars if available
  let change: number | null = null
  let changePct: number | null = null
  if (eod.length >= 2) {
    const curr = eod[eod.length - 1].close
    const prev = eod[eod.length - 2].close
    if (prev !== 0) {
      change = curr - prev
      changePct = (change / Math.abs(prev)) * 100
    }
  }

  return { price, change, changePct }
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtShortDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

/** "2026-03" → "2026" for year boundaries, "Mar" otherwise (to keep 1M x-axis minimal) */
function fmtYearMonth(ym: string): string {
  const [year, month] = ym.split('-')
  // Show year label for January, short month for others
  if (month === '01') return year
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[parseInt(month)] ?? ym
}
