/**
 * PortfolioHistoryChart — 30-day NLV equity curve.
 *
 * Tooltip: Full value + absolute daily change (NO percentage).
 * X-axis: Dates (Mar 10, Mar 11).
 * All numbers tnum-aligned.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fetchPortfolioHistory } from '@/api/holdings'
import { useLanguage } from '@/context/LanguageContext'
import type { PortfolioHistoryPoint } from '@/types'

/** Full currency — NEVER abbreviated in tooltips */
function fmtFull(val: number): string {
  if (!val || isNaN(val)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val)
}

/** Signed full currency with explicit +/- */
function fmtFullSigned(val: number): string {
  if (!val || isNaN(val)) return '$0'
  const abs = Math.abs(val)
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(abs)
  return val >= 0 ? `+${formatted}` : `-${formatted}`
}

function fmtDate(iso: string): string {
  const parts = iso?.split('-') ?? []
  if (parts.length < 3) return iso ?? ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

interface ChartDatum { date: string; nlv: number; change: number | null }

function ChartTooltipInner({ active, payload, label, changeLabel }: {
  active?: boolean; payload?: Array<{ payload: ChartDatum }>; label?: string; changeLabel: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload

  const changeColor = d.change != null
    ? d.change > 0 ? 'text-emerald-600' : d.change < 0 ? 'text-rose-500' : 'text-stone-500'
    : ''

  return (
    <div className="rounded-v2-md px-3.5 py-2.5 tnum" style={{ backgroundColor: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.06)', minWidth: '140px' }}>
      <div className="text-stone-400 mb-1" style={{ fontSize: '10px' }}>
        {label}
      </div>
      <div className="text-stone-800 font-medium" style={{ fontSize: '14px' }}>
        {fmtFull(d.nlv)}
      </div>
      {d.change != null && (
        <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
          <div className="text-stone-400 mb-0.5" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {changeLabel}
          </div>
          <div className={`font-medium ${changeColor}`} style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
            {fmtFullSigned(d.change)}
          </div>
        </div>
      )}
    </div>
  )
}

interface Props { portfolioId?: number | null }

export default function PortfolioHistoryChart({ portfolioId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [points,  setPoints]  = useState<PortfolioHistoryPoint[]>([])
  const [error,   setError]   = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchPortfolioHistory(portfolioId, 30)
      .then((r) => setPoints(r.series))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [portfolioId])

  // Memoize — absolute change only, no percentage
  const chartData = useMemo<ChartDatum[]>(() =>
    points.map((p, i) => {
      const nlv = parseFloat(p.nlv)
      const prevNlv = i > 0 ? parseFloat(points[i - 1].nlv) : null
      const change = prevNlv != null ? nlv - prevNlv : null
      return { date: fmtDate(p.date), nlv, change }
    }),
    [points],
  )

  const isPos = useMemo(() => {
    if (chartData.length < 2) return true
    return chartData[chartData.length - 1].nlv >= chartData[0].nlv
  }, [chartData])

  const strokeColor = isPos ? '#4a9a6b' : '#c05c56'
  const changeLabel = t('daily_change')

  if (loading) {
    return <div className="h-44 bg-v2-surface-alt rounded-v2-lg ds-shimmer" />
  }

  if (error || chartData.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-stone-400 text-xs">
        No chart data available
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="histNlvGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.08} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="date"
            tick={{ fill: '#a8a29e', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={Math.max(0, Math.floor(chartData.length / 6))}
          />

          <Tooltip content={<ChartTooltipInner changeLabel={changeLabel} />} />

          <Area
            type="monotone"
            dataKey="nlv"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill="url(#histNlvGrad)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: strokeColor }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
