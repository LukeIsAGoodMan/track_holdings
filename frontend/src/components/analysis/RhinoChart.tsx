/**
 * Rhino chart — Recharts OHLC visualization with layered market structure.
 *
 * Domain safety:
 *   - Y-axis computed ONLY from visible price + MAs + primary_levels
 *   - reference_levels NEVER affect domain
 *   - Frontend failsafe clamp: domain max capped at 120% of visible max
 *   - Zones rendered as narrow translucent rectangular bands
 *   - Reversal lines within close proximity get priority rendering
 *
 * Layer order (back → front):
 *   1. Support/Resistance zones (translucent bands, tiered by strength)
 *   2. Moving Averages (SMA30, SMA100, SMA200)
 *   3. Price Line (close series, dominant)
 *   4. Candle bodies (short views)
 *   5. Volume bars
 *   6. Current price marker
 *   7. Reversal lines (up/down, priority for near-price)
 *   8. Fair value reference line
 *
 * Label collision: Priority: Current Price > Reversal Lines > S/R Levels
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
  price?: number
  fairValue?: { low: number; mid: number; high: number }
  reversalLine?: { value: number; type: 'breakout' | 'reversal' | 'invalidation' }
}

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

  const oY = yAxis.scale(payload.open)
  const cY = yAxis.scale(payload.close)
  const hY = yAxis.scale(payload.high)
  const lY = yAxis.scale(payload.low)

  const bodyTop = Math.min(oY, cY)
  const bodyH   = Math.max(Math.abs(oY - cY), 1)
  const cx      = x + width / 2
  const fill    = payload.bullish ? '#10b981' : '#ef4444'

  return (
    <g>
      <line x1={cx} y1={hY} x2={cx} y2={lY} stroke={fill} strokeWidth={1} />
      <rect x={x + 1} y={bodyTop} width={Math.max(width - 2, 2)} height={bodyH} fill={fill} rx={1} />
    </g>
  )
}

/* -- Right-edge label ---------------------------------------------------- */

interface LabelEntry { value: number; priority: number; text: string; color: string; bgColor: string; offset?: number }

function resolveLabels(entries: LabelEntry[], yMin: number, yMax: number): LabelEntry[] {
  if (entries.length === 0) return []
  const range = yMax - yMin
  const threshold = range * 0.03
  const sorted = [...entries].sort((a, b) => a.priority - b.priority)
  const resolved: LabelEntry[] = []
  for (const entry of sorted) {
    let offset = 0
    for (const placed of resolved) {
      if (Math.abs(entry.value - placed.value - (placed.offset ?? 0)) < threshold) {
        offset = placed.value < entry.value ? -threshold * 1.2 : threshold * 1.2
      }
    }
    resolved.push({ ...entry, offset })
  }
  return resolved
}

function RightEdgeLabel({ value, bgColor, textColor, offset = 0 }: { value: string; bgColor: string; textColor: string; offset?: number }) {
  const y = offset
  return (
    <g transform={`translate(0, ${y})`}>
      <rect x={4} y={-8} width={68} height={16} rx={4} fill={bgColor} />
      <text x={38} y={4} textAnchor="middle" fill={textColor} fontSize={10} fontWeight={700}>
        {value}
      </text>
    </g>
  )
}

/* -- Market state badge -------------------------------------------------- */

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
  if (s >= 0.7) return { fillOpacity: 0.07, strokeOpacity: 0.25, strokeWidth: 0.5, dash: undefined, color }
  if (s >= 0.4) return { fillOpacity: 0.04, strokeOpacity: 0.15, strokeWidth: 0.5, dash: undefined, color }
  return { fillOpacity: 0, strokeOpacity: 0.10, strokeWidth: 0.5, dash: '4 4', color }
}

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
  const { lang } = useLanguage()
  const [hoverZone, setHoverZone] = useState<AnalysisPriceZone | null>(null)

  // Fixed 200D data — no timeframe toggle
  const data = useMemo(() => {
    const sma30Map  = new Map((chart.sma30 ?? []).map((s) => [s.date, s.value]))
    const sma100Map = new Map((chart.sma100 ?? []).map((s) => [s.date, s.value]))
    const sma200Map = new Map((chart.sma200 ?? []).map((s) => [s.date, s.value]))
    const candles = chart.candles.slice(-200)
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
  }, [chart])

  const handleMouseLeave = useCallback(() => { setHoverZone(null) }, [])

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-sm text-slate-400 italic">No chart data</p>
      </div>
    )
  }

  // ── Domain calculation: ONLY from visible price + MAs + primary_levels ──
  const allLows = data.map((d) => d.low)
  const allHighs = data.map((d) => d.high)
  const lineValues: number[] = [price]

  // Include MAs in domain
  for (const d of data) {
    if (d.sma30 != null) lineValues.push(d.sma30)
    if (d.sma100 != null) lineValues.push(d.sma100)
    if (d.sma200 != null) lineValues.push(d.sma200)
  }

  // Include primary S/R zones in domain (NOT reference zones)
  const supportZones = chart.support_zones.slice(0, 4)
  const resistanceZones = chart.resistance_zones.slice(0, 4)
  for (const z of [...supportZones, ...resistanceZones]) {
    lineValues.push(z.lower, z.upper)
  }

  // Include reversal lines ONLY if within ±30% of price
  const reversalUp = chart.reversal_line_up ?? null
  const reversalDown = chart.reversal_line_down ?? null
  if (reversalUp && Math.abs(reversalUp.value - price) / price < 0.30) {
    lineValues.push(reversalUp.value)
  }
  if (reversalDown && Math.abs(reversalDown.value - price) / price < 0.30) {
    lineValues.push(reversalDown.value)
  }
  if (fairValue?.mid) lineValues.push(fairValue.mid)

  // Compute raw domain
  let dataMin = Math.min(...allLows, ...lineValues)
  let dataMax = Math.max(...allHighs, ...lineValues)

  // ── FAILSAFE CLAMP: never let domain exceed ±50% of visible price range ──
  const visibleMin = Math.min(...allLows)
  const visibleMax = Math.max(...allHighs)
  const visibleRange = visibleMax - visibleMin
  const clampMax = visibleMax + visibleRange * 0.5
  const clampMin = visibleMin - visibleRange * 0.5
  dataMax = Math.min(dataMax, clampMax)
  dataMin = Math.max(dataMin, clampMin)

  const dataRange = dataMax - dataMin
  const yPadding = Math.max(dataRange * 0.06, dataMax * 0.015)
  const yMin = dataMin - yPadding
  const yMax = dataMax + yPadding

  const maxVol = Math.max(...data.map((d) => d.volume ?? 0))

  const formatDate = (d: string) => {
    const parts = d?.split('-') ?? []
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d ?? ''
  }

  // Reversal line proximity: if within ~5% of price, it's a priority risk boundary
  const revUpNear = reversalUp && Math.abs(reversalUp.value - price) / price < 0.05
  const revDownNear = reversalDown && Math.abs(reversalDown.value - price) / price < 0.05

  // Fair value reference line
  const fairMid = fairValue?.mid
  const showFairLine = fairMid != null && fairMid > 0 && fairMid > yMin && fairMid < yMax

  // Label collision resolver
  const labelEntries: LabelEntry[] = [
    { value: price, priority: 0, text: `$${price.toFixed(2)}`, color: '#fff', bgColor: '#4f46e5' },
  ]
  if (reversalUp && reversalUp.value > yMin && reversalUp.value < yMax) {
    labelEntries.push({ value: reversalUp.value, priority: 1, text: lang === 'zh' ? '上方反转' : 'Rev Up', color: '#fff', bgColor: '#059669' })
  }
  if (reversalDown && reversalDown.value > yMin && reversalDown.value < yMax) {
    labelEntries.push({ value: reversalDown.value, priority: 2, text: lang === 'zh' ? '下方反转' : 'Rev Down', color: '#fff', bgColor: '#dc2626' })
  }
  if (resistanceZones.length > 0) {
    labelEntries.push({ value: resistanceZones[0].center, priority: 3, text: `R $${resistanceZones[0].center.toFixed(0)}`, color: '#fff', bgColor: '#ef4444cc' })
  }
  if (supportZones.length > 0) {
    labelEntries.push({ value: supportZones[0].center, priority: 4, text: `S $${supportZones[0].center.toFixed(0)}`, color: '#fff', bgColor: '#10b981cc' })
  }
  const resolvedLabels = resolveLabels(labelEntries, yMin, yMax)

  const badge = marketStateBadge(chart.market_state, lang)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {lang === 'zh' ? '技术图表' : 'Chart'}
        </h3>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
          style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.color + '33' }}
        >
          {badge.text}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={data} margin={{ top: 10, right: 85, bottom: 0, left: 0 }} onMouseLeave={handleMouseLeave}>
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false} axisLine={false}
            interval={Math.max(Math.floor(data.length / 8), 1)}
          />
          <YAxis yAxisId="price" domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={55} />
          <YAxis yAxisId="volume" orientation="right" domain={[0, maxVol * 6]} hide />

          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              return (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[160px]">
                  <div className="font-semibold text-slate-600 mb-1">{formatDate(String(label ?? ''))}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-700">
                    <span className="text-slate-400">Close</span>
                    <span className={d.bullish ? 'text-emerald-600' : 'text-rose-600'}>{fmtPrice(d.close)}</span>
                    <span className="text-slate-400">Vol</span>
                    <span>{d.volume ? (d.volume / 1e6).toFixed(1) + 'M' : '—'}</span>
                  </div>
                  {hoverZone && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500 space-y-0.5">
                      <div className="font-semibold text-slate-700">
                        {zoneTypeLabel(hoverZone, lang)} · {strengthLabel(hoverZone.strength, lang)}
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

          {/* === LAYER 1: S/R Zones — narrow translucent bands === */}
          {supportZones.map((z, i) => {
            const style = zoneStyle(z, true)
            return (
              <ReferenceArea key={`s-${i}`} yAxisId="price" y1={z.lower} y2={z.upper}
                fill={style.color} fillOpacity={style.fillOpacity}
                stroke={style.color} strokeOpacity={style.strokeOpacity}
                strokeDasharray={style.dash} strokeWidth={style.strokeWidth}
                onMouseEnter={() => setHoverZone(z)} onMouseLeave={() => setHoverZone(null)} />
            )
          })}
          {resistanceZones.map((z, i) => {
            const style = zoneStyle(z, false)
            return (
              <ReferenceArea key={`r-${i}`} yAxisId="price" y1={z.lower} y2={z.upper}
                fill={style.color} fillOpacity={style.fillOpacity}
                stroke={style.color} strokeOpacity={style.strokeOpacity}
                strokeDasharray={style.dash} strokeWidth={style.strokeWidth}
                onMouseEnter={() => setHoverZone(z)} onMouseLeave={() => setHoverZone(null)} />
            )
          })}

          {/* === LAYER 2: Moving Averages === */}
          <Line dataKey="sma30" yAxisId="price" type="monotone" stroke="#94a3b8"
            strokeWidth={1} strokeOpacity={0.4} strokeDasharray="3 3"
            dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="sma100" yAxisId="price" type="monotone" stroke="#f97316"
            strokeWidth={1.2} strokeOpacity={0.6}
            dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="sma200" yAxisId="price" type="monotone" stroke="#4f46e5"
            strokeWidth={1.5} strokeOpacity={0.7}
            dot={false} connectNulls isAnimationActive={false} />

          {/* === LAYER 3: Price Line === */}
          <Line dataKey="close" yAxisId="price" type="monotone" stroke="#1f2937"
            strokeWidth={3} dot={false} connectNulls isAnimationActive={false} />

          {/* === LAYER 5: Volume bars === */}
          <Bar dataKey="volume" yAxisId="volume" isAnimationActive={false} barSize={2} opacity={0.15}>
            {data.map((d, i) => <Cell key={i} fill={d.bullish ? '#10b981' : '#ef4444'} />)}
          </Bar>

          {/* === LAYER 6: Current Price === */}
          <ReferenceLine yAxisId="price" y={price} stroke="#4f46e5" strokeWidth={1.5} strokeDasharray="4 4"
            label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 0)?.text ?? `$${price.toFixed(2)}`}
              bgColor="#4f46e5" textColor="#fff" offset={resolvedLabels.find(l => l.priority === 0)?.offset ?? 0} />} />

          {/* === LAYER 7: Reversal Lines — priority rendering for near-price === */}
          {reversalUp && reversalUp.value > yMin && reversalUp.value < yMax && (
            <ReferenceLine yAxisId="price" y={reversalUp.value}
              stroke="#059669" strokeWidth={revUpNear ? 2.5 : 1.5}
              strokeDasharray={revUpNear ? '6 3' : '8 4'}
              label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 1)?.text ?? 'Rev Up'}
                bgColor="#059669" textColor="#fff" offset={resolvedLabels.find(l => l.priority === 1)?.offset ?? 0} />} />
          )}
          {reversalDown && reversalDown.value > yMin && reversalDown.value < yMax && (
            <ReferenceLine yAxisId="price" y={reversalDown.value}
              stroke="#dc2626" strokeWidth={revDownNear ? 2.5 : 1.5}
              strokeDasharray={revDownNear ? '6 3' : '8 4'}
              label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 2)?.text ?? 'Rev Down'}
                bgColor="#dc2626" textColor="#fff" offset={resolvedLabels.find(l => l.priority === 2)?.offset ?? 0} />} />
          )}

          {/* === LAYER 8: Fair value === */}
          {showFairLine && (
            <ReferenceLine yAxisId="price" y={fairMid} stroke="#10b981"
              strokeWidth={1} strokeDasharray="6 6" strokeOpacity={0.5} />
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
