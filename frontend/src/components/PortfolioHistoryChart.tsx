/**
 * PortfolioHistoryChart — 30-day NLV equity curve with date axis.
 *
 * Features:
 *   - Smooth monotone curve
 *   - X-axis: dates (Mar 10, Mar 11 etc.) — light, recessive
 *   - Tooltip: Date | $Value | (+$change, +X.X%)
 *   - No Y-axis, no grid, no brush
 */
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fetchPortfolioHistory } from '@/api/holdings'
import type { PortfolioHistoryPoint } from '@/types'

function fmtNlv(val: number): string {
  if (!isFinite(val)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val)
}

function fmtDate(iso: string): string {
  const parts = iso?.split('-') ?? []
  if (parts.length < 3) return iso ?? ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

interface ChartDatum { date: string; nlv: number; prevNlv: number | null }

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ payload: ChartDatum }>; label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const change = d.prevNlv != null ? d.nlv - d.prevNlv : null
  const changePct = d.prevNlv != null && d.prevNlv !== 0 ? ((d.nlv - d.prevNlv) / d.prevNlv) * 100 : null

  return (
    <div className="rounded-v2-md px-3 py-2 text-xs" style={{ backgroundColor: 'rgba(255,255,255,0.94)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="text-stone-500 mb-0.5">{label}</div>
      <div className="text-stone-800 font-medium tnum">{fmtNlv(d.nlv)}</div>
      {change != null && changePct != null && (
        <div className={`tnum mt-0.5 ${change >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
          {change >= 0 ? '+' : ''}{fmtNlv(change)} ({change >= 0 ? '+' : ''}{changePct.toFixed(1)}%)
        </div>
      )}
    </div>
  )
}

interface Props { portfolioId?: number | null }

export default function PortfolioHistoryChart({ portfolioId }: Props) {
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

  const chartData = useMemo<ChartDatum[]>(() =>
    points.map((p, i) => ({
      date: fmtDate(p.date),
      nlv: parseFloat(p.nlv),
      prevNlv: i > 0 ? parseFloat(points[i - 1].nlv) : null,
    })),
    [points],
  )

  const isPos = useMemo(() => {
    if (chartData.length < 2) return true
    return chartData[chartData.length - 1].nlv >= chartData[0].nlv
  }, [chartData])

  const strokeColor = isPos ? '#4a9a6b' : '#c05c56'

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

          <Tooltip content={<ChartTooltip />} />

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
