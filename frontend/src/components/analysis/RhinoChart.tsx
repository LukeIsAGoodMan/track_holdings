/**
 * Rhino chart — interactive analysis visualization with layered market structure.
 *
 * Key fixes in this version:
 *   - Native wheel listener with { passive: false } for proper scroll suppression
 *   - No ReferenceArea hover events (eliminates black hover box artifact)
 *   - Zone info shown via crosshair proximity detection instead
 *   - Reversal lines rendered ABOVE zones with distinct visual language
 *   - Tooltip uses pointer-events: none + subtle transition
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
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

interface LabelEntry { value: number; priority: number; text: string; bgColor: string; offset?: number }

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

function RightEdgeLabel({ value, bgColor, offset = 0 }: { value: string; bgColor: string; offset?: number }) {
  return (
    <g transform={`translate(0, ${offset})`}>
      <rect x={4} y={-8} width={68} height={16} rx={4} fill={bgColor} />
      <text x={38} y={4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>{value}</text>
    </g>
  )
}

function marketStateBadge(state?: string, lang?: string) {
  switch (state) {
    case 'TRENDING':       return { text: lang === 'zh' ? '趋势' : 'TRENDING', color: '#059669', bg: '#ecfdf5' }
    case 'BREAKDOWN_RISK': return { text: lang === 'zh' ? '破位风险' : 'BREAKDOWN RISK', color: '#dc2626', bg: '#fef2f2' }
    default:               return { text: lang === 'zh' ? '震荡' : 'RANGE', color: '#d97706', bg: '#fffbeb' }
  }
}

/* -- Zone visual --------------------------------------------------------- */

function zoneStyle(zone: AnalysisPriceZone, isSupport: boolean) {
  const color = isSupport ? '#10b981' : '#ef4444'
  const s = zone.strength
  // No stroke — zones are pure translucent bands, no border artifacts
  if (s >= 0.7) return { fillOpacity: 0.08, color }
  if (s >= 0.4) return { fillOpacity: 0.04, color }
  return { fillOpacity: 0.02, color }
}

function zoneTypeLabel(zone: AnalysisPriceZone, lang: string): string {
  const t = zone.zone_type ?? 'consolidation'
  const labels: Record<string, { en: string; zh: string }> = {
    pivot: { en: 'Pivot', zh: '枢轴' }, MA: { en: 'MA', zh: '均线' },
    consolidation: { en: 'Volume Zone', zh: '量价区间' }, breakout: { en: 'Breakout', zh: '突破' },
  }
  return labels[t]?.[lang === 'zh' ? 'zh' : 'en'] ?? t
}

function strengthLabel(s: number, lang: string): string {
  if (s >= 0.7) return lang === 'zh' ? '强' : 'Strong'
  if (s >= 0.4) return lang === 'zh' ? '中' : 'Medium'
  return lang === 'zh' ? '弱' : 'Weak'
}

/* -- Price-first domain -------------------------------------------------- */

function calculateDomain(
  visibleData: Array<{ low: number; high: number }>,
  price: number,
  zones: AnalysisPriceZone[],
  reversalUp: number | null,
  reversalDown: number | null,
): [number, number] {
  if (visibleData.length === 0) return [0, 1]
  const pMin = Math.min(...visibleData.map(d => d.low))
  const pMax = Math.max(...visibleData.map(d => d.high))
  const range = (pMax - pMin) || Math.max(pMax * 0.02, 1)

  let yMin = pMin - range * 0.20
  let yMax = pMax + range * 0.12

  for (const z of zones) {
    if (z.lower >= yMin && z.upper <= yMax) continue
    if (z.lower < yMin && (yMin - z.lower) < range * 0.35) yMin = Math.min(yMin, z.lower - range * 0.05)
    if (z.upper > yMax && (z.upper - yMax) < range * 0.35) yMax = Math.max(yMax, z.upper + range * 0.05)
  }

  if (reversalUp != null && reversalUp > yMin && reversalUp < yMax + range * 0.15) yMax = Math.max(yMax, reversalUp + range * 0.05)
  if (reversalDown != null && reversalDown < yMax && reversalDown > yMin - range * 0.15) yMin = Math.min(yMin, reversalDown - range * 0.05)

  const bottomGuard = Math.max(range * 0.12, price * 0.015)
  if (yMin > pMin - bottomGuard) yMin = pMin - bottomGuard

  yMin = Math.max(yMin, pMin - range * 1.2)
  yMax = Math.min(yMax, pMax + range * 1.2)
  return [yMin, yMax]
}

/* -- X-axis config ------------------------------------------------------- */

function getXAxisConfig(n: number) {
  if (n < 50) return { interval: Math.max(Math.floor(n / 10), 1), fmt: fmtDateShort }
  if (n <= 150) return { interval: Math.max(Math.floor(n / 8), 1), fmt: fmtDateShort }
  return { interval: Math.max(Math.floor(n / 6), 1), fmt: fmtDateLong }
}
function fmtDateShort(d: string) { const p = d?.split('-') ?? []; return p.length >= 3 ? `${p[1]}/${p[2]}` : d ?? '' }
function fmtDateLong(d: string) {
  const p = d?.split('-') ?? []; if (p.length < 3) return d ?? ''
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${m[parseInt(p[1]) - 1] ?? ''} '${p[0].slice(2)}`
}

/* -- Main component ------------------------------------------------------ */

export default function RhinoChart({ chart, price: priceProp, fairValue }: Props) {
  const price = chart.current_price ?? priceProp ?? 0
  const { lang } = useLanguage()

  const totalBars = chart.candles.length
  const [viewEnd, setViewEnd] = useState(totalBars)
  const [viewSize, setViewSize] = useState(Math.min(DEFAULT_BARS, totalBars))
  const chartRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartEnd = useRef(0)

  const viewStart = Math.max(0, viewEnd - viewSize)
  const isDefaultView = viewEnd >= totalBars && viewSize === Math.min(DEFAULT_BARS, totalBars)

  const resetView = useCallback(() => { setViewEnd(totalBars); setViewSize(Math.min(DEFAULT_BARS, totalBars)) }, [totalBars])

  // ── Native wheel listener: { passive: false } for real scroll suppression ──
  useEffect(() => {
    const el = chartRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      e.preventDefault() // suppresses page scroll
      const zoomDir = e.deltaY > 0 ? 1 : -1
      setViewSize(prev => {
        const step = Math.max(10, Math.round(prev * 0.18))
        const next = Math.max(MIN_BARS, Math.min(MAX_BARS, prev + zoomDir * step))
        setViewEnd(end => Math.max(next, Math.min(totalBars, end)))
        return next
      })
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [totalBars])

  // Drag pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true; dragStartX.current = e.clientX; dragStartEnd.current = viewEnd
  }, [viewEnd])
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !chartRef.current) return
    const barW = chartRef.current.offsetWidth / viewSize
    const delta = Math.round(-(e.clientX - dragStartX.current) / barW)
    setViewEnd(Math.max(viewSize, Math.min(totalBars, dragStartEnd.current + delta)))
  }, [viewSize, totalBars])
  const handleMouseUp = useCallback(() => { isDragging.current = false }, [])
  const handleMouseLeave = useCallback(() => { isDragging.current = false }, [])

  // ── Data for viewport ──────────────────────────────────────────────────
  const data = useMemo(() => {
    const sma30Map  = new Map((chart.sma30 ?? []).map(s => [s.date, s.value]))
    const sma100Map = new Map((chart.sma100 ?? []).map(s => [s.date, s.value]))
    const sma200Map = new Map((chart.sma200 ?? []).map(s => [s.date, s.value]))
    return chart.candles.slice(viewStart, viewEnd).map(c => ({
      date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      sma30: sma30Map.get(c.date) ?? null, sma100: sma100Map.get(c.date) ?? null, sma200: sma200Map.get(c.date) ?? null,
      bullish: c.close >= c.open,
    }))
  }, [chart, viewStart, viewEnd])

  if (data.length === 0) {
    return <div className="bg-v2-surface border border-v2-border rounded-v2-lg p-5"><p className="text-sm text-slate-400 italic">No chart data</p></div>
  }

  // ── Domain ─────────────────────────────────────────────────────────────
  const supportZones = chart.support_zones.slice(0, 3)
  const resistanceZones = chart.resistance_zones.slice(0, 3)
  const reversalUp = chart.reversal_line_up ?? null
  const reversalDown = chart.reversal_line_down ?? null
  const revUpVal = reversalUp && Math.abs(reversalUp.value - price) / price < 0.30 ? reversalUp.value : null
  const revDownVal = reversalDown && Math.abs(reversalDown.value - price) / price < 0.30 ? reversalDown.value : null

  const [yMin, yMax] = calculateDomain(data, price, [...supportZones, ...resistanceZones], revUpVal, revDownVal)
  const maxVol = Math.max(...data.map(d => d.volume ?? 0))
  const xCfg = getXAxisConfig(data.length)

  const revUpNear = reversalUp && Math.abs(reversalUp.value - price) / price < 0.05
  const revDownNear = reversalDown && Math.abs(reversalDown.value - price) / price < 0.05
  const fairMid = fairValue?.mid
  const showFairLine = fairMid != null && fairMid > 0 && fairMid > yMin && fairMid < yMax

  // Labels
  const labelEntries: LabelEntry[] = [{ value: price, priority: 0, text: `$${price.toFixed(2)}`, bgColor: '#4f46e5' }]
  if (reversalUp && reversalUp.value > yMin && reversalUp.value < yMax) labelEntries.push({ value: reversalUp.value, priority: 1, text: lang === 'zh' ? '上方反转' : 'Rev Up', bgColor: '#059669' })
  if (reversalDown && reversalDown.value > yMin && reversalDown.value < yMax) labelEntries.push({ value: reversalDown.value, priority: 2, text: lang === 'zh' ? '下方反转' : 'Rev Down', bgColor: '#dc2626' })
  if (resistanceZones.length > 0) labelEntries.push({ value: resistanceZones[0].center, priority: 3, text: `R $${resistanceZones[0].center.toFixed(0)}`, bgColor: '#ef4444cc' })
  if (supportZones.length > 0) labelEntries.push({ value: supportZones[0].center, priority: 4, text: `S $${supportZones[0].center.toFixed(0)}`, bgColor: '#10b981cc' })
  const resolvedLabels = resolveLabels(labelEntries, yMin, yMax)
  const badge = marketStateBadge(chart.market_state, lang)

  return (
    <div className="bg-v2-surface border border-v2-border rounded-v2-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{lang === 'zh' ? '技术图表' : 'Chart'}</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.color + '33' }}>{badge.text}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 tnum">{data.length} {lang === 'zh' ? '根' : 'bars'}</span>
          {!isDefaultView && (
            <button onClick={resetView} className="text-[11px] text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-md bg-slate-50 hover:bg-slate-100 cursor-pointer border border-slate-200"
              style={{ transition: 'all 140ms ease-out' }}>{lang === 'zh' ? '重置视图' : 'Reset View'}</button>
          )}
        </div>
      </div>

      {/* Date range */}
      <div className="text-[10px] text-slate-400 mb-1 tnum">{data[0]?.date} — {data[data.length - 1]?.date}</div>

      {/* Chart */}
      <div ref={chartRef}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave}
        style={{ cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={data} margin={{ top: 10, right: 85, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tickFormatter={xCfg.fmt} tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false} axisLine={false} interval={xCfg.interval} minTickGap={40} />
            <YAxis yAxisId="price" domain={[yMin, yMax]} tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={55} />
            <YAxis yAxisId="volume" orientation="right" domain={[0, maxVol * 6]} hide />

            {/* Tooltip — no zone hover, clean price-only tooltip */}
            <Tooltip
              cursor={{ stroke: 'rgba(148,163,184,0.3)', strokeWidth: 1 }}
              wrapperStyle={{ pointerEvents: 'none', transition: 'opacity 100ms ease-out' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload
                if (!d) return null
                return (
                  <div className="bg-white border border-slate-200 rounded-lg shadow-md p-2.5 text-xs min-w-[140px]">
                    <div className="font-medium text-slate-500 mb-1">{xCfg.fmt(String(label ?? ''))}</div>
                    <div className="tabular-nums text-slate-800 font-semibold">{fmtPrice(d.close)}</div>
                    {d.volume > 0 && <div className="text-slate-400 mt-0.5">{(d.volume / 1e6).toFixed(1)}M vol</div>}
                  </div>
                )
              }}
            />

            {/* LAYER 1: S/R Zones — pure translucent bands, NO hover events, NO stroke */}
            {supportZones.map((z, i) => {
              const s = zoneStyle(z, true)
              return <ReferenceArea key={`s-${i}`} yAxisId="price" y1={z.lower} y2={z.upper}
                fill={s.color} fillOpacity={s.fillOpacity} stroke="none" ifOverflow="hidden" />
            })}
            {resistanceZones.map((z, i) => {
              const s = zoneStyle(z, false)
              return <ReferenceArea key={`r-${i}`} yAxisId="price" y1={z.lower} y2={z.upper}
                fill={s.color} fillOpacity={s.fillOpacity} stroke="none" ifOverflow="hidden" />
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
              strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />

            {/* LAYER 4: Volume */}
            <Bar dataKey="volume" yAxisId="volume" isAnimationActive={false} barSize={2} opacity={0.12}>
              {data.map((d, i) => <Cell key={i} fill={d.bullish ? '#10b981' : '#ef4444'} />)}
            </Bar>

            {/* LAYER 5: Current Price — ABOVE zones */}
            <ReferenceLine yAxisId="price" y={price} stroke="#4f46e5" strokeWidth={1.5} strokeDasharray="4 4"
              label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 0)?.text ?? `$${price.toFixed(2)}`}
                bgColor="#4f46e5" offset={resolvedLabels.find(l => l.priority === 0)?.offset ?? 0} />} />

            {/* LAYER 6: Reversal Lines — highest visual layer, distinct from zones */}
            {reversalUp && reversalUp.value > yMin && reversalUp.value < yMax && (
              <ReferenceLine yAxisId="price" y={reversalUp.value}
                stroke="#059669" strokeWidth={revUpNear ? 2.5 : 1.5}
                strokeDasharray={revUpNear ? '4 2' : '8 4'}
                label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 1)?.text ?? 'Rev Up'}
                  bgColor="#059669" offset={resolvedLabels.find(l => l.priority === 1)?.offset ?? 0} />} />
            )}
            {reversalDown && reversalDown.value > yMin && reversalDown.value < yMax && (
              <ReferenceLine yAxisId="price" y={reversalDown.value}
                stroke="#dc2626" strokeWidth={revDownNear ? 2.5 : 1.5}
                strokeDasharray={revDownNear ? '4 2' : '8 4'}
                label={<RightEdgeLabel value={resolvedLabels.find(l => l.priority === 2)?.text ?? 'Rev Down'}
                  bgColor="#dc2626" offset={resolvedLabels.find(l => l.priority === 2)?.offset ?? 0} />} />
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
        <span className="flex items-center gap-1"><span className="w-3 h-[3px] inline-block rounded" style={{ background: '#1f2937' }} />{lang === 'zh' ? '收盘价' : 'Price'}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded opacity-40" style={{ background: '#94a3b8' }} />SMA 30</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded opacity-60" style={{ background: '#f97316' }} />SMA 100</span>
        <span className="flex items-center gap-1"><span className="w-3 h-[2px] inline-block rounded opacity-70" style={{ background: '#4f46e5' }} />SMA 200</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#10b981', opacity: 0.4 }} />{lang === 'zh' ? '支撑' : 'Support'}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm" style={{ background: '#ef4444', opacity: 0.4 }} />{lang === 'zh' ? '压力' : 'Resistance'}</span>
        <span className="text-[10px] text-slate-300 ml-auto">{lang === 'zh' ? '拖拽平移 · 滚轮缩放' : 'Drag to pan · Scroll to zoom'}</span>
      </div>
    </div>
  )
}
