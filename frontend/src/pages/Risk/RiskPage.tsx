/**
 * Risk Dashboard Page
 *
 * · Stat cards: Net Δ, Γ, Θ/day, V, Margin
 * · Top Efficient Symbol highlight
 * · Expiry distribution bar chart (Recharts)
 * · Delta contribution bar chart by symbol
 * · Sector Exposure panel (from instrument.tags)
 * · Alpha vs Market benchmark panel (SPY / QQQ YTD)
 * · Risk Alerts panel (gamma crash warnings from backend)
 * · Stress Test / Scenario Simulation panel (client-side Taylor expansion,
 *   two sliders: Price Shift ± 20% and IV Shift ± 50 pp)
 * · Alpha Dashboard: NLV vs benchmark line chart with dynamic search
 * · i18n via useLanguage()
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
  LineChart, Line, Legend,
} from 'recharts'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { fetchRiskDashboard, fetchHoldings, fetchAccountHistory, fetchAttribution, fetchInsights } from '@/api/holdings'
import type { RiskDashboard, HoldingGroup, AccountHistoryResponse, AttributionResponse, PortfolioInsight } from '@/types'
import { fmtNum, fmtUSD, fmtGreek, signClass } from '@/utils/format'

// ── Scenario computation (pure client-side, no API call) ──────────────────────
/**
 * 2nd-order Taylor expansion:
 *   ΔPnL ≈ (Δ_exp × ΔP) + (0.5 × Γ_exp × ΔP²) + (V_exp × ΔIV_ppt)
 *
 * price_shift_pct: fractional, e.g. -0.15 for -15%
 * iv_shift_ppt:    percentage-point IV change, e.g. 20 for +20pp
 */
function computeScenarioPnL(
  holdings:      HoldingGroup[],
  priceShiftPct: number,
  ivShiftPpt:    number,
  ivSkewEnabled: boolean = false,
): { total: number; bySymbol: { symbol: string; pnl: number }[]; effectiveIvShift: number } {
  // IV Skew: on negative price moves, simulate panic vol compression.
  // Rule: for every -1% move, add +0.5 vol-point (50pp factor).
  const panicVol = ivSkewEnabled && priceShiftPct < 0
    ? Math.abs(priceShiftPct) * 50
    : 0
  const effectiveIvShift = ivShiftPpt + panicVol
  let total = 0
  const bySymbol: { symbol: string; pnl: number }[] = []

  for (const group of holdings) {
    const spot = group.spot_price != null ? parseFloat(group.spot_price) : null
    if (spot == null || spot <= 0) continue

    const deltaP = spot * priceShiftPct   // dollar change in underlying
    let symPnl = 0

    // Option legs
    for (const leg of group.option_legs) {
      if (leg.delta == null || leg.gamma == null || leg.vega == null) continue
      const n = leg.net_contracts  // signed
      const delta = parseFloat(leg.delta)
      const gamma = parseFloat(leg.gamma)
      const vega  = parseFloat(leg.vega)

      const deltaExp = n * delta * 100
      const gammaExp = n * gamma * 100   // signed: short = negative
      const vegaExp  = n * vega  * 100

      symPnl += deltaExp * deltaP
               + 0.5 * gammaExp * deltaP * deltaP
               + vegaExp * effectiveIvShift
    }

    // Stock legs (Δ=1/share, Γ=0, V=0)
    for (const leg of group.stock_legs) {
      symPnl += leg.net_shares * deltaP
    }

    bySymbol.push({ symbol: group.symbol, pnl: symPnl })
    total += symPnl
  }

  bySymbol.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
  return { total, bySymbol, effectiveIvShift }
}

// ── Alpha Dashboard colours ───────────────────────────────────────────────────
const NAMED_COLORS: Record<string, string> = {
  account: '#22c55e',   // green — always the account
  SPY:     '#38bdf8',   // sky blue
  QQQ:     '#f59e0b',   // amber
  NVDA:    '#a78bfa',   // violet
  AAPL:    '#fb923c',   // orange
  MSFT:    '#34d399',   // emerald
  'BTC-USD': '#f7931a', // bitcoin orange
}
const EXTRA_COLORS = ['#e879f9', '#60a5fa', '#4ade80', '#fbbf24', '#f87171']

function lineColor(sym: string, extras: string[]): string {
  if (NAMED_COLORS[sym]) return NAMED_COLORS[sym]
  const idx = extras.indexOf(sym)
  return EXTRA_COLORS[idx % EXTRA_COLORS.length] ?? '#94a3b8'
}

// ── Alpha Dashboard ───────────────────────────────────────────────────────────
function AlphaDashboard({
  portfolioId,
}: {
  portfolioId: number | null | undefined
}) {
  const { t } = useLanguage()

  // Benchmarks list includes both default and user-added symbols
  const DEFAULT_BM = ['SPY', 'QQQ']
  const [extraBm,    setExtraBm]    = useState<string[]>([])
  const [inputSym,   setInputSym]   = useState('')
  const [history,    setHistory]    = useState<AccountHistoryResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const allBenchmarks = useMemo(() => [...DEFAULT_BM, ...extraBm], [extraBm])

  // Fetch (or re-fetch) when portfolio or benchmark list changes
  const fetchHistory = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchAccountHistory(portfolioId, allBenchmarks)
      .then(setHistory)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [portfolioId, allBenchmarks])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Add a user-supplied benchmark symbol
  function addSymbol() {
    const sym = inputSym.trim().toUpperCase()
    if (!sym || allBenchmarks.includes(sym)) return
    setExtraBm((prev) => [...prev, sym])
    setInputSym('')
  }

  function removeExtra(sym: string) {
    setExtraBm((prev) => prev.filter((s) => s !== sym))
  }

  // ── Build Recharts data array ────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!history || history.dates.length === 0) return []
    return history.dates.map((date, i) => {
      const point: Record<string, number | string> = {
        date,
        account: parseFloat(history.account[i]?.toFixed(2) ?? '100'),
      }
      for (const [sym, vals] of Object.entries(history.benchmarks)) {
        point[sym] = parseFloat((vals[i] ?? 100).toFixed(2))
      }
      return point
    })
  }, [history])

  // All line keys: account first, then benchmarks
  const lineKeys = useMemo(() => {
    if (!history) return ['account']
    return ['account', ...Object.keys(history.benchmarks)]
  }, [history])

  // X-axis interval: show ~7 labels regardless of data density
  const xInterval = Math.max(0, Math.floor((chartData.length - 1) / 6))

  // ── Render ───────────────────────────────────────────────────────────────
  const hasHistory = history && history.dates.length > 0

  return (
    <div className="bg-card border border-line rounded-xl p-5 space-y-4">
      {/* Header + stat chips */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            {t('alpha_dashboard')}
          </span>
          {hasHistory && (
            <span className="text-[10px] text-slate-600 font-mono">
              {t('nlv_normalized')}
            </span>
          )}
        </div>

        {/* Alpha & Sharpe stats */}
        {hasHistory && (
          <div className="flex items-center gap-4 text-xs tabular-nums">
            {history.alpha_vs_spy != null && (
              <div className="text-right">
                <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">
                  {t('alpha_relative')}
                </div>
                <span className={`font-bold text-sm ${history.alpha_vs_spy >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {history.alpha_vs_spy >= 0 ? '+' : ''}{history.alpha_vs_spy.toFixed(2)} pp
                </span>
              </div>
            )}
            {history.sharpe_ratio != null && (
              <div className="text-right">
                <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">
                  {t('sharpe_ratio')}
                </div>
                <span className={`font-bold text-sm ${history.sharpe_ratio >= 1 ? 'text-bull' : history.sharpe_ratio >= 0 ? 'text-warn' : 'text-bear'}`}>
                  {history.sharpe_ratio.toFixed(2)}
                  <span className="text-[10px] font-normal text-slate-600 ml-1">{t('indicative')}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Benchmark search + pills */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Extra benchmark pills */}
        {extraBm.map((sym) => (
          <span key={sym}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]
                       font-semibold border"
            style={{ color: lineColor(sym, extraBm), borderColor: lineColor(sym, extraBm) + '60' }}
          >
            {sym}
            <button onClick={() => removeExtra(sym)} className="hover:opacity-70 transition-opacity">×</button>
          </span>
        ))}
        {/* Add input */}
        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="text"
            value={inputSym}
            onChange={(e) => setInputSym(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
            placeholder={t('benchmark_search')}
            className="w-44 bg-app border border-line rounded-md px-2.5 py-1 text-xs
                       text-slate-200 placeholder-slate-600
                       focus:outline-none focus:border-info/50 transition-colors"
          />
          <button
            onClick={addSymbol}
            disabled={!inputSym.trim()}
            className="px-3 py-1 rounded-md bg-info/20 border border-info/40 text-info
                       text-xs font-semibold hover:bg-info/30 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('add_benchmark')}
          </button>
        </div>
      </div>

      {/* Chart or state messages */}
      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-pulse h-full w-full bg-row rounded-lg" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : !hasHistory ? (
        <div className="h-32 flex items-center justify-center text-xs text-slate-600">
          {t('no_history')}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2436" />
            <XAxis
              dataKey="date"
              interval={xInterval}
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: '#10131c',
                border: '1px solid #1e2436',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e2e8f0', marginBottom: 4 }}
              itemStyle={{ color: '#94a3b8' }}
              formatter={(v: number, name: string) => [
                `${v.toFixed(2)}`,
                name === 'account' ? 'Account NLV' : name,
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value: string) => value === 'account' ? 'Account NLV' : value}
            />
            {lineKeys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={lineColor(key, extraBm)}
                strokeWidth={key === 'account' ? 2 : 1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Reference line note */}
      {hasHistory && history.first_date && (
        <p className="text-[10px] text-slate-700 text-right">
          Normalized to 100 at {history.first_date} (first trade date)
        </p>
      )}
    </div>
  )
}

// ── P&L Attribution Panel ─────────────────────────────────────────────────────
/**
 * Per-position bar chart: stacked time-decay (amber) + directional (sky-blue).
 * Positive total = profitable position. Negative directional bar hangs down from
 * the top of the theta bar (Recharts stacked bars handle signed values natively).
 */
function AttributionPanel({
  portfolioId,
}: {
  portfolioId: number | null | undefined
}) {
  const { t } = useLanguage()
  const [data,    setData]    = useState<AttributionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchAttribution(portfolioId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [portfolioId])

  // Build chart data — one entry per position item
  const chartData = data?.items.map((item) => {
    const label =
      item.instrument_type === 'OPTION' && item.strike && item.option_type
        ? `${item.symbol} ${parseFloat(item.strike).toFixed(0)}${item.option_type[0]}`
        : item.symbol
    return {
      label,
      time_decay:  parseFloat(item.time_decay_pnl),
      directional: parseFloat(item.directional_pnl),
      total:       parseFloat(item.total_unrealized),
    }
  }) ?? []

  const fmtUsdShort = (v: number) =>
    (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

  const totalDecay  = data ? parseFloat(data.total_time_decay_pnl)   : 0
  const totalDir    = data ? parseFloat(data.total_directional_pnl)  : 0
  const totalUnreal = data ? parseFloat(data.total_unrealized)        : 0

  const hasData = data && data.items.length > 0

  return (
    <div className="bg-card border border-line rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            {t('pnl_attribution')}
          </span>
          {hasData && (
            <span className="text-[10px] text-slate-600 ml-2">
              {t('attr_subtitle')}
            </span>
          )}
        </div>

        {/* Summary stat chips */}
        {hasData && (
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="text-right">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{t('attr_time_decay')}</div>
              <span className={`font-bold text-sm ${totalDecay >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                {fmtUsdShort(totalDecay)}
              </span>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{t('attr_directional')}</div>
              <span className={`font-bold text-sm ${totalDir >= 0 ? 'text-sky-400' : 'text-rose-400'}`}>
                {fmtUsdShort(totalDir)}
              </span>
            </div>
            <div className="text-right border-l border-slate-700 pl-4">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{t('attr_total')}</div>
              <span className={`font-bold text-sm ${totalUnreal >= 0 ? 'text-bull' : 'text-bear'}`}>
                {fmtUsdShort(totalUnreal)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-56 flex items-center justify-center">
          <div className="animate-pulse h-full w-full bg-row rounded-lg" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : !hasData ? (
        <div className="h-32 flex items-center justify-center text-xs text-slate-600">
          {t('attr_empty')}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2436" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) =>
                (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
              }
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: '#10131c',
                border: '1px solid #1e2436',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e2e8f0', marginBottom: 4 }}
              itemStyle={{ color: '#94a3b8' }}
              formatter={(v: number, name: string) => [
                fmtUsdShort(v),
                name === 'time_decay'  ? 'Time Decay (Theta)' :
                name === 'directional' ? 'Directional (Delta/Gamma)' : name,
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value: string) =>
                value === 'time_decay'  ? 'Time Decay (Theta)' :
                value === 'directional' ? 'Directional (Delta/Gamma)' : value
              }
            />
            {/* Stacked bars: amber (theta income) + sky-blue (directional) */}
            <Bar dataKey="time_decay"  stackId="pnl" fill="#f59e0b80" radius={[0, 0, 0, 0]} />
            <Bar dataKey="directional" stackId="pnl" fill="#38bdf880" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.directional >= 0 ? '#38bdf880' : '#ef444870'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, valueClass, highlight,
}: {
  label:       string
  value:       string
  sub?:        string
  valueClass?: string
  highlight?:  boolean
}) {
  return (
    <div className={`bg-card border rounded-xl p-4 ${highlight ? 'border-amber-500/40' : 'border-line'}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${valueClass ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </div>
  )
}

// ── Expiry bucket chart ───────────────────────────────────────────────────────
function ExpiryChart({ dashboard, label }: { dashboard: RiskDashboard; label: string }) {
  const data = dashboard.expiry_buckets.map((b) => ({
    label: b.label, contracts: Math.abs(b.net_contracts), delta: parseFloat(b.delta_exposure),
  }))
  return (
    <div className="bg-card border border-line rounded-xl p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">{label}</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2436" />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#10131c', border: '1px solid #1e2436', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0' }} itemStyle={{ color: '#94a3b8' }} />
          <Bar dataKey="contracts" name="Contracts" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.contracts > 0 ? '#ef444480' : '#22c55e80'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Delta contribution chart ──────────────────────────────────────────────────
function DeltaContribChart({ holdings, label }: { holdings: HoldingGroup[]; label: string }) {
  const data = holdings.map((g) => ({ symbol: g.symbol, delta: parseFloat(g.total_delta_exposure) }))
  return (
    <div className="bg-card border border-line rounded-xl p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">{label}</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2436" />
          <XAxis dataKey="symbol" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#10131c', border: '1px solid #1e2436', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0' }} itemStyle={{ color: '#94a3b8' }}
            formatter={(v: number) => [v.toFixed(2), 'Δ Exposure']} />
          <Bar dataKey="delta" name="Delta Exposure" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.delta >= 0 ? '#22c55e' : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Sector exposure panel ─────────────────────────────────────────────────────
function SectorExposurePanel({ sectorExp, label }: { sectorExp: Record<string, string>; label: string }) {
  const entries = Object.entries(sectorExp)
  if (entries.length === 0) return null
  const sorted  = [...entries].sort((a, b) => Math.abs(parseFloat(b[1])) - Math.abs(parseFloat(a[1])))
  const maxAbs  = Math.max(...sorted.map(([, v]) => Math.abs(parseFloat(v))), 1)

  return (
    <div className="bg-card border border-line rounded-xl p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">{label}</div>
      <div className="space-y-3">
        {sorted.map(([tag, deltaStr]) => {
          const delta = parseFloat(deltaStr)
          const pct   = (Math.abs(delta) / maxAbs) * 100
          const isLong = delta >= 0
          return (
            <div key={tag}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-300 font-medium">{tag}</span>
                <span className={`tabular-nums font-semibold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
                  {isLong ? '+' : ''}{fmtNum(deltaStr)} Δ
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div className={`h-full rounded-full ${isLong ? 'bg-green-500/60' : 'bg-red-500/60'}`}
                  style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Benchmark panel ───────────────────────────────────────────────────────────
function BenchmarkPanel({ dashboard, label, ytdLabel }: { dashboard: RiskDashboard; label: string; ytdLabel: string }) {
  if (!dashboard.benchmark_ytd?.length) return null
  return (
    <div className="bg-card border border-line rounded-xl p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">{label}</div>
      <div className="grid grid-cols-2 gap-3">
        {dashboard.benchmark_ytd.map((bench) => {
          const ytd    = bench.ytd_return != null ? parseFloat(bench.ytd_return) : null
          const pctStr = ytd != null ? (ytd * 100).toFixed(2) + '%' : '—'
          const isPos  = ytd != null && ytd >= 0
          const cls    = ytd == null ? 'text-slate-500' : isPos ? 'text-green-400' : 'text-red-400'
          return (
            <div key={bench.symbol} className="bg-row rounded-lg p-4 text-center">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{bench.symbol}</div>
              <div className={`text-2xl font-bold tabular-nums ${cls}`}>{isPos ? '+' : ''}{pctStr}</div>
              <div className="text-[10px] text-slate-600 mt-1 uppercase tracking-wider">{ytdLabel}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Risk alerts panel ─────────────────────────────────────────────────────────
function RiskAlertsPanel({ alerts, label, noAlertLabel }: {
  alerts:       string[]
  label:        string
  noAlertLabel: string
}) {
  return (
    <div className="bg-card border border-line rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-rose-400/80">{label}</span>
        {alerts.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-bold">
            {alerts.length}
          </span>
        )}
      </div>
      {alerts.length === 0 ? (
        <p className="text-xs text-slate-600">{noAlertLabel}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="text-rose-400 mt-0.5 shrink-0">⚠</span>
              <span className="text-slate-300 font-mono leading-relaxed">{alert}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── AI Coach Insights panel ───────────────────────────────────────────────────
function InsightPanel({ portfolioId }: { portfolioId: number | null | undefined }) {
  const { t } = useLanguage()
  const [data,    setData]    = useState<PortfolioInsight | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchInsights(portfolioId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [portfolioId])

  const POSTURE_COLOR: Record<string, string> = {
    short_gamma_positive_theta: 'text-amber-400',
    long_gamma_positive_theta:  'text-green-400',
    short_gamma_negative_theta: 'text-red-400',
    long_gamma_negative_theta:  'text-sky-400',
  }
  const postureColor = data ? (POSTURE_COLOR[data.risk_posture] ?? 'text-slate-300') : 'text-slate-500'

  return (
    <div className="bg-card border border-line rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          {t('insights_title')}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/30 font-semibold">
          LLM-Ready
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-3 bg-slate-800 rounded animate-pulse" />)}
        </div>
      ) : !data ? (
        <p className="text-xs text-slate-600">{t('var_no_data')}</p>
      ) : (
        <div className="space-y-3">
          {/* Risk posture + dominant risk */}
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{t('insights_posture')}</div>
              <span className={`text-xs font-bold font-mono ${postureColor}`}>
                {data.risk_posture.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="border-l border-slate-700 pl-3">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{t('dominant_risk')}</div>
              <span className="text-xs font-bold text-slate-200 uppercase">{data.dominant_risk}</span>
            </div>
          </div>

          {/* Strategy mix */}
          {Object.keys(data.strategy_mix).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.strategy_mix).map(([strat, count]) => (
                <span key={strat}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-semibold border border-slate-700">
                  {count}× {strat}
                </span>
              ))}
            </div>
          )}

          {/* Natural language hint */}
          <p className="text-[11px] text-slate-500 leading-relaxed border-t border-line/50 pt-3">
            {data.natural_language_hint}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Risk Weather panel ────────────────────────────────────────────────────────
function RiskWeatherPanel({ dashboard }: { dashboard: RiskDashboard }) {
  const { t } = useLanguage()
  const varVal = dashboard.var_1d_95 != null ? parseFloat(dashboard.var_1d_95) : null
  const margin = parseFloat(dashboard.maintenance_margin_total)

  // Weather classification based on VaR as % of margin (or absolute if no margin)
  const varRatio = varVal != null && margin > 0 ? varVal / margin : null
  let icon = '☀️'; let weatherKey: 'var_sunny' | 'var_cloudy' | 'var_stormy' | 'var_thunder' = 'var_sunny'
  let barColor = 'bg-green-500/60'; let textColor = 'text-green-400'
  if (varRatio != null) {
    if (varRatio > 0.05)      { icon = '⛈️'; weatherKey = 'var_thunder'; barColor = 'bg-red-500/70';    textColor = 'text-red-400' }
    else if (varRatio > 0.03) { icon = '🌩️'; weatherKey = 'var_stormy';  barColor = 'bg-orange-500/70'; textColor = 'text-orange-400' }
    else if (varRatio > 0.01) { icon = '⛅'; weatherKey = 'var_cloudy';  barColor = 'bg-yellow-500/60'; textColor = 'text-yellow-400' }
  }
  const barPct = varRatio != null ? Math.min(varRatio / 0.05, 1) * 100 : 0

  return (
    <div className="bg-card border border-line rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          {t('risk_weather')}
        </span>
        <span className="text-2xl" role="img" aria-label="weather">{icon}</span>
      </div>

      {varVal == null ? (
        <p className="text-xs text-slate-600">{t('var_no_data')}</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">{t('var_1d_95')}</div>
              <div className={`text-2xl font-bold tabular-nums ${textColor}`}>
                −${varVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">vs Margin</div>
              <div className="text-sm font-semibold text-slate-400 tabular-nums">
                {varRatio != null ? (varRatio * 100).toFixed(1) + '%' : '—'}
              </div>
            </div>
          </div>

          {/* Risk gauge bar */}
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${barPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-600">
            <span>Safe</span><span>Moderate</span><span>Critical</span>
          </div>

          <p className="text-[11px] text-slate-500">{t('var_subtitle')}</p>
          <div className={`text-xs font-semibold ${textColor}`}>{t(weatherKey)}</div>
        </>
      )}
    </div>
  )
}

// ── Stress test / Scenario panel ──────────────────────────────────────────────
function StressTestPanel({
  holdings,
  labels,
}: {
  holdings: HoldingGroup[]
  labels: {
    title:      string
    priceShift: string
    ivShift:    string
    estPnl:     string
    formula:    string
    bySymbol:   string
    skewToggle: string
    skewHint:   string
  }
}) {
  const [priceShiftPct, setPriceShiftPct] = useState(0)   // -20 to +20, displayed as %
  const [ivShiftPpt,    setIvShiftPpt]    = useState(0)   // -50 to +50 pp
  const [ivSkewEnabled, setIvSkewEnabled] = useState(false)

  const result = useMemo(
    () => computeScenarioPnL(holdings, priceShiftPct / 100, ivShiftPpt, ivSkewEnabled),
    [holdings, priceShiftPct, ivShiftPpt, ivSkewEnabled],
  )

  const pnlColor = result.total >= 0 ? 'text-green-400' : 'text-red-400'
  const pnlSign  = result.total >= 0 ? '+' : ''

  return (
    <div className="bg-card border border-line rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-info">{labels.title}</span>
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">
          — {labels.formula}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sliders */}
        <div className="space-y-5">
          {/* Price Shift */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400 font-medium">{labels.priceShift}</label>
              <span className={`text-sm font-bold tabular-nums ${
                priceShiftPct > 0 ? 'text-green-400' : priceShiftPct < 0 ? 'text-red-400' : 'text-slate-400'
              }`}>
                {priceShiftPct > 0 ? '+' : ''}{priceShiftPct}%
              </span>
            </div>
            <input
              type="range" min={-20} max={20} step={1}
              value={priceShiftPct}
              onChange={(e) => setPriceShiftPct(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                         bg-slate-700 accent-sky-400"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mt-1">
              <span>-20%</span><span>0</span><span>+20%</span>
            </div>
          </div>

          {/* IV Shift */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400 font-medium">{labels.ivShift}</label>
              <span className={`text-sm font-bold tabular-nums ${
                ivShiftPpt > 0 ? 'text-rose-400' : ivShiftPpt < 0 ? 'text-green-400' : 'text-slate-400'
              }`}>
                {ivShiftPpt > 0 ? '+' : ''}{ivShiftPpt}pp
              </span>
            </div>
            <input
              type="range" min={-50} max={50} step={5}
              value={ivShiftPpt}
              onChange={(e) => setIvShiftPpt(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                         bg-slate-700 accent-purple-400"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mt-1">
              <span>-50pp</span><span>0</span><span>+50pp</span>
            </div>
          </div>

          {/* IV Skew toggle */}
          <div className="flex items-start gap-3 pt-1 border-t border-line/50">
            <button
              type="button"
              onClick={() => setIvSkewEnabled((p) => !p)}
              className={`mt-0.5 w-9 h-5 rounded-full relative transition-colors shrink-0
                ${ivSkewEnabled ? 'bg-violet-500' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                ${ivSkewEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <div>
              <div className="text-xs text-slate-300 font-medium">{labels.skewToggle}</div>
              {ivSkewEnabled && priceShiftPct < 0 && (
                <div className="text-[10px] text-violet-400 mt-0.5">
                  +{(Math.abs(priceShiftPct) * 0.5).toFixed(1)}pp panic vol
                  → effective IV: {(ivShiftPpt + Math.abs(priceShiftPct) * 0.5).toFixed(1)}pp
                </div>
              )}
              {!ivSkewEnabled && (
                <div className="text-[10px] text-slate-600">{labels.skewHint}</div>
              )}
            </div>
          </div>

          {/* Reset */}
          {(priceShiftPct !== 0 || ivShiftPpt !== 0) && (
            <button
              onClick={() => { setPriceShiftPct(0); setIvShiftPpt(0) }}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              ↺ Reset to baseline
            </button>
          )}
        </div>

        {/* Result */}
        <div className="flex flex-col justify-between">
          {/* Total estimated PnL */}
          <div className="bg-row rounded-xl p-5 text-center mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {labels.estPnl}
            </div>
            <div className={`text-3xl font-bold tabular-nums ${pnlColor}`}>
              {pnlSign}${Math.abs(result.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Per-symbol breakdown */}
          {result.bySymbol.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-2">
                {labels.bySymbol}
              </div>
              <div className="space-y-1">
                {result.bySymbol.map(({ symbol, pnl }) => {
                  const isPos = pnl >= 0
                  return (
                    <div key={symbol} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium w-16">{symbol}</span>
                      <div className="flex-1 mx-3 h-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isPos ? 'bg-green-500/50' : 'bg-red-500/50'}`}
                          style={{ width: `${Math.min(Math.abs(pnl) / Math.abs(result.total || 1) * 100, 100)}%` }}
                        />
                      </div>
                      <span className={`tabular-nums font-semibold w-24 text-right ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                        {isPos ? '+' : ''}${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function RiskPage() {
  const { selectedPortfolioId, refreshKey } = usePortfolio()
  const { t } = useLanguage()

  const [dashboard, setDashboard] = useState<RiskDashboard | null>(null)
  const [holdings,  setHoldings]  = useState<HoldingGroup[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetchRiskDashboard(selectedPortfolioId),
      fetchHoldings(selectedPortfolioId),
    ])
      .then(([d, h]) => { setDashboard(d); setHoldings(h) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  const hasSector    = dashboard && Object.keys(dashboard.sector_exposure ?? {}).length > 0
  const hasBenchmark = dashboard && (dashboard.benchmark_ytd ?? []).length > 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">{t('risk_title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('risk_sub')}</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 bg-card border border-line rounded-xl animate-pulse" />
          ))}
        </div>
      ) : dashboard ? (
        <>
          {/* ── Alpha Dashboard (NLV vs benchmark line chart) ──── */}
          <AlphaDashboard portfolioId={selectedPortfolioId} />

          {/* ── Stat cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label={t('stat_net_delta')} value={fmtNum(dashboard.total_net_delta)}
              sub="∑ net_contracts × Δ × 100" valueClass={signClass(dashboard.total_net_delta)} />
            <StatCard label={t('stat_gamma')}  value={fmtGreek(dashboard.total_gamma)}
              sub="convexity risk"     valueClass="text-sky-400" />
            <StatCard label={t('stat_theta')}  value={fmtNum(dashboard.total_theta_daily)}
              sub="time-decay earnings" valueClass="text-amber-400" />
            <StatCard label={t('stat_vega')}   value={fmtGreek(dashboard.total_vega)}
              sub="per 1% vol move"    valueClass="text-purple-400" />
            <StatCard label={t('stat_margin')} value={fmtUSD(dashboard.maintenance_margin_total)}
              sub={`${dashboard.positions_count} position${dashboard.positions_count !== 1 ? 's' : ''}`}
              valueClass="text-slate-200" />
          </div>

          {/* ── Top efficient ──────────────────────────────────── */}
          {dashboard.top_efficient_symbol && (
            <div className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">
              <span className="text-amber-400 text-lg">★</span>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">
                  {t('top_efficient')}
                </span>
                <span className="ml-2 text-white font-bold">{dashboard.top_efficient_symbol}</span>
              </div>
              <span className="text-xs text-slate-500 ml-auto">highest Θ/margin ratio</span>
            </div>
          )}

          {/* ── Risk Weather (VaR) ─────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RiskWeatherPanel dashboard={dashboard} />
            <InsightPanel portfolioId={selectedPortfolioId} />
          </div>

          {/* ── P&L Attribution ────────────────────────────────── */}
          <AttributionPanel portfolioId={selectedPortfolioId} />

          {/* ── Scenario Simulation (Stress Test) ─────────────── */}
          <StressTestPanel
            holdings={holdings}
            labels={{
              title:      t('scenario_sim'),
              priceShift: t('price_shift'),
              ivShift:    t('iv_shift'),
              estPnl:     t('est_pnl'),
              formula:    t('pnl_formula'),
              bySymbol:   t('by_symbol'),
              skewToggle: t('iv_skew_toggle'),
              skewHint:   t('iv_skew_hint'),
            }}
          />

          {/* ── Risk Alerts ────────────────────────────────────── */}
          <RiskAlertsPanel
            alerts={dashboard.risk_alerts ?? []}
            label={t('risk_alerts')}
            noAlertLabel={t('no_alerts')}
          />

          {/* ── Charts ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ExpiryChart dashboard={dashboard} label={t('expiry_dist')} />
            <DeltaContribChart holdings={holdings} label={t('delta_contrib')} />
          </div>

          {/* ── Sector exposure + Alpha vs Market ─────────────── */}
          {(hasSector || hasBenchmark) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {hasSector && (
                <SectorExposurePanel sectorExp={dashboard.sector_exposure} label={t('sector_exposure')} />
              )}
              {hasBenchmark && (
                <BenchmarkPanel dashboard={dashboard} label={t('alpha_vs_market')} ytdLabel={t('ytd_return')} />
              )}
            </div>
          )}

          {/* ── Last updated ─────────────────────────────────── */}
          <p className="text-xs text-slate-600 text-right">
            as of {new Date(dashboard.as_of).toLocaleTimeString()}
          </p>
        </>
      ) : null}
    </div>
  )
}
