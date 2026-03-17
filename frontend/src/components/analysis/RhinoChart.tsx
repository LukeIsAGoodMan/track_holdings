/**
 * Rhino chart — Recharts OHLC visualization with layered market structure.
 *
 * Layer order (back -> front):
 *   1. Support / Resistance zones (tiered by strength)
 *   2. Moving Averages (SMA30, SMA100, SMA200) — Trend Layer
 *   3. Price Line (close series, dominant)
 *   4. Candle bodies (10D/30D only)
 *   5. Volume bars (green=up, red=down)
 *   6. Current price marker + guide line
 *   7. Reversal lines (up/down, regime change signals)
 *   8. Fair value reference line (thin, replaces shaded band)
 *
 * Label collision system:
 *   Priority: Current Price > Reversal Lines > Box Boundary > S/R Levels
 *   Auto-offset when labels overlap (within 3% threshold)
 */
import { useState, useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ReferenceArea,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import type { AnalysisChart, AnalysisPriceZone } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice } from '@/utils/format'

interface Props {
  chart: AnalysisChart
  /** @deprecated pass via chart.current_price instead */
  price?: number
  fairValue?: { low: number; mid: number; high: number }
  /** Legacy single reversal line */
  reversalLine?: { value: number; type: 'breakout' | 'reversal' | 'invalidation' }
}

/* -- Timeframe options --------------------------------------------------- */

const TIMEFRAMES = [
  { label: '10D', days: 10 },
  { label: '30D', days: 30 },
  { label: '200D', days: 200 },
] as const

type Timeframe = typeof TIMEFRAMES[number]['days']

/* -- Custom candle shape ------------------------------------------------- */

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

/* -- Label collision resolver -------------------------------------------- */

interface LabelEntry {
  value: number
  priority: number    // lower = higher priority
  text: string
  color: string
  bgColor: string
}

function resolveLabels(entries: LabelEntry[], yMin: number, yMax: number): (LabelEntry & { offset: number })[] {
  // Sort by priority (highest first = lowest number)
  const sorted = [...entries].sort((a, b) => a.priority - b.priority)
  const placed: { y: number; height: number }[] = []
  const LABEL_HEIGHT = 20
  const range = yMax - yMin

  return sorted.map((entry) => {
    // Normalize to pixel-like space (0-400)
    const normY = ((entry.value - yMin) / range) * 400
    let offset = 0

    // Check for overlaps with already-placed labels
    for (const p of placed) {
      if (Math.abs(normY + offset - p.y) < LABEL_HEIGHT) {
        // Shift down (positive offset moves label down)
        offset += LABEL_HEIGHT - Math.abs(normY + offset - p.y)
      }
    }

    placed.push({ y: normY + offset, height: LABEL_HEIGHT })
    return { ...entry, offset }
  })
}

/* -- Right-edge label component ------------------------------------------ */

function RightEdgeLabel({ viewBox, value, bgColor, textColor, offset }: {
  viewBox?: { x?: number; y?: number; width?: number }
  value?: string
  bgColor: string
  textColor: string
  offset: number
}) {
  if (!viewBox) return null
  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) + 2
  const y = (viewBox.y ?? 0) + offset
  return (
    <g>
      <rect x={x} y={y - 10} width={72} height={20} rx={4} fill={bgColor} />
      <text x={x + 36} y={y + 4} textAnchor="middle" fill={textColor} fontSize={10} fontWeight={700}>
        {value}
      </text>
    </g>
  )
}

/* -- Market state badge colors ------------------------------------------- */

function marketStateBadge(state?: string, lang?: string): { text: string; color: string; bg: string } {
  switch (state) {
    case 'TRENDING':
      return { text: lang === 'zh' ? '趋势' : 'TRENDING', color: '#059669', bg: '#ecfdf5' }
    case 'BREAKDOWN_RISK':
      return { text: lang === 'zh' ? '破位风险' : 'BREAKDOWN RISK', color: '#dc2626', bg: '#fef2f2' }
    default:
      return { text: lang === 'zh' ? '震荡' : 'RANGE', color: '#d97706', bg: '#fffbeb' }
  }
}

/* -- Zone strength visual properties ------------------------------------- */

function zoneStyle(zone: AnalysisPriceZone, isSupport: boolean) {
  const color = isSupport ? '#10b981' : '#ef4444'
  const s = zone.strength
  if (s >= 0.7) return { fillOpacity: 0.08, strokeOpacity: 0.3, strokeWidth: 1, dash: undefined, color }
  if (s >= 0.4) return { fillOpacity: 0.04, strokeOpacity: 0.2, strokeWidth: 0.5, dash: undefined, color }
  return { fillOpacity: 0, strokeOpacity: 0.12, strokeWidth: 0.5, dash: '4 4', color }
}

/* -- Zone type label for tooltips ---------------------------------------- */

function zoneTypeLabel(zone: AnalysisPriceZone, lang: string): string {
  const t = zone.zone_type ?? 'consolidation'
  const labels: Record<string, { en: string; zh: string }> = {
    pivot: { en: 'Pivot', zh: '枢轴' },
    MA: { en: 'Moving Average', zh: '均线' },
    consolidation: { en: 'Consolidation', zh: '整理区间' },
    breakout: { en: 'Breakout', zh: '突破' },
  }
  return labels[t]?.[lang === 'zh' ? 'zh' : 'en'] ?? t
}

function strengthLabel(s: number, lang: string): string {
  if (s >= 0.7) return lang === 'zh' ? '强' : 'Strong'
  if (s >= 0.4) return lang === 'zh' ? '中' : 'Medium'
  return lang === 'zh' ? '弱' : 'Weak'
}

/* -- Main component ------------------------------------------------------ */

export default function RhinoChart({ chart, price: priceProp, fairValue, reversalLine: _legacyReversalLine }: Props) {
  const price = chart.current_price ?? priceProp ?? 0
  const { lang, t } = useLanguage()
  const [timeframe, setTimeframe] = useState<Timeframe>(200)
  const [hoverZone, setHoverZone] = useState<AnalysisPriceZone | null>(null)

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
  const handleMouseLeave = useCallback(() => { setHoverZone(null) }, [])

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

  // Collect all rendered line values for dynamic Y-axis breathing
  const allLows = data.map((d) => d.low)
  const allHighs = data.map((d) => d.high)
  const lineValues: number[] = [price]
  if (chart.reversal_line_up?.value) lineValues.push(chart.reversal_line_up.value)
  if (chart.reversal_line_down?.value) lineValues.push(chart.reversal_line_down.value)
  if (fairValue?.mid) lineValues.push(fairValue.mid)

  // Dynamic Y-axis with breathing room (Task 7)
  const dataMin = Math.min(...allLows, ...lineValues)
  const dataMax = Math.max(...allHighs, ...lineValues)
  const dataRange = dataMax - dataMin
  const yPadding = Math.max(dataRange * 0.06, dataMax * 0.015) // at least 1.5%
  const yMin = dataMin - yPadding
  const yMax = dataMax + yPadding

  // Volume Y-axis domain
  const maxVol = Math.max(...data.map((d) => d.volume ?? 0))

  const formatDate = (d: string) => {
    const parts = d?.split('-') ?? []
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d ?? ''
  }

  // Limit zones: top 5 per side, tiered by strength
  const supportZones = chart.support_zones.slice(0, 5)
  const resistanceZones = chart.resistance_zones.slice(0, 5)

  // Dual reversal lines from chart data (new) or legacy prop
  const reversalUp = chart.reversal_line_up ?? null
  const reversalDown = chart.reversal_line_down ?? null

  // Fair value: thin reference line only (Task 4 — no shaded band)
  const fairMid = fairValue?.mid
  const showFairLine = fairMid != null && fairMid > 0 && fairMid > yMin && fairMid < yMax

  // Label collision resolver (Task 5)
  const labelEntries: LabelEntry[] = [
    { value: price, priority: 0, text: `$${price.toFixed(2)}`, color: '#fff', bgColor: '#4f46e5' },
  ]
  if (reversalUp) {
    labelEntries.push({
      value: reversalUp.value, priority: 1,
      text: lang === 'zh' ? '上方反转' : 'Rev Up',
      color: '#fff', bgColor: '#059669',
    })
  }
  if (reversalDown) {
    labelEntries.push({
      value: reversalDown.value, priority: 2,
      text: lang === 'zh' ? '下方反转' : 'Rev Down',
      color: '#fff', bgColor: '#dc2626',
    })
  }
  if (resistanceZones.length > 0) {
    labelEntries.push({
      value: resistanceZones[0].center, priority: 3,
      text: `R $${resistanceZones[0].center.toFixed(0)}`,
      color: '#fff', bgColor: '#ef4444cc',
    })
  }
  if (supportZones.length > 0) {
    labelEntries.push({
      value: supportZones[0].center, priority: 4,
      text: `S $${supportZones[0].center.toFixed(0)}`,
      color: '#fff', bgColor: '#10b981cc',
    })
  }
  const resolvedLabels = resolveLabels(labelEntries, yMin, yMax)

  // Market state badge
  const badge = marketStateBadge(chart.market_state, lang)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      {/* Header with timeframe selector + market state badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
            {t('analysis_chart')}
          </h3>
          {/* Task 9: Market state badge */}
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.color + '33' }}
          >
            {badge.text}
          </span>
        </div>
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
          margin={{ top: 10, right: 85, bottom: 0, left: 0 }}
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

          {/* -- Tooltip with hover semantics (Task 8) -- */}
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              const is200 = timeframe >= 200
              return (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[160px] transition-all duration-150">
                  <div className="font-semibold text-slate-600 mb-1">{formatDate(String(label ?? ''))}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-700">
                    {!is200 && <><span className="text-slate-400">O</span><span>{fmtPrice(d.open)}</span></>}
                    {!is200 && <><span className="text-slate-400">H</span><span>{fmtPrice(d.high)}</span></>}
                    {!is200 && <><span className="text-slate-400">L</span><span>{fmtPrice(d.low)}</span></>}
                    <span className="text-slate-400">{is200 ? 'Close' : 'C'}</span>
                    <span className={d.bullish ? 'text-emerald-600' : 'text-rose-600'}>{fmtPrice(d.close)}</span>
                    <span className="text-slate-400">Vol</span>
                    <span>{d.volume ? (d.volume / 1e6).toFixed(1) + 'M' : '\u2014'}</span>
                  </div>
                  {/* Hover zone info (Task 8) */}
                  {hoverZone && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500 space-y-0.5">
                      <div className="font-semibold text-slate-700">
                        {zoneTypeLabel(hoverZone, lang)} {lang === 'zh' ? '' : ''} {strengthLabel(hoverZone.strength, lang)}
                      </div>
                      <div>${hoverZone.center.toFixed(2)} ({((Math.abs(price - hoverZone.center) / price) * 100).toFixed(1)}% {hoverZone.center < price ? (lang === 'zh' ? '低于' : 'below') : (lang === 'zh' ? '高于' : 'above')})</div>
                      {(hoverZone.validity_days ?? 0) > 0 && (
                        <div>{lang === 'zh' ? '有效' : 'Held'} {hoverZone.validity_days} {lang === 'zh' ? '天' : 'days'}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            }}
          />

          {/* === LAYER 1: Support / Resistance Zones (tiered by strength) === */}
          {supportZones.map((z, i) => {
            const style = zoneStyle(z, true)
            return (
              <ReferenceArea
                key={`s-${i}`}
                yAxisId="price"
                y1={z.lower}
                y2={z.upper}
                fill={style.color}
                fillOpacity={style.fillOpacity}
                stroke={style.color}
                strokeOpacity={style.strokeOpacity}
                strokeDasharray={style.dash}
                strokeWidth={style.strokeWidth}
                onMouseEnter={() => setHoverZone(z)}
                onMouseLeave={() => setHoverZone(null)}
              />
            )
          })}

          {resistanceZones.map((z, i) => {
            const style = zoneStyle(z, false)
            return (
              <ReferenceArea
                key={`r-${i}`}
                yAxisId="price"
                y1={z.lower}
                y2={z.upper}
                fill={style.color}
                fillOpacity={style.fillOpacity}
                stroke={style.color}
                strokeOpacity={style.strokeOpacity}
                strokeDasharray={style.dash}
                strokeWidth={style.strokeWidth}
                onMouseEnter={() => setHoverZone(z)}
                onMouseLeave={() => setHoverZone(null)}
              />
            )
          })}

          {/* === LAYER 2: Moving Averages (Trend Layer) === */}
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

          {/* === LAYER 3: Price Line (dominant) === */}
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

          {/* === LAYER 4: Candle bodies (10D/30D only) === */}
          {timeframe <= 30 && (
            <Bar
              dataKey="_candle"
              yAxisId="price"
              isAnimationActive={false}
              barSize={6}
              shape={<CandleShape />}
            />
          )}

          {/* === LAYER 5: Volume bars === */}
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

          {/* === LAYER 6: Current Price with collision-resolved label === */}
          <ReferenceLine
            yAxisId="price"
            y={price}
            stroke="#4f46e5"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            label={
              <RightEdgeLabel
                value={resolvedLabels.find(l => l.priority === 0)?.text ?? `$${price.toFixed(2)}`}
                bgColor="#4f46e5"
                textColor="#fff"
                offset={resolvedLabels.find(l => l.priority === 0)?.offset ?? 0}
              />
            }
          />

          {/* === LAYER 7: Dual Reversal Lines === */}
          {reversalUp && (
            <ReferenceLine
              yAxisId="price"
              y={reversalUp.value}
              stroke="#059669"
              strokeWidth={2}
              strokeDasharray="8 4"
              ifOverflow="extendDomain"
              label={
                <RightEdgeLabel
                  value={resolvedLabels.find(l => l.priority === 1)?.text ?? 'Rev Up'}
                  bgColor="#059669"
                  textColor="#fff"
                  offset={resolvedLabels.find(l => l.priority === 1)?.offset ?? 0}
                />
              }
            />
          )}
          {reversalDown && (
            <ReferenceLine
              yAxisId="price"
              y={reversalDown.value}
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="8 4"
              ifOverflow="extendDomain"
              label={
                <RightEdgeLabel
                  value={resolvedLabels.find(l => l.priority === 2)?.text ?? 'Rev Down'}
                  bgColor="#dc2626"
                  textColor="#fff"
                  offset={resolvedLabels.find(l => l.priority === 2)?.offset ?? 0}
                />
              }
            />
          )}

          {/* === LAYER 8: Fair value thin reference line (Task 4) === */}
          {showFairLine && (
            <ReferenceLine
              yAxisId="price"
              y={fairMid}
              stroke="#10b981"
              strokeWidth={1}
              strokeDasharray="6 6"
              strokeOpacity={0.5}
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
        {reversalUp && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-[2px] inline-block rounded" style={{ background: '#059669' }} />
            {lang === 'zh' ? '上方反转' : 'Rev Up'}
          </span>
        )}
        {reversalDown && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-[2px] inline-block rounded" style={{ background: '#dc2626' }} />
            {lang === 'zh' ? '下方反转' : 'Rev Down'}
          </span>
        )}
        {showFairLine && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 inline-block rounded opacity-50" style={{ background: '#10b981', borderTop: '1px dashed #10b981' }} />
            {lang === 'zh' ? '公允价值' : 'Fair Value'}
          </span>
        )}
      </div>
    </div>
  )
}
