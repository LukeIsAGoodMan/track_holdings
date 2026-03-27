/**
 * HoldingChartPanel — right-side slide-over for quick holding inspection.
 *
 * Tab semantics:
 *   Intraday — same-day 5-min line (filtered to market-session date)
 *   1D       — 6-month daily line
 *   5D       — 1-year line, 5-trading-day bins
 *   1M       — 5-year line, monthly bins
 *
 * All views are line charts with time-scaled XAxis (epoch ms).
 * Price summary shows view-based period return (last - first), not daily change.
 * Auto-refreshes every 5 min while open.
 */
import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useLanguage } from '@/context/LanguageContext'
import type { IntradayBar, EodLightBar } from '@/types'
import type { ChartView, ChartStatus } from './useHoldingChartPanel'
import {
  buildIntradaySeries,
  buildSixMonthDailySeries,
  buildOneYear5DBinnedSeries,
  buildFiveYearMonthlySeries,
  getPeriodReturn,
  fmtTickIntraday,
  fmtTickDate,
  fmtTickMonthly,
  type ChartPoint,
} from './chartTransforms'

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  symbol: string | null
  view: ChartView
  onClose: () => void
  onViewChange: (v: ChartView) => void
  intraday5min: IntradayBar[]
  eodLight: EodLightBar[]
  status: ChartStatus
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtSignedPrice(v: number): string {
  const abs = Math.abs(v)
  const formatted = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  if (v > 0) return `+${formatted}`
  if (v < 0) return `-${formatted}`
  return '$0.00'
}

const VIEW_TABS: { key: ChartView; en: string; zh: string }[] = [
  { key: 'Intraday', en: 'Intraday', zh: '日内' },
  { key: '1D',       en: '1D',       zh: '1日' },
  { key: '5D',       en: '5D',       zh: '5日' },
  { key: '1M',       en: '1M',       zh: '1月' },
]

// ── Tooltip ──────────────────────────────────────────────────────────────────

function SimpleTooltip({ active, payload }: {
  active?: boolean; payload?: Array<{ payload: ChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-v2-md px-3 py-2 tnum text-xs" style={{ backgroundColor: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="text-stone-400 mb-0.5" style={{ fontSize: '10px' }}>{d.displayLabel}</div>
      <div className="text-stone-800 font-medium">{fmtPrice(d.close)}</div>
    </div>
  )
}

// ── Tick formatters per view ─────────────────────────────────────────────────

function getTickFormatter(view: ChartView): (ts: number) => string {
  switch (view) {
    case 'Intraday': return fmtTickIntraday
    case '1D':       return fmtTickDate
    case '5D':       return fmtTickDate
    case '1M':       return fmtTickMonthly
  }
}

function getTickCount(view: ChartView): number {
  switch (view) {
    case 'Intraday': return 6
    case '1D':       return 5
    case '5D':       return 5
    case '1M':       return 5
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function HoldingChartPanel({
  open, symbol, view, onClose, onViewChange,
  intraday5min, eodLight, status,
}: Props) {
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const chartData = useMemo<ChartPoint[]>(() => {
    switch (view) {
      case 'Intraday': return buildIntradaySeries(intraday5min)
      case '1D':       return buildSixMonthDailySeries(eodLight)
      case '5D':       return buildOneYear5DBinnedSeries(eodLight)
      case '1M':       return buildFiveYearMonthlySeries(eodLight)
    }
  }, [view, intraday5min, eodLight])

  // View-based period return: change = last - first of visible series
  const periodReturn = useMemo(() => getPeriodReturn(chartData), [chartData])

  const hasData = chartData.length > 0
  const isLineUp = hasData && chartData[chartData.length - 1].close >= chartData[0].close
  const strokeColor = isLineUp ? '#4a9a6b' : '#c05c56'

  const changeColor = periodReturn.change != null
    ? periodReturn.change > 0 ? 'text-emerald-600' : periodReturn.change < 0 ? 'text-rose-500' : 'text-stone-500'
    : ''

  const tickFormatter = getTickFormatter(view)
  const tickCount = getTickCount(view)

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} />

      <div
        className="fixed top-0 right-0 h-full z-[60] bg-white border-l border-stone-200 shadow-lg flex flex-col"
        style={{ width: 'min(480px, 90vw)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="text-base font-semibold text-stone-800">{symbol ?? ''}</div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 cursor-pointer p-1"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 py-3">
          {VIEW_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => onViewChange(tab.key)}
              className={`px-3 py-1 rounded-v2-md text-xs font-medium cursor-pointer ${
                view === tab.key
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
              }`}
              style={{ transition: 'background-color 150ms ease-out, color 150ms ease-out' }}
            >
              {isEn ? tab.en : tab.zh}
            </button>
          ))}
        </div>

        {/* Chart area */}
        <div className="px-4">
          {status === 'loading' && (
            <div className="h-[260px] bg-stone-50 rounded-v2-lg ds-shimmer" />
          )}

          {status === 'error' && (
            <div className="h-[260px] flex items-center justify-center text-stone-400 text-xs">
              {isEn ? 'No chart data available' : '暂无图表数据'}
            </div>
          )}

          {status === 'ready' && !hasData && (
            <div className="h-[260px] flex items-center justify-center text-stone-400 text-xs">
              {isEn ? 'No chart data available' : '暂无图表数据'}
            </div>
          )}

          {status === 'ready' && hasData && (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="holdingChartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.08} />
                    <stop offset="95%" stopColor={strokeColor} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={tickFormatter}
                  tickCount={tickCount}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false} axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip content={<SimpleTooltip />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={strokeColor}
                  strokeWidth={1.5}
                  fill="url(#holdingChartGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: strokeColor, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Price summary — view-based period return */}
        {status === 'ready' && (
          <div className="px-5 pt-4 pb-3">
            <div className="text-2xl font-semibold text-stone-800 tnum">
              {fmtPrice(periodReturn.price)}
            </div>
            {periodReturn.change != null && periodReturn.changePct != null && (
              <div className={`text-sm font-medium tnum mt-1 ${changeColor}`}>
                {fmtSignedPrice(periodReturn.change)}
                <span className="ml-2">
                  ({periodReturn.changePct >= 0 ? '+' : ''}{periodReturn.changePct.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Footer */}
        <div className="px-5 py-2 border-t border-stone-100 text-[10px] text-stone-400">
          {isEn ? 'Auto-refreshes every 5 min while open' : '面板打开时每5分钟自动刷新'}
        </div>
      </div>
    </>
  )
}
