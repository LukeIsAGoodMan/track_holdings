/**
 * Chart data transformation utilities for the Holding Chart Panel.
 *
 * All transformations are deterministic, frontend-only, and assume
 * ascending chronological input from the backend.
 *
 * Each ChartPoint carries:
 *  - ts: epoch milliseconds (for time-scaled XAxis)
 *  - displayLabel: human-readable string (for tick/tooltip formatting)
 *  - close: price value
 *
 * Date anchoring: uses the market-session date implied by the data itself
 * (extracted from the last bar's date field), not the local machine clock.
 */
import type { IntradayBar, EodLightBar } from '@/types'

export interface ChartPoint {
  ts: number           // epoch ms — used as XAxis dataKey for time scale
  displayLabel: string // human-readable label for tick/tooltip
  close: number
}

/**
 * Intraday: same-day 5-min line.
 * Filters to the market-session date of the LAST bar to avoid multi-day mixing.
 */
export function buildIntradaySeries(bars: IntradayBar[]): ChartPoint[] {
  if (bars.length === 0) return []

  // Determine the session date from the last bar (market-exchange anchored)
  const lastDate = bars[bars.length - 1].date.slice(0, 10)  // "YYYY-MM-DD"

  return bars
    .filter(b => b.close != null && b.date.startsWith(lastDate))
    .map(b => ({
      ts: parseDateTime(b.date),
      displayLabel: (b.date.split(' ')[1] ?? b.date).slice(0, 5),  // "09:35"
      close: b.close!,
    }))
}

/** 1D tab: 6-month daily line from EOD light */
export function buildSixMonthDailySeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-130)
  return slice.map(b => ({
    ts: parseDate(b.date),
    displayLabel: fmtShortDate(b.date),
    close: b.close,
  }))
}

/** 5D tab: 1-year trend, 5-trading-day bins (last close per bucket) */
export function buildOneYear5DBinnedSeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-252)
  if (slice.length === 0) return []

  const points: ChartPoint[] = []
  for (let i = 0; i < slice.length; i += 5) {
    const bucket = slice.slice(i, i + 5)
    const last = bucket[bucket.length - 1]
    points.push({
      ts: parseDate(last.date),
      displayLabel: fmtShortDate(last.date),
      close: last.close,
    })
  }
  return points
}

/** 1M tab: 5-year trend, monthly bins (last close per calendar month) */
export function buildFiveYearMonthlySeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-1260)
  if (slice.length === 0) return []

  const monthMap = new Map<string, EodLightBar>()
  for (const b of slice) {
    const ym = b.date.slice(0, 7)
    monthMap.set(ym, b)
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, bar]) => ({
      ts: parseDate(bar.date),
      displayLabel: fmtYearMonth(ym),
      close: bar.close,
    }))
}

/**
 * View-based period return: change = last - first, changePct = change / first.
 * Uses the chart series itself (not raw EOD bars) so it reflects what the user sees.
 */
export function getPeriodReturn(
  series: ChartPoint[],
): { price: number | null; change: number | null; changePct: number | null } {
  if (series.length === 0) return { price: null, change: null, changePct: null }

  const price = series[series.length - 1].close
  if (series.length < 2) return { price, change: null, changePct: null }

  const first = series[0].close
  if (first === 0) return { price, change: null, changePct: null }

  const change = price - first
  const changePct = (change / Math.abs(first)) * 100
  return { price, change, changePct }
}

// ── Date parsing helpers ────────────────────────────────────────────────────

/** "2026-03-27 09:35:00" → epoch ms (parsed as local, matching market session) */
function parseDateTime(s: string): number {
  // Replace space with T for Date constructor compatibility
  const d = new Date(s.replace(' ', 'T'))
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

/** "2026-03-27" → epoch ms (midnight local) */
function parseDate(s: string): number {
  const d = new Date(s + 'T00:00:00')
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtShortDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

function fmtYearMonth(ym: string): string {
  const [year, month] = ym.split('-')
  if (month === '01') return year
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[parseInt(month)] ?? ym
}

/** Format epoch ms → "09:35" for intraday ticks */
export function fmtTickIntraday(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Format epoch ms → "Mar 27" for daily/5D ticks */
export function fmtTickDate(ts: number): string {
  const d = new Date(ts)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

/** Format epoch ms → year at Jan, short month otherwise (for 1M sparse axis) */
export function fmtTickMonthly(ts: number): string {
  const d = new Date(ts)
  if (d.getMonth() === 0) return String(d.getFullYear())
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[d.getMonth() + 1] ?? ''
}
