/**
 * Rhino chart — Recharts OHLC visualization with full chart spec v1.
 *
 * Layer order (back → front):
 *   1. Fair Value Band (emerald, translucent)
 *   2. Support / Resistance zones
 *   3. Moving Averages (SMA30, SMA100, SMA200)
 *   4. Price Line (close series, dominant)
 *   5. Candle bodies
 *   6. Volume bars (green=up, red=down)
 *   7. Current price marker + guide line
 *   8. Reversal confirmation line (if present)
 */
import { useState, useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ReferenceArea,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import type { AnalysisChart } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice } from '@/utils/format'

interface Props {
  chart: AnalysisChart
  /** @deprecated pass via chart.current_price instead */
  price?: number
  fairValue?: { low: number; mid: number; high: number }
  reversalLine?: { value: number; type: 'breakout' | 'reversal' | 'invalidation' }
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

/* ── Current price label (TradingView-style right-edge badge) ─────────── */

function CurrentPriceLabel({ viewBox, value }: { viewBox?: { x?: number; y?: number; width?: number }; value?: string }) {
  if (!viewBox) return null
  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) + 2
  const y = viewBox.y ?? 0
  return (
    <g>
      <rect x={x} y={y - 10} width={72} height={20} rx={4} fill="#4f46e5" />
      <circle cx={x + 8} cy={y} r={2.5} fill="#fff" />
      <text x={x + 14} y={y + 4} fill="#fff" fontSize={11} fontWeight={700}>
        {value}
      </text>
    </g>
  )
}

/* ── Reversal line label ─────────────────────────────────────────────── */

function ReversalLabel({ viewBox, value }: { viewBox?: { x?: number; y?: number; width?: number }; value?: string }) {
  if (!viewBox) return null
  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) + 2
  const y = viewBox.y ?? 0
  return (
    <g>
      <rect x={x} y={y - 9} width={68} height={18} rx={3} fill="#6366f1" fillOpacity={0.9} />
      <text x={x + 34} y={y + 4} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={600}>
        {value}
      </text>
    </g>
  )
}

/* ── Reversal label text (structure-aware) ────────────────────────────── */

function _reversalLabel(lang: string, type?: string): string {
  if (lang === 'zh') {
    if (type === 'breakout') return '\u7bb1\u4f53\u7a81\u7834\u7ebf'
    if (type === 'invalidation') return '\u7ed3\u6784\u5931\u6548\u7ebf'
    return '\u7ed3\u6784\u53cd\u8f6c\u7ebf'
  }
  if (type === 'breakout') return 'Breakout'
  if (type === 'invalidation') return 'Invalidation'
  return 'Reversal'
}

function _reversalColor(type?: string): string {
  if (type === 'invalidation') return '#ef4444'  // red
  if (type === 'reversal') return '#f97316'       // orange
  return '#6366f1'                                 // indigo (breakout)
}

function _reversalDash(type?: string): string {
  if (type === 'reversal') return '8 4'  // solid-ish
  return '6 4'                            // dashed (breakout, invalidation)
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function RhinoChart({ chart, price: priceProp, fairValue, reversalLine }: Props) {
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

  // Volume Y-axis domain
  const maxVol = Math.max(...data.map((d) => d.volume ?? 0))

  const formatDate = (d: string) => {
    const parts = d?.split('-') ?? []
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d ?? ''
  }

  // Limit zones to top 3 for cleaner visual
  const supportZones = chart.support_zones.slice(0, 3)
  const resistanceZones = chart.resistance_zones.slice(0, 3)

  // Fair value band visible only if within Y range
  const showFairValue = fairValue && fairValue.low > 0 && fairValue.low < yMax && fairValue.high > yMin

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

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 75, bottom: 0, left: 0 }}
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
          <YAxis
            yAxisId="volume"
            orientation="right"
            domain={[0, maxVol * 6]}
            hide
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              const is200 = timeframe >= 200
              return (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[140px] min-h-[60px] transition-all duration-150">
                  <div className="font-semibold text-slate-600 mb-1">{formatDate(String(label ?? ''))}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-700">
                    {!is200 && <><span className="text-slate-400">O</span><span>{fmtPrice(d.open)}</span></>}
                    {!is200 && <><span className="text-slate-400">H</span><span>{fmtPrice(d.high)}</span></>}
                    {!is200 && <><span className="text-slate-400">L</span><span>{fmtPrice(d.low)}</span></>}
                    <span className="text-slate-400">{is200 ? 'Close' : 'C'}</span>
                    <span className={d.bullish ? 'text-emerald-600' : 'text-rose-600'}>{fmtPrice(d.close)}</span>
                    <span className="text-slate-400">Vol</span>
                    <span>{d.volume ? (d.volume / 1e6).toFixed(1) + 'M' : '—'}</span>
                  </div>
                </div>
              )
            }}
          />

          {/* ═══ LAYER 1: Fair Value Band ═══ */}
          {showFairValue && (
            <ReferenceArea
              yAxisId="price"
              y1={fairValue.low}
              y2={fairValue.high}
              fill="#10b981"
              fillOpacity={0.08}
              stroke="#10b981"
              strokeOpacity={0.2}
              strokeWidth={0.5}
              ifOverflow="extendDomain"
              label={{
                value: lang === 'zh' ? '内在价值' : 'Intrinsic Value',
                position: 'insideTopLeft',
                fill: '#10b981',
                fontSize: 9,
                fontWeight: 600,
              }}
            />
          )}

          {/* ═══ LAYER 2: Support zones ═══ */}
          {supportZones.map((z, i) => (
            <ReferenceArea
              key={`s-${i}`}
              yAxisId="price"
              y1={z.lower}
              y2={z.upper}
              fill="#10b981"
              fillOpacity={z.strength >= 0.6 ? 0.10 : 0}
              stroke="#10b981"
              strokeOpacity={z.strength >= 0.6 ? 0.2 : 0.15}
              strokeDasharray={z.strength < 0.6 ? '4 4' : undefined}
              strokeWidth={z.strength >= 0.6 ? 0.5 : 0.5}
            />
          ))}

          {/* Resistance zones */}
          {resistanceZones.map((z, i) => (
            <ReferenceArea
              key={`r-${i}`}
              yAxisId="price"
              y1={z.lower}
              y2={z.upper}
              fill="#ef4444"
              fillOpacity={z.strength >= 0.6 ? 0.10 : 0}
              stroke="#ef4444"
              strokeOpacity={z.strength >= 0.6 ? 0.2 : 0.15}
              strokeDasharray={z.strength < 0.6 ? '4 4' : undefined}
              strokeWidth={z.strength >= 0.6 ? 0.5 : 0.5}
            />
          ))}

          {/* ═══ LAYER 3: Moving Averages ═══ */}
          <Line
            dataKey="sma30"
            yAxisId="price"
            type="monotone"
            stroke="#94a3b8"
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="sma100"
            yAxisId="price"
            type="monotone"
            stroke="#f97316"
            strokeWidth={1.2}
            strokeOpacity={0.6}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="sma200"
            yAxisId="price"
            type="monotone"
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeOpacity={0.7}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          {/* ═══ LAYER 4: Price Line (dominant) ═══ */}
          <Line
            dataKey="close"
            yAxisId="price"
            type="monotone"
            stroke="#1f2937"
            strokeWidth={3}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          {/* ═══ LAYER 5: Candle bodies (hidden in 200D for readability) ═══ */}
          {timeframe <= 30 && (
            <Bar
              dataKey="_candle"
              yAxisId="price"
              isAnimationActive={false}
              barSize={6}
              shape={<CandleShape />}
            />
          )}

          {/* ═══ LAYER 6: Volume bars — subdued, green/red ═══ */}
          <Bar
            dataKey="volume"
            yAxisId="volume"
            isAnimationActive={false}
            barSize={timeframe >= 200 ? 2 : 4}
            opacity={timeframe >= 200 ? 0.15 : 0.25}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.bullish ? '#10b981' : '#ef4444'} />
            ))}
          </Bar>

          {/* ═══ LAYER 7: Current Price ═══ */}
          <ReferenceLine
            yAxisId="price"
            y={price}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            label={<CurrentPriceLabel value={`$${price.toFixed(2)}`} />}
          />

          {/* ═══ LAYER 8: Reversal / Invalidation Line ═══ */}
          {reversalLine != null && (
            <ReferenceLine
              yAxisId="price"
              y={reversalLine.value}
              stroke={_reversalColor(reversalLine.type)}
              strokeWidth={2}
              strokeDasharray={_reversalDash(reversalLine.type)}
              ifOverflow="extendDomain"
              label={<ReversalLabel value={_reversalLabel(lang, reversalLine.type)} />}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-3 h-[3px] inline-block rounded" style={{ background: '#1f2937' }} />
          {lang === 'zh' ? '收盘价' : 'Price'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 inline-block rounded opacity-40" style={{ background: '#94a3b8', borderTop: '1px dashed #94a3b8' }} />
          SMA 30
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 inline-block rounded opacity-60" style={{ background: '#f97316' }} />
          SMA 100
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-[2px] inline-block rounded opacity-70" style={{ background: '#4f46e5' }} />
          SMA 200
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#10b981', opacity: 0.4 }} />
          {lang === 'zh' ? '支撑' : 'Support'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#ef4444', opacity: 0.4 }} />
          {lang === 'zh' ? '压力' : 'Resistance'}
        </span>
      </div>
    </div>
  )
}
