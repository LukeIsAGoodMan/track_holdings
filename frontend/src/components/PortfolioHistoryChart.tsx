/**
 * PortfolioHistoryChart — Portfolio PnL curve.
 *
 * Displays cumulative profit/loss with Economic Start Date trimming.
 * Series begins at portfolio's first economic activity — no flat zero padding.
 * PnL starts at ~0 when positions are first opened.
 * No step jumps from capital deployment.
 *
 * Accounting Methodology: Weighted-Average Cost Basis.
 *
 * Tooltip: Signed PnL value + absolute daily change.
 * X-axis: Dates (Mar 10, Mar 11).
 * Color: green when PnL > 0, red when PnL < 0.
 * All numbers tnum-aligned.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, ReferenceLine, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fetchPortfolioHistory } from '@/api/holdings'
import { useLanguage } from '@/context/LanguageContext'
import type { PortfolioHistoryPoint } from '@/types'

/** Signed full currency — always shows +/- for PnL */
function fmtPnl(val: number): string {
  if (isNaN(val)) return '$0'
  const abs = Math.abs(val)
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(abs)
  if (val > 0) return `+${formatted}`
  if (val < 0) return `-${formatted}`
  return '$0'
}

function fmtDate(iso: string): string {
  const parts = iso?.split('-') ?? []
  if (parts.length < 3) return iso ?? ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

interface ChartDatum { date: string; pnl: number; change: number | null }

function ChartTooltipInner({ active, payload, label, changeLabel, pnlLabel }: {
  active?: boolean; payload?: Array<{ payload: ChartDatum }>; label?: string
  changeLabel: string; pnlLabel: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload

  const pnlColor = d.pnl > 0 ? 'text-emerald-600' : d.pnl < 0 ? 'text-rose-500' : 'text-stone-600'
  const changeColor = d.change != null
    ? d.change > 0 ? 'text-emerald-600' : d.change < 0 ? 'text-rose-500' : 'text-stone-500'
    : ''

  return (
    <div className="rounded-v2-md px-3.5 py-2.5 tnum" style={{ backgroundColor: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.06)', minWidth: '140px' }}>
      <div className="text-stone-400 mb-1" style={{ fontSize: '10px' }}>
        {label}
      </div>
      <div className="text-stone-400 mb-0.5" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {pnlLabel}
      </div>
      <div className={`font-medium ${pnlColor}`} style={{ fontSize: '14px' }}>
        {fmtPnl(d.pnl)}
      </div>
      {d.change != null && (
        <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
          <div className="text-stone-400 mb-0.5" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {changeLabel}
          </div>
          <div className={`font-medium ${changeColor}`} style={{ fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
            {fmtPnl(d.change)}
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

  const chartData = useMemo<ChartDatum[]>(() =>
    points.map((p, i) => {
      const pnl = parseFloat(p.pnl)
      const prevPnl = i > 0 ? parseFloat(points[i - 1].pnl) : null
      const change = prevPnl != null ? pnl - prevPnl : null
      return { date: fmtDate(p.date), pnl, change }
    }),
    [points],
  )

  // Green if latest PnL > 0, red if < 0
  const isPos = useMemo(() => {
    if (chartData.length === 0) return true
    return chartData[chartData.length - 1].pnl >= 0
  }, [chartData])

  // Check if series crosses zero — needs split gradient
  const hasNeg = useMemo(() => chartData.some(d => d.pnl < 0), [chartData])
  const hasPos = useMemo(() => chartData.some(d => d.pnl > 0), [chartData])

  const strokeColor = isPos ? '#4a9a6b' : '#c05c56'
  const changeLabel = t('daily_change')
  const pnlLabel = t('total_pnl')

  if (loading) {
    return <div className="h-44 bg-v2-surface-alt rounded-v2-lg ds-shimmer" />
  }

  if (error || chartData.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-stone-400 text-xs">
        {t('no_chart_data')}
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 16, bottom: 0 }}>
          <defs>
            <linearGradient id="histPnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.08} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="date"
            tick={{ fill: '#a8a29e', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            interval={Math.max(0, Math.floor(chartData.length / 6))}
          />

          <YAxis hide domain={['auto', 'auto']} />

          {/* Zero reference line — subtle baseline when PnL crosses zero */}
          {hasNeg && hasPos && (
            <ReferenceLine y={0} stroke="#d6d3d1" strokeWidth={0.5} strokeDasharray="3 3" />
          )}

          <Tooltip content={<ChartTooltipInner changeLabel={changeLabel} pnlLabel={pnlLabel} />} />

          <Area
            type="monotone"
            dataKey="pnl"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill="url(#histPnlGrad)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: strokeColor }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
