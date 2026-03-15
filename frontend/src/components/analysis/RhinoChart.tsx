/**
 * Rhino chart — Recharts OHLC visualization with SMA200 overlay,
 * support/resistance zone bands, and a synced zone detail panel.
 *
 * Candles: custom Bar shape rendering body + wick in a single pass.
 * Zones: ReferenceArea bands (no native tooltip) → zone legend below chart.
 */
import { useState, useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ReferenceArea,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { AnalysisChart, AnalysisPriceZone } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice } from '@/utils/format'

interface Props {
  chart: AnalysisChart
  /** @deprecated pass via chart.current_price instead */
  price?: number
}

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
      {/* Wick */}
      <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
      {/* Body */}
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

/* ── Zone detail row ────────────────────────────────────────────────────── */

function strengthLabel(s: number, lang: string): string {
  if (s >= 0.7) return lang === 'zh' ? '强' : 'Strong'
  if (s >= 0.4) return lang === 'zh' ? '中' : 'Medium'
  return lang === 'zh' ? '弱' : 'Weak'
}

function ZoneRow({ zone, type, lang }: { zone: AnalysisPriceZone; type: 'support' | 'resistance'; lang: string }) {
  const isSupport = type === 'support'
  const color = isSupport
    ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
    : 'text-rose-700 bg-rose-50 border-rose-100'
  const label = isSupport
    ? (lang === 'zh' ? '支撑' : 'S')
    : (lang === 'zh' ? '阻力' : 'R')
  const sLabel = strengthLabel(zone.strength, lang)

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium tabular-nums ${color}`}>
      <span className="font-semibold">{label}</span>
      {fmtPrice(zone.lower)} – {fmtPrice(zone.upper)}
      <span className={`text-[10px] ${zone.strength >= 0.7 ? 'opacity-90 font-semibold' : 'opacity-60'}`}>
        {sLabel}
      </span>
    </div>
  )
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function RhinoChart({ chart, price: priceProp }: Props) {
  const price = chart.current_price ?? priceProp ?? 0
  const { lang, t } = useLanguage()
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  const data = useMemo(() => {
    const smaMap = new Map(chart.sma200.map((s) => [s.date, s.value]))
    return chart.candles.map((c) => ({
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      sma200: smaMap.get(c.date) ?? null,
      // placeholder field for Bar (actual rendering via custom shape)
      _candle: c.high,
      bullish: c.close >= c.open,
    }))
  }, [chart])

  // Find nearest zone to crosshair price
  const nearestZone = useMemo(() => {
    if (activeIdx == null || activeIdx < 0 || activeIdx >= data.length) return null
    const curPrice = data[activeIdx].close
    const allZones = [
      ...chart.support_zones.map((z) => ({ ...z, type: 'support' as const })),
      ...chart.resistance_zones.map((z) => ({ ...z, type: 'resistance' as const })),
    ]
    let best: (typeof allZones)[number] | null = null
    let bestDist = Infinity
    for (const z of allZones) {
      const dist = Math.abs(curPrice - z.center)
      if (dist < bestDist) { bestDist = dist; best = z }
    }
    return best
  }, [activeIdx, data, chart.support_zones, chart.resistance_zones])

  const handleMouseMove = useCallback((state: { activeTooltipIndex?: number }) => {
    if (state?.activeTooltipIndex != null) setActiveIdx(state.activeTooltipIndex)
  }, [])

  const handleMouseLeave = useCallback(() => setActiveIdx(null), [])

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

  const supportZones = chart.support_zones.slice(0, 5)
  const resistanceZones = chart.resistance_zones.slice(0, 5)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">
        {t('analysis_chart')}
      </h3>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
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
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              fontSize: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            formatter={(value: number, name: string) => {
              if (name === 'sma200') return [fmtPrice(value), 'SMA 200']
              if (name === '_candle') return [null, null]
              return [fmtPrice(value), name]
            }}
            labelFormatter={formatDate}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              return (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs">
                  <div className="font-semibold text-slate-600 mb-1">{formatDate(label)}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-700">
                    <span className="text-slate-400">O</span><span>{fmtPrice(d.open)}</span>
                    <span className="text-slate-400">H</span><span>{fmtPrice(d.high)}</span>
                    <span className="text-slate-400">L</span><span>{fmtPrice(d.low)}</span>
                    <span className="text-slate-400">C</span><span className={d.bullish ? 'text-emerald-600' : 'text-rose-600'}>{fmtPrice(d.close)}</span>
                    {d.sma200 != null && (
                      <><span className="text-amber-500">SMA</span><span>{fmtPrice(d.sma200)}</span></>
                    )}
                  </div>
                  {nearestZone && (
                    <div className={`mt-1.5 pt-1.5 border-t border-slate-100 text-[10px] ${
                      nearestZone.type === 'support' ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {nearestZone.type === 'support' ? (lang === 'zh' ? '最近支撑' : 'Nearest support') : (lang === 'zh' ? '最近阻力' : 'Nearest resistance')}:
                      {' '}{fmtPrice(nearestZone.lower)} – {fmtPrice(nearestZone.upper)}
                    </div>
                  )}
                </div>
              )
            }}
          />

          {/* Support zones — opacity scales with strength */}
          {supportZones.map((z, i) => {
            const opacity = 0.06 + z.strength * 0.18
            return (
              <ReferenceArea
                key={`s-${i}`}
                yAxisId="price"
                y1={z.lower}
                y2={z.upper}
                fill="#10b981"
                fillOpacity={opacity}
                stroke="#10b981"
                strokeOpacity={opacity + 0.1}
                strokeDasharray="3 3"
              />
            )
          })}

          {/* Resistance zones — opacity scales with strength */}
          {resistanceZones.map((z, i) => {
            const opacity = 0.06 + z.strength * 0.18
            return (
              <ReferenceArea
                key={`r-${i}`}
                yAxisId="price"
                y1={z.lower}
                y2={z.upper}
                fill="#ef4444"
                fillOpacity={opacity}
                stroke="#ef4444"
                strokeOpacity={opacity + 0.1}
                strokeDasharray="3 3"
              />
            )
          })}

          {/* Current price line with label */}
          <ReferenceLine
            yAxisId="price"
            y={price}
            stroke="#6366f1"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{
              value: `$${price.toFixed(2)}`,
              position: 'right',
              fill: '#6366f1',
              fontSize: 10,
              fontWeight: 600,
            }}
          />

          {/* Candle bodies via custom shape */}
          <Bar
            dataKey="_candle"
            yAxisId="price"
            isAnimationActive={false}
            barSize={6}
            shape={<CandleShape />}
          />

          {/* SMA200 line */}
          <Line
            dataKey="sma200"
            yAxisId="price"
            type="monotone"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-amber-500 inline-block rounded" /> SMA 200
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-indigo-500 inline-block rounded" style={{ borderTop: '1px dashed #6366f1' }} /> {lang === 'zh' ? '当前价' : 'Current'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-emerald-500/20 inline-block rounded border border-emerald-500/30" /> {lang === 'zh' ? '支撑' : 'Support'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-rose-500/20 inline-block rounded border border-rose-500/30" /> {lang === 'zh' ? '阻力' : 'Resistance'}
        </span>
      </div>

      {/* Zone detail panel — exposes lower/upper/strength for each zone */}
      {(supportZones.length > 0 || resistanceZones.length > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-1.5">
            {lang === 'zh' ? '关键价格区域' : 'Key Price Zones'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {supportZones.map((z, i) => (
              <ZoneRow key={`s-${i}`} zone={z} type="support" lang={lang} />
            ))}
            {resistanceZones.map((z, i) => (
              <ZoneRow key={`r-${i}`} zone={z} type="resistance" lang={lang} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
