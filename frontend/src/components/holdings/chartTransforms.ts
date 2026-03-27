/**
 * Chart data transformation utilities for the Holding Chart Panel.
 *
 * All transformations are deterministic, frontend-only, and assume
 * ascending chronological input from the backend.
 *
 * Timezone: all timestamps are interpreted as US/Eastern (market exchange time)
 * using fixed -05:00 offset. No heavy timezone library required.
 */
import type { IntradayBar, EodLightBar } from '@/types'

export interface ChartPoint {
  ts: number           // epoch ms — XAxis dataKey (time scale)
  displayLabel: string // human-readable for tick/tooltip
  close: number
}

// ── US/Eastern fixed offset for market-session anchoring ─────────────────────
const ET_OFFSET = '-05:00'

/** "2026-03-27 09:35:00" → epoch ms in US/Eastern */
function parseDateTime(s: string): number {
  const parts = s.split(' ')
  if (parts.length < 2) return parseDate(s)
  const ms = Date.parse(`${parts[0]}T${parts[1]}${ET_OFFSET}`)
  return isNaN(ms) ? 0 : ms
}

/** "2026-03-27" → epoch ms (midnight US/Eastern) */
function parseDate(s: string): number {
  const ms = Date.parse(`${s}T00:00:00${ET_OFFSET}`)
  return isNaN(ms) ? 0 : ms
}

// ── Series builders ─────────────────────────────────────────────────────────

/**
 * Intraday: same-day 5-min line.
 * Filters to the market-session date of the LAST bar (exchange-anchored).
 */
export function buildIntradaySeries(bars: IntradayBar[]): ChartPoint[] {
  if (bars.length === 0) return []
  const lastDate = bars[bars.length - 1].date.slice(0, 10)

  return bars
    .filter(b => b.close != null && b.date.startsWith(lastDate))
    .map(b => ({
      ts: parseDateTime(b.date),
      displayLabel: (b.date.split(' ')[1] ?? b.date).slice(0, 5),
      close: b.close!,
    }))
}

/** 1D tab: 6-month daily line */
export function buildSixMonthDailySeries(bars: EodLightBar[]): ChartPoint[] {
  return bars.slice(-130).map(b => ({
    ts: parseDate(b.date),
    displayLabel: fmtShortDate(b.date),
    close: b.close,
  }))
}

/** 5D tab: 1-year trend, 5-trading-day bins */
export function buildOneYear5DBinnedSeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-252)
  if (slice.length === 0) return []

  const points: ChartPoint[] = []
  for (let i = 0; i < slice.length; i += 5) {
    const bucket = slice.slice(i, i + 5)
    const last = bucket[bucket.length - 1]
    points.push({
      ts: parseDate(last.date),
      displayLabel: fmtShortDateWithYear(last.date),
      close: last.close,
    })
  }
  return points
}

/**
 * 1M tab: 5-year trend, monthly bins.
 * Order-safe: always keeps the latest-dated bar per month regardless of input order.
 */
export function buildFiveYearMonthlySeries(bars: EodLightBar[]): ChartPoint[] {
  const slice = bars.slice(-1260)
  if (slice.length === 0) return []

  const monthMap = new Map<string, EodLightBar>()
  for (const b of slice) {
    const ym = b.date.slice(0, 7)
    const existing = monthMap.get(ym)
    if (!existing || existing.date < b.date) {
      monthMap.set(ym, b)
    }
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, bar]) => ({
      ts: parseDate(bar.date),
      displayLabel: fmtYearMonth(ym),
      close: bar.close,
    }))
}

// ── Return computation ──────────────────────────────────────────────────────

/**
 * Intraday return uses previous close (market convention).
 * prevClose = second-to-last EOD bar close.
 * Falls back to session return (first intraday point) if < 2 EOD bars.
 */
export function getIntradayReturn(
  intradaySeries: ChartPoint[],
  eod: EodLightBar[],
): { price: number | null; prevClose: number | null; change: number | null; changePct: number | null } {
  if (intradaySeries.length === 0) return { price: null, prevClose: null, change: null, changePct: null }

  const price = intradaySeries[intradaySeries.length - 1].close
  let prevClose: number | null = null

  // Previous close = second-to-last EOD bar (the day before today's session)
  if (eod.length >= 2) {
    prevClose = eod[eod.length - 2].close
  }

  if (prevClose != null && prevClose !== 0) {
    const change = price - prevClose
    const changePct = (change / Math.abs(prevClose)) * 100
    return { price, prevClose, change, changePct }
  }

  // Fallback: session return from first intraday point
  if (intradaySeries.length >= 2) {
    const first = intradaySeries[0].close
    if (first !== 0) {
      const change = price - first
      return { price, prevClose: first, change, changePct: (change / Math.abs(first)) * 100 }
    }
  }

  return { price, prevClose: null, change: null, changePct: null }
}

/** Period return for non-intraday views: change = last - first of visible series */
export function getPeriodReturn(
  series: ChartPoint[],
): { price: number | null; change: number | null; changePct: number | null } {
  if (series.length === 0) return { price: null, change: null, changePct: null }
  const price = series[series.length - 1].close
  if (series.length < 2) return { price, change: null, changePct: null }
  const first = series[0].close
  if (first === 0) return { price, change: null, changePct: null }
  const change = price - first
  return { price, change, changePct: (change / Math.abs(first)) * 100 }
}

// ── Tick formatters ─────────────────────────────────────────────────────────

/** Intraday: "09:35" */
export function fmtTickIntraday(ts: number): string {
  // Reconstruct ET time from epoch
  const d = new Date(ts)
  const et = new Date(d.getTime() + d.getTimezoneOffset() * 60000 - 5 * 3600000)
  return `${String(et.getHours()).padStart(2, '0')}:${String(et.getMinutes()).padStart(2, '0')}`
}

/** Daily/5D: "Mar 27" — add year for year-boundary clarity */
export function fmtTickDate(ts: number): string {
  const d = new Date(ts)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** 5D tick with year context at year boundaries */
export function fmtTick5D(ts: number): string {
  const d = new Date(ts)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  // Show year at January
  if (d.getUTCMonth() === 0) return `Jan '${String(d.getUTCFullYear()).slice(2)}`
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** 1M: always year at January, short month otherwise */
export function fmtTickMonthly(ts: number): string {
  const d = new Date(ts)
  if (d.getUTCMonth() === 0) return String(d.getUTCFullYear())
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[d.getUTCMonth()]
}

// ── Display label formatters ────────────────────────────────────────────────

function fmtShortDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

/** "Mar 27, 2026" — includes year for cross-year disambiguation in 5D view */
function fmtShortDateWithYear(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}, ${parts[0]}`
}

function fmtYearMonth(ym: string): string {
  const [year, month] = ym.split('-')
  if (month === '01') return year
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(month)] ?? ym} '${year.slice(2)}`
}

// ── Derived lightweight metrics (no new API calls) ──────────────────────────

export interface DerivedMetrics {
  /** Price position within available history range: 0 = at low, 1 = at high */
  pricePosition: number | null
  rangeLow: number | null
  rangeHigh: number | null
  /** (current - 20D avg) / 20D avg */
  distVs20dAvg: number | null
  /** Average absolute daily return over last 20 trading days */
  avgDailyMove: number | null
  /** Current volume / 20D avg volume (null if volume unavailable) */
  volVs20dAvg: number | null
}

export function computeDerivedMetrics(eod: EodLightBar[], currentPrice: number | null): DerivedMetrics {
  const empty: DerivedMetrics = { pricePosition: null, rangeLow: null, rangeHigh: null, distVs20dAvg: null, avgDailyMove: null, volVs20dAvg: null }
  if (eod.length < 5 || currentPrice == null) return empty

  // Price Position: use up to 252 bars (1Y), or all available
  const rangeSlice = eod.slice(-252)
  let low = Infinity, high = -Infinity
  for (const b of rangeSlice) {
    if (b.close < low) low = b.close
    if (b.close > high) high = b.close
  }
  const pricePosition = high > low ? (currentPrice - low) / (high - low) : null

  // 20D metrics
  const last20 = eod.slice(-21) // need 21 bars for 20 daily returns
  let distVs20dAvg: number | null = null
  let avgDailyMove: number | null = null
  let volVs20dAvg: number | null = null

  if (last20.length >= 2) {
    // 20D average close
    const recent = last20.slice(-20)
    const avgClose = recent.reduce((s, b) => s + b.close, 0) / recent.length
    if (avgClose > 0) {
      distVs20dAvg = ((currentPrice - avgClose) / avgClose) * 100
    }

    // Average absolute daily return
    let sumAbsReturn = 0
    let returnCount = 0
    for (let i = 1; i < last20.length; i++) {
      const prev = last20[i - 1].close
      if (prev > 0) {
        sumAbsReturn += Math.abs((last20[i].close - prev) / prev) * 100
        returnCount++
      }
    }
    if (returnCount > 0) avgDailyMove = sumAbsReturn / returnCount

    // Volume vs 20D average
    const recentVols = recent.filter(b => b.volume > 0)
    if (recentVols.length >= 5) {
      const avgVol = recentVols.reduce((s, b) => s + b.volume, 0) / recentVols.length
      const latestVol = eod[eod.length - 1].volume
      if (avgVol > 0 && latestVol > 0) {
        volVs20dAvg = latestVol / avgVol
      }
    }
  }

  return {
    pricePosition,
    rangeLow: low !== Infinity ? low : null,
    rangeHigh: high !== -Infinity ? high : null,
    distVs20dAvg,
    avgDailyMove,
    volVs20dAvg,
  }
}
