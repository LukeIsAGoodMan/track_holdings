/**
 * Rhino chart — Recharts OHLC visualization with SMA overlays,
 * support/resistance bands, and prominent current price marker.
 *
 * Visual hierarchy (strongest → weakest):
 *   1. Current price marker + guide line
 *   2. Price series (candles)
 *   3. SMA200 (bold)
 *   4. SMA100 (medium)
 *   5. SMA30 (subtle dashed)
 *   6. Support / resistance bands (translucent, thin)
 */
import { useState, useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ReferenceArea,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { AnalysisChart } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice } from '@/utils/format'

interface Props {
  chart: AnalysisChart
  /** @deprecated pass via chart.current_price instead */
  price?: number
}

/* ── Timeframe options ─────────────────────────────────────────────────── */

const TIMEFRAMES = [
  { label: '10D', days: 10 },
  { label: '30D', days: 30 },
  { label: '200D', days: 200 },
] as const

type Timeframe = typeof TIMEFRAMES[number]['days']

/* ── Custom candle shape ────────────────────────────────────────────────── */

interface CandleShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: { open: number; high: number; low: number; close: number; bullish: boolean }
  yAxis?: { scale: (v: number) => number }
}

function CandleShape(props: CandleShapeProps) {
  const { x = 0, width = 0, payload, yAxis } = props
  if (!payload || !yAxis?.scale) return null

  const { open, high, low, close, bullish } = payload
  const scale = yAxis.scale
  const color = bullish ? '#10b981' : '#ef4444'
  const cx = x + width / 2

  const yOpen = scale(open)
  const yClose = scale(close)
  const yHigh = scale(high)
  const yLow = scale(low)

  const bodyTop = Math.min(yOpen, yClose)
  const bodyH = Math.max(Math.abs(yOpen - yClose), 1)

  return (
    <g>
      <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
      <rect
        x={cx - 2}
        y={bodyTop}
        width={4}
        height={bodyH}
        fill={color}
        stroke={color}
        strokeWidth={0.5}
      />
    </g>
  )
}

/* ── Current price label (custom right-edge badge) ─────────────────────── */

function CurrentPriceLabel({ viewBox, value }: { viewBox?: { x?: number; y?: number; width?: number }; value?: string }) {
  if (!viewBox) return null
  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) + 2
  const y = viewBox.y ?? 0
  return (
    <g>
      <rect x={x} y={y - 10} width={62} height={20} rx={4} fill="#4f46e5" />
      <text x={x + 31} y={y + 4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700}>
        {value}
      </text>
    </g>
  )
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function RhinoChart({ chart, price: priceProp }: Props) {
  const price = chart.current_price ?? priceProp ?? 0
  const { lang, t } = useLanguage()
  const [timeframe, setTimeframe] = useState<Timeframe>(200)

  const data = useMemo(() => {
    const sma30Map  = new Map((chart.sma30 ?? []).map((s) => [s.date, s.value]))
    const sma100Map = new Map((chart.sma100 ?? []).map((s) => [s.date, s.value]))
    const sma200Map = new Map((chart.sma200 ?? []).map((s) => [s.date, s.value]))
    const candles = chart.candles.slice(-timeframe)
    return candles.map((c) => ({
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      sma30:  sma30Map.get(c.date) ?? null,
      sma100: sma100Map.get(c.date) ?? null,
      sma200: sma200Map.get(c.date) ?? null,
      _candle: c.high,
      bullish: c.close >= c.open,
    }))
  }, [chart, timeframe])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMouseMove = useCallback((_state: any) => {}, [])
  const handleMouseLeave = useCallback(() => {}, [])

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">
          {t('analysis_chart')}
        </h3>
        <p className="text-sm text-slate-400 italic">{t('analysis_no_chart')}</p>
      </div>
    )
  }

  const allLows = data.map((d) => d.low)
  const allHighs = data.map((d) => d.high)
  const yMin = Math.min(...allLows) * 0.98
  const yMax = Math.max(...allHighs) * 1.02

  const formatDate = (d: string) => {
    const parts = d.split('-')
    return `${parts[1]}/${parts[2]}`
  }

  // Limit zones to top 3 for cleaner visual
  const supportZones = chart.support_zones.slice(0, 3)
  const resistanceZones = chart.resistance_zones.slice(0, 3)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      {/* Header with timeframe selector */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {t('analysis_chart')}
        </h3>
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {TIMEFRAMES.map(({ label, days }) => (
            <button
              key={days}
              onClick={() => setTimeframe(days)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                timeframe === days
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 65, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            interval={Math.max(Math.floor(data.length / 8), 1)}
          />
          <YAxis
            yAxisId="price"
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            width={55}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              return (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs">
                  <div className="font-semibold text-slate-600 mb-1">{formatDate(String(label ?? ''))}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-700">
                    <span className="text-slate-400">O</span><span>{fmtPrice(d.open)}</span>
                    <span className="text-slate-400">H</span><span>{fmtPrice(d.high)}</span>
                    <span className="text-slate-400">L</span><span>{fmtPrice(d.low)}</span>
                    <span className="text-slate-400">C</span>
                    <span className={d.bullish ? 'text-emerald-600' : 'text-rose-600'}>{fmtPrice(d.close)}</span>
                  </div>
                </div>
              )
            }}
          />

          {/* Support zones — very light, thin outlines */}
          {supportZones.map((z, i) => (
            <ReferenceArea
              key={`s-${i}`}
              yAxisId="price"
              y1={z.lower}
              y2={z.upper}
              fill="#10b981"
              fillOpacity={0.04 + z.strength * 0.08}
              stroke="#10b981"
              strokeOpacity={0.15}
              strokeDasharray="4 4"
              strokeWidth={0.5}
            />
          ))}

          {/* Resistance zones — very light, thin outlines */}
          {resistanceZones.map((z, i) => (
            <ReferenceArea
              key={`r-${i}`}
              yAxisId="price"
              y1={z.lower}
              y2={z.upper}
              fill="#ef4444"
              fillOpacity={0.04 + z.strength * 0.08}
              stroke="#ef4444"
              strokeOpacity={0.15}
              strokeDasharray="4 4"
              strokeWidth={0.5}
            />
          ))}

          {/* SMA30 — most subtle (thin dashed, light color) */}
          <Line
            dataKey="sma30"
            yAxisId="price"
            type="monotone"
            stroke="#94a3b8"
            strokeWidth={0.8}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          {/* SMA100 — medium emphasis */}
          <Line
            dataKey="sma100"
            yAxisId="price"
            type="monotone"
            stroke="#f97316"
            strokeWidth={1.2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          {/* SMA200 — strong emphasis (deep blue, thicker) */}
          <Line
            dataKey="sma200"
            yAxisId="price"
            type="monotone"
            stroke="#1e40af"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          {/* Historical close line */}
          <Line
            dataKey="close"
            yAxisId="price"
            type="monotone"
            stroke="#475569"
            strokeWidth={1.2}
            dot={false}
            isAnimationActive={false}
          />

          {/* Candle bodies via custom shape */}
          <Bar
            dataKey="_candle"
            yAxisId="price"
            isAnimationActive={false}
            barSize={6}
            shape={<CandleShape />}
          />

          {/* ═══ CURRENT PRICE — PRIMARY VISUAL ANCHOR ═══ */}
          {/* Horizontal guide line across full chart */}
          <ReferenceLine
            yAxisId="price"
            y={price}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            label={<CurrentPriceLabel value={`$${price.toFixed(2)}`} />}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Simplified legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block" />
          {lang === 'zh' ? '当前价' : 'Current'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-slate-500 inline-block rounded" />
          {lang === 'zh' ? '收盘价' : 'Close'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-[3px] inline-block rounded" style={{ background: '#1e40af' }} />
          SMA 200
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 inline-block rounded" style={{ background: '#f97316' }} />
          SMA 100
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 inline-block rounded opacity-50" style={{ background: '#94a3b8', borderTop: '1px dashed #94a3b8' }} />
          SMA 30
        </span>
      </div>
    </div>
  )
}
