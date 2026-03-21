/**
 * PortfolioHistoryChart — Minimal equity curve.
 *
 * Pure signal: smooth curve, no axes, no labels, no grid, no brush.
 * Only extremely subtle horizontal reference lines (opacity < 0.1).
 * Feels like a data surface, not a financial chart.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fetchPortfolioHistory } from '@/api/holdings'
import type { PortfolioHistoryPoint } from '@/types'

function fmtNlv(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (!isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(iso: string): string {
  const parts = iso?.split('-') ?? []
  if (parts.length < 3) return iso ?? ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-v2-surface border border-v2-border rounded-v2-md px-3 py-2 text-xs">
      <div className="text-v2-text-3 mb-0.5">{label}</div>
      <div className="text-v2-text-1 font-medium tnum">{fmtNlv(payload[0].value)}</div>
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

  const chartData = useMemo(() =>
    points.map((p) => ({ date: fmtDate(p.date), nlv: parseFloat(p.nlv) })),
    [points],
  )

  const isPos = useMemo(() => {
    if (chartData.length < 2) return true
    return chartData[chartData.length - 1].nlv >= chartData[0].nlv
  }, [chartData])

  const strokeColor = isPos ? '#4a9a6b' : '#c05c56'

  if (loading) {
    return <div className="h-40 bg-v2-surface-alt rounded-v2-lg ds-shimmer" />
  }

  if (error || chartData.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-v2-text-3 text-xs">
        No chart data available
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="histNlvGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.08} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Pure curve — no grid, no axes, just signal */}
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
