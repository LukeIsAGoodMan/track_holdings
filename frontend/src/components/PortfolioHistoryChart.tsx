/**
 * PortfolioHistoryChart — 30-day interactive portfolio NLV equity curve.
 *
 * Replaces the intraday PnlChart with a longer-horizon historical view.
 * Uses current holdings applied to historical EOD prices from the backend.
 *
 * Features:
 *  - 30-day area chart (Recharts AreaChart)
 *  - Brush component for zoom / pan
 *  - Hover tooltip with formatted NLV
 *  - Return % badge (green/red) in header
 *  - Graceful loading skeleton + empty state
 */
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
  CartesianGrid,
} from 'recharts'
import { fetchPortfolioHistory } from '@/api/holdings'
import { useLanguage } from '@/context/LanguageContext'
import type { PortfolioHistoryPoint } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  // "2024-01-15" → "Jan 15"
  const [, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`
}

function fmtNlv(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (!isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-400 mb-0.5">{label}</div>
      <div className="text-white font-semibold tabular-nums">
        {fmtNlv(payload[0].value)}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  portfolioId?: number | null
}

export default function PortfolioHistoryChart({ portfolioId }: Props) {
  const { t } = useLanguage()

  const [loading,   setLoading]   = useState(true)
  const [points,    setPoints]    = useState<PortfolioHistoryPoint[]>([])
  const [returnPct, setReturnPct] = useState<string | null>(null)
  const [error,     setError]     = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchPortfolioHistory(portfolioId, 30)
      .then((r) => {
        setPoints(r.series)
        setReturnPct(r.return_pct)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [portfolioId])

  // Convert to chart-friendly format (nlv as number)
  const chartData = useMemo(() =>
    points.map((p) => ({
      date:  fmtDate(p.date),
      nlv:   parseFloat(p.nlv),
    })),
    [points],
  )

  const returnNum   = returnPct != null ? parseFloat(returnPct) : null
  const isPositive  = returnNum != null && returnNum >= 0
  const returnColor = isPositive ? 'text-emerald-400' : 'text-red-400'
  const returnBg    = isPositive ? 'bg-emerald-500/10' : 'bg-red-500/10'
  const returnBorder = isPositive ? 'border-emerald-500/20' : 'border-red-500/20'

  // Gradient ID (unique per instance avoids SVG conflicts)
  const gradientId = 'histNlvGrad'

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-card border border-line rounded-xl p-4 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-40 bg-slate-700 rounded" />
          <div className="h-5 w-16 bg-slate-700 rounded-full" />
        </div>
        <div className="h-36 bg-slate-800/60 rounded-lg" />
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (error || chartData.length === 0) {
    return (
      <div className="bg-card border border-line rounded-xl px-4 py-6 text-center text-slate-500 text-xs">
        {t('hist_no_data')}
      </div>
    )
  }

  return (
    <div className="bg-card border border-line rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {t('hist_title')}
        </span>
        {returnNum != null && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border
            ${returnBg} ${returnColor} ${returnBorder}`}>
            {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{returnNum.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={isPositive ? '#10b981' : '#ef4444'}
                stopOpacity={0.25}
              />
              <stop
                offset="95%"
                stopColor={isPositive ? '#10b981' : '#ef4444'}
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fill: '#475569', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={Math.floor(chartData.length / 5)}
          />

          <YAxis
            tick={{ fill: '#475569', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            width={46}
            domain={['auto', 'auto']}
          />

          <Tooltip content={<ChartTooltip />} />

          <Area
            type="monotone"
            dataKey="nlv"
            stroke={isPositive ? '#10b981' : '#ef4444'}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />

          {chartData.length > 10 && (
            <Brush
              dataKey="date"
              height={18}
              stroke="#334155"
              fill="#0f172a"
              travellerWidth={6}
              startIndex={Math.max(0, chartData.length - 20)}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
