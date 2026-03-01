/**
 * PnlChart — Real-time intraday P&L curve (Phase 7f)
 *
 * Recharts AreaChart with:
 *   - NLV time-series line
 *   - ReferenceLine at prev_close_nlv (dashed)
 *   - linearGradient fill: green above / red below reference
 *   - isAnimationActive={false} for smooth high-frequency updates
 *   - Header: current NLV + Day P&L $ + Day P&L %
 */
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { useLanguage } from '@/context/LanguageContext'
import { fmtUSD, fmtUSDSigned, signClass } from '@/utils/format'
import type { PnlDataPoint } from '@/types'

interface PnlChartProps {
  series: PnlDataPoint[]
  prevCloseNlv: string | null
  dayPnlPct: string | null
  currentNlv: string | null
  currentPnl: string | null
}

interface ChartPoint {
  time: string
  nlv: number
  pnl: number
}

export default function PnlChart({
  series, prevCloseNlv, dayPnlPct, currentNlv, currentPnl,
}: PnlChartProps) {
  const { t } = useLanguage()

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!series.length) {
    return (
      <div className="bg-card border border-line rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-2">{t('pnl_title')}</h2>
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
          {t('pnl_no_data')}
        </div>
      </div>
    )
  }

  // ── Transform data ─────────────────────────────────────────────────────────
  const data: ChartPoint[] = series.map(p => ({
    time: p.t.slice(0, 5),  // "HH:MM:SS" → "HH:MM"
    nlv: parseFloat(p.nlv),
    pnl: parseFloat(p.pnl),
  }))

  const prevClose = prevCloseNlv ? parseFloat(prevCloseNlv) : null

  // Compute Y-axis domain with padding
  const nlvValues = data.map(d => d.nlv)
  if (prevClose != null) nlvValues.push(prevClose)
  const yMin = Math.min(...nlvValues)
  const yMax = Math.max(...nlvValues)
  const yPad = Math.max((yMax - yMin) * 0.15, 10)

  // ── Gradient offset: where NLV crosses prev_close ─────────────────────────
  // offset = fraction from TOP where the reference line sits in the Y range
  const gradientOffset = (() => {
    if (prevClose == null) return 0.5
    const domainMin = yMin - yPad
    const domainMax = yMax + yPad
    const range = domainMax - domainMin
    if (range <= 0) return 0.5
    // offset from top: (max - ref) / range
    return Math.max(0, Math.min(1, (domainMax - prevClose) / range))
  })()

  // ── Header values ──────────────────────────────────────────────────────────
  const pnlPctNum = dayPnlPct ? parseFloat(dayPnlPct) : 0
  const pnlPctStr = dayPnlPct
    ? `${pnlPctNum >= 0 ? '+' : ''}${pnlPctNum.toFixed(2)}%`
    : '—'

  return (
    <div className="bg-card border border-line rounded-lg p-6 mb-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-200">{t('pnl_title')}</h2>
          <div className="flex items-baseline gap-4 mt-1">
            <span className="text-2xl font-bold text-slate-100">
              {fmtUSD(currentNlv)}
            </span>
            <span className={`text-sm font-medium ${signClass(currentPnl)}`}>
              {fmtUSDSigned(currentPnl)}
            </span>
            <span className={`text-xs font-mono ${signClass(currentPnl)}`}>
              {pnlPctStr}
            </span>
          </div>
        </div>
        {prevClose != null && (
          <div className="text-right text-xs text-slate-500">
            <span>{t('pnl_prev_close')}: </span>
            <span className="text-slate-400">{fmtUSD(prevCloseNlv)}</span>
          </div>
        )}
      </div>

      {/* ── Chart ───────────────────────────────────────────────────────────── */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="#22c55e" stopOpacity={0.35} />
              <stop offset={gradientOffset} stopColor="#22c55e" stopOpacity={0.08} />
              <stop offset={gradientOffset} stopColor="#ef4444" stopOpacity={0.08} />
              <stop offset={1} stopColor="#ef4444" stopOpacity={0.35} />
            </linearGradient>
            <linearGradient id="pnlStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="#4ade80" stopOpacity={1} />
              <stop offset={gradientOffset} stopColor="#4ade80" stopOpacity={1} />
              <stop offset={gradientOffset} stopColor="#f87171" stopOpacity={1} />
              <stop offset={1} stopColor="#f87171" stopOpacity={1} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />

          <XAxis
            dataKey="time"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: '#475569' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />

          <YAxis
            domain={[yMin - yPad, yMax + yPad]}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
            width={65}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value: number, name: string) => {
              if (name === 'nlv') return [fmtUSD(value), t('pnl_nlv')]
              return [fmtUSDSigned(value), t('pnl_unrealized')]
            }}
            labelFormatter={(label: string) => `${t('pnl_time')}: ${label}`}
          />

          {prevClose != null && (
            <ReferenceLine
              y={prevClose}
              stroke="#64748b"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: t('pnl_prev_close'),
                position: 'right',
                fill: '#64748b',
                fontSize: 10,
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey="nlv"
            stroke="url(#pnlStroke)"
            strokeWidth={2}
            fill="url(#pnlGradient)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: '#e2e8f0', stroke: '#475569', strokeWidth: 1 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
