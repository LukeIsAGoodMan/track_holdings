/**
 * HoldingChartPanel — premium right-side slide-over for holding inspection.
 *
 * Visual language: frosted floating sheet, restrained depth, calm premium finish.
 * Chart: dual-layer line (glow + crisp), airy gradient fill.
 * Motion: 200ms cubic-bezier(0.22, 1, 0.36, 1) for panel entrance.
 *
 * No business logic changes from previous version.
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

const VIEW_TABS: { key: ChartView; en: string; zh: string }[] = [
  { key: 'Intraday', en: 'Intraday', zh: '日内' },
  { key: '1D',       en: '1D',       zh: '1日' },
  { key: '5D',       en: '5D',       zh: '5日' },
  { key: '1M',       en: '1M',       zh: '1月' },
]

// ── Premium Tooltip ──────────────────────────────────────────────────────────

function SimpleTooltip({ active, payload }: {
  active?: boolean; payload?: Array<{ payload: ChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div
      className="rounded-lg px-3 py-2 tnum text-xs"
      style={{
        backgroundColor: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(0,0,0,0.04)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
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

// ── Price Position Gauge — premium finish ────────────────────────────────────

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
    <div className="px-5 pt-2 pb-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-stone-500 font-medium">{isEn ? 'Price Position' : '价格位置'}</span>
        <span className="text-[10px] text-stone-400 italic">{hint}</span>
      </div>
      <div className="relative h-[5px] rounded-full" style={{ backgroundColor: 'rgba(214,211,209,0.35)' }}>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full bg-stone-800 border-[1.5px] border-white"
          style={{
            left: `calc(${pct}% - 4.5px)`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1)',
          }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-stone-400/80 tnum">
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
  // Glow layer color — same hue but much softer
  const glowColor = isLineUp ? 'rgba(74,154,107,0.08)' : 'rgba(192,92,86,0.08)'
  const changeColor = displayReturn.change != null
    ? displayReturn.change > 0 ? 'text-emerald-600' : displayReturn.change < 0 ? 'text-rose-500' : 'text-stone-500'
    : ''

  const tickFormatter = getTickFormatter(view)
  const tickCount = getTickCount(view)
  const showPrevCloseLine = view === 'Intraday' && prevClose != null && prevClose > 0 && hasData

  if (!open) return null

  return (
    <>
      {/* Backdrop — subtle dim */}
      <div
        className="fixed inset-0 z-[59]"
        style={{ backgroundColor: 'rgba(0,0,0,0.04)', transition: 'opacity 200ms ease-out' }}
        onClick={onClose}
      />

      {/* Panel — frosted floating sheet */}
      <div
        className="fixed top-0 right-0 h-full z-[60] flex flex-col overflow-y-auto"
        style={{
          width: 'min(480px, 90vw)',
          backgroundColor: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderLeft: '1px solid rgba(0,0,0,0.04)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.06), -1px 0 0 rgba(0,0,0,0.02)',
          animation: 'holdingPanelSlideIn 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <div className="text-[15px] font-semibold text-stone-800 tracking-tight">{symbol ?? ''}</div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 cursor-pointer p-1 rounded-lg hover:bg-stone-100/60"
            style={{ transition: 'all 140ms ease-out' }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs — premium pills */}
        <div className="flex items-center gap-1 px-5 py-2.5">
          {VIEW_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => onViewChange(tab.key)}
              className={`px-3 py-[5px] rounded-lg text-[11px] font-medium cursor-pointer ${
                view === tab.key
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100/70'
              }`}
              style={{
                transition: 'all 140ms ease-out',
                boxShadow: view === tab.key ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              {isEn ? tab.en : tab.zh}
            </button>
          ))}
        </div>

        {/* Chart — 260px, dual-layer line */}
        <div className="px-4 pt-1">
          {status === 'loading' && (
            <div className="h-[260px] rounded-lg ds-shimmer" style={{ backgroundColor: 'rgba(245,244,243,0.5)' }} />
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
                  {/* Airy premium gradient — atmospheric, not decorative */}
                  <linearGradient id="holdingChartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor={strokeColor} stopOpacity={0.16} />
                    <stop offset="40%" stopColor={strokeColor} stopOpacity={0.06} />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
                  </linearGradient>
                  {/* Glow filter for soft line halo */}
                  <filter id="lineGlow">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
                  </filter>
                </defs>

                <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tick={{ fill: '#b8b5b1', fontSize: 9 }} tickLine={false} axisLine={false}
                  tickFormatter={tickFormatter} tickCount={tickCount} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#b8b5b1', fontSize: 9 }}
                  tickLine={false} axisLine={false} width={50}
                  tickFormatter={(v: number) => v.toFixed(0)} />

                {showPrevCloseLine && (
                  <ReferenceLine y={prevClose!} stroke="rgba(214,211,209,0.5)" strokeDasharray="2 3" strokeWidth={1} />
                )}

                <Tooltip content={<SimpleTooltip />} cursor={{ stroke: 'rgba(168,162,158,0.25)', strokeWidth: 1 }} />

                {/* Glow layer — soft wider low-opacity line beneath */}
                <Area type="monotone" dataKey="close"
                  stroke={glowColor} strokeWidth={5}
                  fill="none" dot={false} activeDot={false}
                  isAnimationActive={false} />

                {/* Primary line + premium gradient fill */}
                <Area type="monotone" dataKey="close"
                  stroke={strokeColor} strokeWidth={1.8}
                  fill="url(#holdingChartGrad)" dot={false}
                  activeDot={{
                    r: 3.5, fill: 'white', stroke: strokeColor, strokeWidth: 1.8,
                  }}
                  isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Price summary — tight below chart ──── */}
        {status === 'ready' && (
          <div className="px-5 pt-3 pb-1.5">
            <div className="text-[22px] font-semibold text-stone-900 tnum tracking-tight">
              {fmtPrice(displayReturn.price)}
            </div>
            {displayReturn.change != null && displayReturn.changePct != null && (
              <div className={`text-[13px] font-medium tnum mt-0.5 tracking-tight ${changeColor}`}>
                {fmtSignedPrice(displayReturn.change)}
                <span className="ml-1.5 text-stone-400/80">
                  ({displayReturn.changePct >= 0 ? '+' : ''}{displayReturn.changePct.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Price Position gauge ──── */}
        {status === 'ready' && metrics.pricePosition != null && metrics.rangeLow != null && metrics.rangeHigh != null && (
          <PricePositionGauge position={metrics.pricePosition} low={metrics.rangeLow} high={metrics.rangeHigh} isEn={isEn} />
        )}

        {/* ── Derived metrics — secondary calm insights ──── */}
        {status === 'ready' && (metrics.distVs20dAvg != null || metrics.avgDailyMove != null || metrics.volVs20dAvg != null) && (
          <div className="px-5 pt-1.5 pb-2" style={{ borderTop: '1px solid rgba(0,0,0,0.03)' }}>
            <div className="grid grid-cols-3 gap-x-3 gap-y-2">
              {metrics.distVs20dAvg != null && (
                <div>
                  <div className="text-[9px] text-stone-400 uppercase tracking-wider mb-0.5">{isEn ? 'vs 20D Avg' : '对比20日均'}</div>
                  <div className={`text-[11px] font-medium tnum ${
                    metrics.distVs20dAvg > 0 ? 'text-emerald-600' : metrics.distVs20dAvg < 0 ? 'text-rose-500' : 'text-stone-500'
                  }`}>
                    {metrics.distVs20dAvg >= 0 ? '+' : ''}{metrics.distVs20dAvg.toFixed(2)}%
                  </div>
                </div>
              )}
              {metrics.avgDailyMove != null && (
                <div>
                  <div className="text-[9px] text-stone-400 uppercase tracking-wider mb-0.5">{isEn ? 'Avg Move' : '均波幅'}</div>
                  <div className="text-[11px] font-medium tnum text-stone-600">
                    ±{metrics.avgDailyMove.toFixed(2)}%
                  </div>
                </div>
              )}
              {metrics.volVs20dAvg != null && (
                <div>
                  <div className="text-[9px] text-stone-400 uppercase tracking-wider mb-0.5">{isEn ? 'Volume' : '成交量'}</div>
                  <div className={`text-[11px] font-medium tnum ${
                    metrics.volVs20dAvg > 1.5 ? 'text-amber-600' : metrics.volVs20dAvg < 0.5 ? 'text-stone-400' : 'text-stone-600'
                  }`}>
                    {metrics.volVs20dAvg.toFixed(1)}x
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* Footer */}
        <div className="px-5 py-2 text-[9px] text-stone-400/60" style={{ borderTop: '1px solid rgba(0,0,0,0.03)' }}>
          {isEn ? 'Auto-refreshes every 5 min' : '每5分钟自动刷新'}
        </div>
      </div>

      {/* Panel slide-in keyframe */}
      <style>{`
        @keyframes holdingPanelSlideIn {
          from { transform: translateX(24px); opacity: 0.8; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
