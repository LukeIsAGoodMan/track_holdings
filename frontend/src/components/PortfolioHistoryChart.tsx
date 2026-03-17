/**
 * PortfolioHistoryChart — 30-day portfolio NLV equity curve (light theme)
 */
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Brush, CartesianGrid,
} from 'recharts'
import { fetchPortfolioHistory } from '@/api/holdings'
import { useLanguage } from '@/context/LanguageContext'
import type { PortfolioHistoryPoint } from '@/types'

function fmtDate(iso: string): string {
  const parts = iso?.split('-') ?? []
  if (parts.length < 3) return iso ?? ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? 'N/A'} ${parseInt(parts[2])}`
}

function fmtNlv(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (!isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

// ── Custom tooltip (light theme) ──────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-400 mb-0.5">{label}</div>
      <div className="text-slate-900 font-bold tabular-nums">{fmtNlv(payload[0].value)}</div>
    </div>
  )
}

interface Props { portfolioId?: number | null }

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
      .then((r) => { setPoints(r.series); setReturnPct(r.return_pct) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [portfolioId])

  const chartData = useMemo(() =>
    points.map((p) => ({ date: fmtDate(p.date), nlv: parseFloat(p.nlv) })),
    [points],
  )

  const returnNum    = returnPct != null ? parseFloat(returnPct) : null
  const isPos        = returnNum != null && returnNum >= 0
  const strokeColor  = isPos ? '#059669' : '#e11d48'
  const gradientStop = isPos ? '#059669' : '#e11d48'
  const returnColor  = isPos ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-rose-600 bg-rose-50 border-rose-200'

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-40 bg-slate-100 rounded" />
          <div className="h-5 w-16 bg-slate-100 rounded-full" />
        </div>
        <div className="h-36 bg-slate-50 rounded-xl" />
      </div>
    )
  }

  if (error || chartData.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-6 text-center text-slate-400 text-xs">
        {t('hist_no_data')}
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('hist_title')}
        </span>
        {returnNum != null && (
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${returnColor}`}>
            {isPos ? '▲' : '▼'} {isPos ? '+' : ''}{returnNum.toFixed(2)}%
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="histNlvGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={gradientStop} stopOpacity={0.15} />
              <stop offset="95%" stopColor={gradientStop} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickLine={false} axisLine={false}
            interval={Math.floor(chartData.length / 5)}
          />

          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            width={46} domain={['auto', 'auto']}
          />

          <Tooltip content={<ChartTooltip />} />

          <Area
            type="monotone" dataKey="nlv"
            stroke={strokeColor} strokeWidth={2}
            fill="url(#histNlvGrad)"
            dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: strokeColor }}
            isAnimationActive={false}
          />

          {chartData.length > 10 && (
            <Brush
              dataKey="date" height={18}
              stroke="#e2e8f0" fill="#f8fafc"
              travellerWidth={6}
              startIndex={Math.max(0, chartData.length - 20)}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
