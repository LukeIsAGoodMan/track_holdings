/**
 * HoldingChartPanel — right-side slide-over for quick holding inspection.
 *
 * Layout (top to bottom):
 *   Header → Tabs → Chart → Price Summary → Price Position Gauge → Metrics → Footer
 *
 * All timestamps US/Eastern. Intraday return uses previous close.
 * Auto-refreshes every 5 min while open.
 */
import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
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
  getIntradayReturn,
  getPeriodReturn,
  computeDerivedMetrics,
  fmtTickIntraday,
  fmtTickDate,
  fmtTick5D,
  fmtTickMonthly,
  type ChartPoint,
} from './chartTransforms'

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

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtSignedPrice(v: number): string {
  const abs = Math.abs(v)
  const f = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
  return v > 0 ? `+${f}` : v < 0 ? `-${f}` : '$0.00'
}

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'K'
  return v.toFixed(0)
}

const VIEW_TABS: { key: ChartView; en: string; zh: string }[] = [
  { key: 'Intraday', en: 'Intraday', zh: '日内' },
  { key: '1D',       en: '1D',       zh: '1日' },
  { key: '5D',       en: '5D',       zh: '5日' },
  { key: '1M',       en: '1M',       zh: '1月' },
]

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

function getTickFormatter(view: ChartView) {
  switch (view) {
    case 'Intraday': return fmtTickIntraday
    case '1D':       return fmtTickDate
    case '5D':       return fmtTick5D
    case '1M':       return fmtTickMonthly
  }
}

function getTickCount(view: ChartView) {
  return view === 'Intraday' ? 6 : 5
}

// ── Price Position Gauge ─────────────────────────────────────────────────────

function PricePositionGauge({ position, low, high, isEn }: {
  position: number; low: number; high: number; isEn: boolean
}) {
  const pct = Math.max(0, Math.min(1, position)) * 100
  const hint = position < 0.25
    ? (isEn ? 'Near low' : '接近低点')
    : position > 0.75
    ? (isEn ? 'Near high' : '接近高点')
    : (isEn ? 'Mid-range' : '中间区域')

  return (
    <div className="px-5 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-stone-500">{isEn ? 'Price Position' : '价格位置'}</span>
        <span className="text-[10px] text-stone-400">{hint}</span>
      </div>
      {/* Gauge track */}
      <div className="relative h-1.5 rounded-full bg-stone-100">
        {/* Dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-stone-700 border-2 border-white shadow-sm"
          style={{ left: `calc(${pct}% - 5px)` }}
        />
      </div>
      {/* L / H labels */}
      <div className="flex justify-between mt-1 text-[9px] text-stone-400 tnum">
        <span>{fmtPrice(low)}</span>
        <span>{fmtPrice(high)}</span>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function HoldingChartPanel({
  open, symbol, view, onClose, onViewChange,
  intraday5min, eodLight, status,
}: Props) {
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const intradaySeries = useMemo(() => buildIntradaySeries(intraday5min), [intraday5min])

  const chartData = useMemo<ChartPoint[]>(() => {
    switch (view) {
      case 'Intraday': return intradaySeries
      case '1D':       return buildSixMonthDailySeries(eodLight)
      case '5D':       return buildOneYear5DBinnedSeries(eodLight)
      case '1M':       return buildFiveYearMonthlySeries(eodLight)
    }
  }, [view, intradaySeries, eodLight])

  const intradayReturn = useMemo(() => getIntradayReturn(intradaySeries, eodLight), [intradaySeries, eodLight])
  const periodReturn = useMemo(() => getPeriodReturn(chartData), [chartData])
  const displayReturn = view === 'Intraday' ? intradayReturn : periodReturn
  const prevClose = view === 'Intraday' ? intradayReturn.prevClose : null

  const metrics = useMemo(() => computeDerivedMetrics(eodLight, displayReturn.price), [eodLight, displayReturn.price])

  const hasData = chartData.length > 0
  const isLineUp = displayReturn.change != null ? displayReturn.change >= 0 : (hasData && chartData[chartData.length - 1].close >= chartData[0].close)
  const strokeColor = isLineUp ? '#4a9a6b' : '#c05c56'
  const changeColor = displayReturn.change != null
    ? displayReturn.change > 0 ? 'text-emerald-600' : displayReturn.change < 0 ? 'text-rose-500' : 'text-stone-500'
    : ''

  const tickFormatter = getTickFormatter(view)
  const tickCount = getTickCount(view)
  const showPrevCloseLine = view === 'Intraday' && prevClose != null && prevClose > 0 && hasData

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} />

      <div
        className="fixed top-0 right-0 h-full z-[60] bg-white border-l border-stone-200 shadow-lg flex flex-col overflow-y-auto"
        style={{ width: 'min(480px, 90vw)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="text-base font-semibold text-stone-800">{symbol ?? ''}</div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer p-1" aria-label="Close">
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
                view === tab.key ? 'bg-stone-800 text-white' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
              }`}
              style={{ transition: 'background-color 150ms ease-out, color 150ms ease-out' }}
            >
              {isEn ? tab.en : tab.zh}
            </button>
          ))}
        </div>

        {/* Chart — locked 260px */}
        <div className="px-4">
          {status === 'loading' && <div className="h-[260px] bg-stone-50 rounded-v2-lg ds-shimmer" />}

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
                    <stop offset="5%" stopColor={strokeColor} stopOpacity={0.08} />
                    <stop offset="95%" stopColor={strokeColor} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tick={{ fill: '#a8a29e', fontSize: 9 }} tickLine={false} axisLine={false}
                  tickFormatter={tickFormatter} tickCount={tickCount} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false} axisLine={false} width={52}
                  tickFormatter={(v: number) => v.toFixed(0)} />
                {showPrevCloseLine && (
                  <ReferenceLine y={prevClose!} stroke="#e5e7eb" strokeDasharray="2 2" strokeWidth={1} />
                )}
                <Tooltip content={<SimpleTooltip />} cursor={{ stroke: '#e5e7eb', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="close" stroke={strokeColor} strokeWidth={1.5}
                  fill="url(#holdingChartGrad)" dot={false}
                  activeDot={{ r: 3, fill: strokeColor, strokeWidth: 0 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Price summary — directly below chart, tight spacing ──── */}
        {status === 'ready' && (
          <div className="px-5 pt-3 pb-1">
            <div className="text-2xl font-semibold text-stone-800 tnum">
              {fmtPrice(displayReturn.price)}
            </div>
            {displayReturn.change != null && displayReturn.changePct != null && (
              <div className={`text-sm font-medium tnum mt-0.5 ${changeColor}`}>
                {fmtSignedPrice(displayReturn.change)}
                <span className="ml-2">({displayReturn.changePct >= 0 ? '+' : ''}{displayReturn.changePct.toFixed(2)}%)</span>
              </div>
            )}
          </div>
        )}

        {/* ── Price Position gauge ──── */}
        {status === 'ready' && metrics.pricePosition != null && metrics.rangeLow != null && metrics.rangeHigh != null && (
          <PricePositionGauge
            position={metrics.pricePosition}
            low={metrics.rangeLow}
            high={metrics.rangeHigh}
            isEn={isEn}
          />
        )}

        {/* ── Lightweight derived metrics ──── */}
        {status === 'ready' && (metrics.distVs20dAvg != null || metrics.avgDailyMove != null || metrics.volVs20dAvg != null) && (
          <div className="px-5 py-2 border-t border-stone-50">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {metrics.distVs20dAvg != null && (
                <div>
                  <div className="text-[10px] text-stone-400 uppercase tracking-wider">{isEn ? 'vs 20D Avg' : '对比20日均'}</div>
                  <div className={`text-xs font-medium tnum ${
                    metrics.distVs20dAvg > 0 ? 'text-emerald-600' : metrics.distVs20dAvg < 0 ? 'text-rose-500' : 'text-stone-500'
                  }`}>
                    {metrics.distVs20dAvg >= 0 ? '+' : ''}{metrics.distVs20dAvg.toFixed(2)}%
                  </div>
                </div>
              )}
              {metrics.avgDailyMove != null && (
                <div>
                  <div className="text-[10px] text-stone-400 uppercase tracking-wider">{isEn ? '20D Avg Move' : '20日均波幅'}</div>
                  <div className="text-xs font-medium tnum text-stone-600">
                    ±{metrics.avgDailyMove.toFixed(2)}%
                  </div>
                </div>
              )}
              {metrics.volVs20dAvg != null && (
                <div>
                  <div className="text-[10px] text-stone-400 uppercase tracking-wider">{isEn ? 'Vol vs 20D' : '成交量对比'}</div>
                  <div className={`text-xs font-medium tnum ${
                    metrics.volVs20dAvg > 1.5 ? 'text-amber-600' : metrics.volVs20dAvg < 0.5 ? 'text-stone-400' : 'text-stone-600'
                  }`}>
                    {metrics.volVs20dAvg.toFixed(1)}x
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="px-5 py-2 border-t border-stone-100 text-[10px] text-stone-400">
          {isEn ? 'Auto-refreshes every 5 min while open' : '面板打开时每5分钟自动刷新'}
        </div>
      </div>
    </>
  )
}
