/**
 * Rhino chart — interactive analysis visualization with layered market structure.
 *
 * Domain strategy (PRICE-FIRST):
 *   1. Compute safe domain from visible candle lows/highs only
 *   2. Asymmetric padding: bottom 20%, top 12%
 *   3. Admit overlays only if they don't break price readability
 *   4. Hard floor guard: yMin always <= visibleLow - guaranteed margin
 *   5. Failsafe clamp: domain max capped at 120% of visible range
 *
 * Interactive viewport:
 *   - Drag to pan horizontally across 200D dataset
 *   - Scroll wheel to zoom in/out (right-edge anchored)
 *   - Dynamic X-axis tick density responds to visible bar count
 *   - Reset button with viewport indicator
 *   - Default view: last 90 bars
 */
import { useState, useMemo, useCallback, useRef } from 'react'
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
}

const DEFAULT_BARS = 90
const MIN_BARS = 20
const MAX_BARS = 200

/* -- Label collision resolver -------------------------------------------- */

interface LabelEntry { value: number; priority: number; text: string; color: string; bgColor: string; offset?: number }

function resolveLabels(entries: LabelEntry[], yMin: number, yMax: number): LabelEntry[] {
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
  return (
    <g transform={`translate(0, ${offset})`}>
      <rect x={4} y={-8} width={68} height={16} rx={4} fill={bgColor} />
      <text x={38} y={4} textAnchor="middle" fill={textColor} fontSize={10} fontWeight={700}>{value}</text>
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

/* -- Zone strength visual ------------------------------------------------ */

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

/* -- Price-first domain calculator --------------------------------------- */

function calculateDomain(
  visibleData: Array<{ low: number; high: number; sma30: number | null; sma100: number | null; sma200: number | null }>,
  price: number,
  zones: AnalysisPriceZone[],
  reversalUp: number | null,
  reversalDown: number | null,
): [number, number] {
  if (visibleData.length === 0) return [0, 1]

  // Step 1: Price-only safe range from CURRENT VIEWPORT
  const pMin = Math.min(...visibleData.map(d => d.low))
  const pMax = Math.max(...visibleData.map(d => d.high))
  const range = (pMax - pMin) || Math.max(pMax * 0.02, 1)

  // Step 2: Asymmetric padding — bottom LARGER than top
  let yMin = pMin - range * 0.20
  let yMax = pMax + range * 0.12

  // Step 3: Admit near overlays only if they don't break price readability
  // MAs that are within the padded domain get included naturally
  // Zones: only widen domain for primary zones within 120% of visible range
  const safeMaxExpansion = range * 1.2 // never expand domain more than 120% of price range

  for (const z of zones) {
    if (z.lower >= yMin && z.upper <= yMax) continue // already visible
    if (z.lower < yMin && (yMin - z.lower) < safeMaxExpansion * 0.3) {
      yMin = Math.min(yMin, z.lower - range * 0.05)
    }
    if (z.upper > yMax && (z.upper - yMax) < safeMaxExpansion * 0.3) {
      yMax = Math.max(yMax, z.upper + range * 0.05)
    }
  }

  // Reversal lines: admit only if close to current domain
  if (reversalUp != null && reversalUp > yMin && reversalUp < yMax + range * 0.15) {
    yMax = Math.max(yMax, reversalUp + range * 0.05)
  }
  if (reversalDown != null && reversalDown < yMax && reversalDown > yMin - range * 0.15) {
    yMin = Math.min(yMin, reversalDown - range * 0.05)
  }

  // Step 4: Hard floor guard — yMin MUST be below visible price low
  const guaranteedBottomMargin = Math.max(range * 0.12, price * 0.015)
  if (yMin > pMin - guaranteedBottomMargin) {
    yMin = pMin - guaranteedBottomMargin
  }

  // Step 5: Hard clamp — domain never extends beyond ~120% of visible range below/above
  const clampLimit = range * 1.2
  yMin = Math.max(yMin, pMin - clampLimit)
  yMax = Math.min(yMax, pMax + clampLimit)

  return [yMin, yMax]
}

/* -- Dynamic X-axis formatting ------------------------------------------- */

function getXAxisConfig(barCount: number) {
  if (barCount < 50) {
    return {
      interval: Math.max(Math.floor(barCount / 10), 1),
      formatter: (d: string) => {
        const parts = d?.split('-') ?? []
        return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d ?? ''
      },
    }
  }
  if (barCount <= 150) {
    return {
      interval: Math.max(Math.floor(barCount / 8), 1),
      formatter: (d: string) => {
        const parts = d?.split('-') ?? []
        return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : d ?? ''
      },
    }
  }
  // >150 bars: show month/year
  return {
    interval: Math.max(Math.floor(barCount / 6), 1),
    formatter: (d: string) => {
      const parts = d?.split('-') ?? []
      if (parts.length < 3) return d ?? ''
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${months[parseInt(parts[1]) - 1] ?? ''} '${parts[0].slice(2)}`
    },
  }
}

/* -- Main component ------------------------------------------------------ */

export default function RhinoChart({ chart, price: priceProp, fairValue }: Props) {
  const price = chart.current_price ?? priceProp ?? 0
  const { lang } = useLanguage()
  const [hoverZone, setHoverZone] = useState<AnalysisPriceZone | null>(null)

  // ── Viewport state ────────────────────────────────────────────────────
  const totalBars = chart.candles.length
  const [viewEnd, setViewEnd] = useState(totalBars)
  const [viewSize, setViewSize] = useState(Math.min(DEFAULT_BARS, totalBars))
  const chartRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartEnd = useRef(0)

  const viewStart = Math.max(0, viewEnd - viewSize)
  const isDefaultView = viewEnd >= totalBars && viewSize === Math.min(DEFAULT_BARS, totalBars)

  const resetView = useCallback(() => {
    setViewEnd(totalBars)
    setViewSize(Math.min(DEFAULT_BARS, totalBars))
  }, [totalBars])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartEnd.current = viewEnd
  }, [viewEnd])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !chartRef.current) return
    const chartWidth = chartRef.current.offsetWidth
    const barWidth = chartWidth / viewSize
    const dx = e.clientX - dragStartX.current
    const barsDelta = Math.round(-dx / barWidth)
    const newEnd = Math.max(viewSize, Math.min(totalBars, dragStartEnd.current + barsDelta))
    setViewEnd(newEnd)
  }, [viewSize, totalBars])

  const handleMouseUp = useCallback(() => { isDragging.current = false }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomDir = e.deltaY > 0 ? 1 : -1
    const step = Math.max(8, Math.round(viewSize * 0.15))
    const newSize = Math.max(MIN_BARS, Math.min(MAX_BARS, viewSize + zoomDir * step))
    setViewSize(newSize)
    setViewEnd(prev => Math.max(newSize, Math.min(totalBars, prev)))
  }, [viewSize, totalBars])

  // ── Data for current viewport ─────────────────────────────────────────
  const data = useMemo(() => {
    const sma30Map  = new Map((chart.sma30 ?? []).map(s => [s.date, s.value]))
    const sma100Map = new Map((chart.sma100 ?? []).map(s => [s.date, s.value]))
    const sma200Map = new Map((chart.sma200 ?? []).map(s => [s.date, s.value]))
    const candles = chart.candles.slice(viewStart, viewEnd)
    return candles.map(c => ({
      date: c.date,
      open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume,
      sma30:  sma30Map.get(c.date) ?? null,
      sma100: sma100Map.get(c.date) ?? null,
      sma200: sma200Map.get(c.date) ?? null,
      bullish: c.close >= c.open,
    }))
  }, [chart, viewStart, viewEnd])

  const handleMouseLeave = useCallback(() => {
    setHoverZone(null)
    isDragging.current = false
  }, [])

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <p className="text-sm text-slate-400 italic">No chart data</p>
      </div>
    )
  }

  // ── PRICE-FIRST DOMAIN ────────────────────────────────────────────────
  const supportZones = chart.support_zones.slice(0, 4)
  const resistanceZones = chart.resistance_zones.slice(0, 4)
  const allPrimaryZones = [...supportZones, ...resistanceZones]

  const reversalUp = chart.reversal_line_up ?? null
  const reversalDown = chart.reversal_line_down ?? null
  const revUpVal = reversalUp && Math.abs(reversalUp.value - price) / price < 0.30 ? reversalUp.value : null
  const revDownVal = reversalDown && Math.abs(reversalDown.value - price) / price < 0.30 ? reversalDown.value : null

  const [yMin, yMax] = calculateDomain(data, price, allPrimaryZones, revUpVal, revDownVal)

  const maxVol = Math.max(...data.map(d => d.volume ?? 0))

  // Dynamic X-axis config
  const xAxisConfig = getXAxisConfig(data.length)

  // Reversal proximity for priority rendering
  const revUpNear = reversalUp && Math.abs(reversalUp.value - price) / price < 0.05
  const revDownNear = reversalDown && Math.abs(reversalDown.value - price) / price < 0.05

  const fairMid = fairValue?.mid
  const showFairLine = fairMid != null && fairMid > 0 && fairMid > yMin && fairMid < yMax

  // Label collision
  const labelEntries: LabelEntry[] = [
    { value: price, priority: 0, text: `$${price.toFixed(2)}`, color: '#fff', bgColor: '#4f46e5' },
  ]
  if (reversalUp && reversalUp.value > yMin && reversalUp.value < yMax)
    labelEntries.push({ value: reversalUp.value, priority: 1, text: lang === 'zh' ? '上方反转' : 'Rev Up', color: '#fff', bgColor: '#059669' })
  if (reversalDown && reversalDown.value > yMin && reversalDown.value < yMax)
    labelEntries.push({ value: reversalDown.value, priority: 2, text: lang === 'zh' ? '下方反转' : 'Rev Down', color: '#fff', bgColor: '#dc2626' })
  if (resistanceZones.length > 0)
    labelEntries.push({ value: resistanceZones[0].center, priority: 3, text: `R $${resistanceZones[0].center.toFixed(0)}`, color: '#fff', bgColor: '#ef4444cc' })
  if (supportZones.length > 0)
    labelEntries.push({ value: supportZones[0].center, priority: 4, text: `S $${supportZones[0].center.toFixed(0)}`, color: '#fff', bgColor: '#10b981cc' })
  const resolvedLabels = resolveLabels(labelEntries, yMin, yMax)

  const badge = marketStateBadge(chart.market_state, lang)

  // Viewport date range for indicator
  const startDate = data[0]?.date ?? ''
  const endDate = data[data.length - 1]?.date ?? ''

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      {/* Header with viewport info */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
            {lang === 'zh' ? '技术图表' : 'Chart'}
          </h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.color + '33' }}>
            {badge.text}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Viewport indicator */}
          <span className="text-[10px] text-slate-400 tnum">
            {data.length} {lang === 'zh' ? '根' : 'bars'}
          </span>
          {!isDefaultView && (
            <button onClick={resetView}
              className="text-[11px] text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-md bg-slate-50 hover:bg-slate-100 cursor-pointer border border-slate-200"
              style={{ transition: 'all 140ms ease-out' }}>
              {lang === 'zh' ? '重置视图' : 'Reset View'}
            </button>
          )}
        </div>
      </div>

      {/* Date range */}
      {startDate && endDate && (
        <div className="text-[10px] text-slate-400 mb-2 tnum">
          {startDate} — {endDate}
        </div>
      )}

      {/* Interactive chart */}
      <div ref={chartRef}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        style={{ cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={data} margin={{ top: 10, right: 85, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tickFormatter={xAxisConfig.formatter}
              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
              interval={xAxisConfig.interval} minTickGap={40} />
            <YAxis yAxisId="price" domain={[yMin, yMax]}
              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={55} />
            <YAxis yAxisId="volume" orientation="right" domain={[0, maxVol * 6]} hide />

            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              return (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[160px]">
                  <div className="font-semibold text-slate-600 mb-1">{xAxisConfig.formatter(String(label ?? ''))}</div>
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
                        {hoverZone.sources && hoverZone.sources.length > 1 && (
                          <span className="ml-1 text-amber-600">({hoverZone.sources.length} sources)</span>
                        )}
                      </div>
                      <div>${hoverZone.center.toFixed(2)} ({((Math.abs(price - hoverZone.center) / price) * 100).toFixed(1)}% {hoverZone.center < price ? (lang === 'zh' ? '低于' : 'below') : (lang === 'zh' ? '高于' : 'above')})</div>
                    </div>
                  )}
                </div>
              )
            }} />

            {/* LAYER 1: S/R Zones */}
            {supportZones.map((z, i) => {
              const s = zoneStyle(z, true)
              return <ReferenceArea key={`s-${i}`} yAxisId="price" y1={z.lower} y2={z.upper}
                fill={s.color} fillOpacity={s.fillOpacity} stroke={s.color}
                strokeOpacity={s.strokeOpacity} strokeDasharray={s.dash} strokeWidth={s.strokeWidth}
                onMouseEnter={() => setHoverZone(z)} onMouseLeave={() => setHoverZone(null)} />
            })}
            {resistanceZones.map((z, i) => {
              const s = zoneStyle(z, false)
              return <ReferenceArea key={`r-${i}`} yAxisId="price" y1={z.lower} y2={z.upper}
                fill={s.color} fillOpacity={s.fillOpacity} stroke={s.color}
                strokeOpacity={s.strokeOpacity} strokeDasharray={s.dash} strokeWidth={s.strokeWidth}
                onMouseEnter={() => setHoverZone(z)} onMouseLeave={() => setHoverZone(null)} />
            })}

            {/* LAYER 2: MAs */}
            <Line dataKey="sma30" yAxisId="price" type="monotone" stroke="#94a3b8"
              strokeWidth={1} strokeOpacity={0.4} strokeDasharray="3 3"
              dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="sma100" yAxisId="price" type="monotone" stroke="#f97316"
              strokeWidth={1.2} strokeOpacity={0.6}
              dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="sma200" yAxisId="price" type="monotone" stroke="#4f46e5"
              strokeWidth={1.5} strokeOpacity={0.7}
              dot={false} connectNulls isAnimationActive={false} />

            {/* LAYER 3: Price */}
            <Line dataKey="close" yAxisId="price" type="monotone" stroke="#1f2937"
              strokeWidth={3} dot={false} connectNulls isAnimationActive={false} />

            {/* LAYER 4: Volume */}
            <Bar dataKey="volume" yAxisId="volume" isAnimationActive={false} barSize={2} opacity={0.15}>
              {data.map((d, i) => <Cell key={i} fill={d.bullish ? '#10b981' : '#ef4444'} />)}
            </Bar>

            {/* LAYER 5: Current Price */}
            <ReferenceLine yAxisId="price" y={price} stroke="#4f46e5" strokeWidth={1.5} strokeDasharray="4 4"
              label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 0)?.text ?? `$${price.toFixed(2)}`}
                bgColor="#4f46e5" textColor="#fff" offset={resolvedLabels.find(l => l.priority === 0)?.offset ?? 0} />} />

            {/* LAYER 6: Reversal Lines */}
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

            {/* LAYER 7: Fair value */}
            {showFairLine && (
              <ReferenceLine yAxisId="price" y={fairMid} stroke="#10b981"
                strokeWidth={1} strokeDasharray="6 6" strokeOpacity={0.5} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

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
        <span className="text-[10px] text-slate-300 ml-auto">
          {lang === 'zh' ? '拖拽平移 · 滚轮缩放' : 'Drag to pan · Scroll to zoom'}
        </span>
      </div>
    </div>
  )
}
