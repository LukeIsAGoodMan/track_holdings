/**
 * RiskPageV2 — Professional risk workspace.
 *
 * Layout (flex):
 *   Main column (flex-1): Hero → Scenario → Concentration → Charts
 *   RightPanel (shell): Alerts, Insights, Sector, Benchmark
 *
 * All V1 business logic preserved — this is a visual-only rebuild.
 * Data hooks, WS logic, computeScenarioPnL are reused as-is.
 */
import { useEffect, useState, useMemo, useCallback, memo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
  LineChart, Line, Legend,
} from 'recharts'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import {
  fetchRiskDashboard, fetchHoldings, fetchAccountHistory,
  fetchAttribution, fetchInsights,
} from '@/api/holdings'
import type {
  RiskDashboard, HoldingGroup, AccountHistoryResponse,
  AttributionResponse, PortfolioInsight, Portfolio,
} from '@/types'
import { fmtNum, fmtUSD, fmtGreek } from '@/utils/format'
import CoachPanel from './CoachPanel'

import RiskHero            from '@/design-system/workspace/RiskHero'
import RiskHeatmap         from '@/design-system/workspace/RiskHeatmap'
import ScenarioStressPanel from '@/design-system/workspace/ScenarioStressPanel'
import ConcentrationTable  from '@/design-system/workspace/ConcentrationTable'
import RiskAlertStack      from '@/design-system/workspace/RiskAlertStack'
import SectionCard         from '@/design-system/primitives/SectionCard'
import EmptyState          from '@/design-system/primitives/EmptyState'
import RightPanel          from '@/design-system/shell/RightPanel'

// ── V2 Tooltip style ─────────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--color-v2-surface, #ffffff)',
    border: '1px solid var(--ds-border-subtle, #e2e8f0)',
    borderRadius: 8,
    fontSize: 12,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  },
  labelStyle:   { color: 'var(--color-v2-text-1, #0f172a)', marginBottom: 4 },
  itemStyle:    { color: 'var(--color-v2-text-2, #475569)' },
}

// ── Scenario computation (pure client-side, same as V1) ──────────────────────
function computeScenarioPnL(
  holdings:      HoldingGroup[],
  priceShiftPct: number,
  ivShiftPpt:    number,
  ivSkewEnabled: boolean = false,
): { total: number; bySymbol: { symbol: string; pnl: number }[]; effectiveIvShift: number } {
  const panicVol = ivSkewEnabled && priceShiftPct < 0
    ? Math.abs(priceShiftPct) * 50
    : 0
  const effectiveIvShift = ivShiftPpt + panicVol
  let total = 0
  const bySymbol: { symbol: string; pnl: number }[] = []

  for (const group of holdings) {
    const spot = group.spot_price != null ? parseFloat(group.spot_price) : null
    if (spot == null || spot <= 0) continue
    const deltaP = spot * priceShiftPct
    let symPnl = 0

    for (const leg of group.option_legs) {
      if (leg.delta == null || leg.gamma == null || leg.vega == null) continue
      const n = leg.net_contracts
      const delta = parseFloat(leg.delta)
      const gamma = parseFloat(leg.gamma)
      const vega  = parseFloat(leg.vega)
      const deltaExp = n * delta * 100
      const gammaExp = n * gamma * 100
      const vegaExp  = n * vega  * 100
      symPnl += deltaExp * deltaP + 0.5 * gammaExp * deltaP * deltaP + vegaExp * effectiveIvShift
    }

    for (const leg of group.stock_legs) {
      symPnl += leg.net_shares * deltaP
    }

    bySymbol.push({ symbol: group.symbol, pnl: symPnl })
    total += symPnl
  }

  bySymbol.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
  return { total, bySymbol, effectiveIvShift }
}

// ── Alpha Dashboard colours ──────────────────────────────────────────────────
const NAMED_COLORS: Record<string, string> = {
  account: '#059669',
  SPY:     '#0284c7',
  QQQ:     '#d97706',
  NVDA:    '#7c3aed',
  AAPL:    '#ea580c',
  MSFT:    '#059669',
  'BTC-USD': '#b45309',
}
const EXTRA_COLORS = ['#9333ea', '#2563eb', '#16a34a', '#ca8a04', '#dc2626']

function lineColor(sym: string, extras: string[]): string {
  if (NAMED_COLORS[sym]) return NAMED_COLORS[sym]
  const idx = extras.indexOf(sym)
  return EXTRA_COLORS[idx % EXTRA_COLORS.length] ?? '#94a3b8'
}

// ── Alpha Dashboard (V2) ────────────────────────────────────────────────────
const AlphaDashboardV2 = memo(function AlphaDashboardV2({
  portfolioId,
}: {
  portfolioId: number | null | undefined
}) {
  const { t } = useLanguage()

  const DEFAULT_BM = ['SPY', 'QQQ']
  const [extraBm,  setExtraBm]  = useState<string[]>([])
  const [inputSym, setInputSym] = useState('')
  const [history,  setHistory]  = useState<AccountHistoryResponse | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const allBenchmarks = useMemo(() => [...DEFAULT_BM, ...extraBm], [extraBm])

  const fetchHistory = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchAccountHistory(portfolioId, allBenchmarks)
      .then(setHistory)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [portfolioId, allBenchmarks])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  function addSymbol() {
    const sym = inputSym.trim().toUpperCase()
    if (!sym || allBenchmarks.includes(sym)) return
    setExtraBm((prev) => [...prev, sym])
    setInputSym('')
  }

  function removeExtra(sym: string) {
    setExtraBm((prev) => prev.filter((s) => s !== sym))
  }

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

  const lineKeys = useMemo(() => {
    if (!history) return ['account']
    return ['account', ...Object.keys(history.benchmarks)]
  }, [history])

  const xInterval = Math.max(0, Math.floor((chartData.length - 1) / 6))
  const hasHistory = history && history.dates.length > 0

  return (
    <SectionCard noPadding>
      <div className="px-5 py-3 border-b border-v2-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-ds-h3 text-v2-text-1">
            {t('alpha_dashboard')}
          </h3>
          {hasHistory && (
            <span className="text-ds-caption text-v2-text-3 font-mono">
              {t('nlv_normalized')}
            </span>
          )}
        </div>

        {hasHistory && (
          <div className="flex items-center gap-4 text-xs tnum">
            {history.alpha_vs_spy != null && (
              <div className="text-right">
                <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">
                  {t('alpha_relative')}
                </div>
                <span className={`font-bold text-sm ${history.alpha_vs_spy >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
                  {history.alpha_vs_spy >= 0 ? '+' : ''}{history.alpha_vs_spy.toFixed(2)} pp
                </span>
              </div>
            )}
            {history.sharpe_ratio != null && (
              <div className="text-right">
                <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">
                  {t('sharpe_ratio')}
                </div>
                <span className={`font-bold text-sm ${history.sharpe_ratio >= 1 ? 'text-v2-positive' : history.sharpe_ratio >= 0 ? 'text-v2-caution' : 'text-v2-negative'}`}>
                  {history.sharpe_ratio.toFixed(2)}
                  <span className="text-ds-caption font-normal text-v2-text-3 ml-1">{t('indicative')}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Benchmark search + pills */}
        <div className="flex flex-wrap items-center gap-2">
          {extraBm.map((sym) => (
            <span key={sym}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-sm
                         font-bold border"
              style={{ color: lineColor(sym, extraBm), borderColor: lineColor(sym, extraBm) + '60' }}
            >
              {sym}
              <button onClick={() => removeExtra(sym)} className="hover:opacity-70 transition-opacity">x</button>
            </span>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <input
              type="text"
              value={inputSym}
              onChange={(e) => setInputSym(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
              placeholder={t('benchmark_search')}
              className="w-44 bg-v2-surface border border-v2-border rounded-v2-sm px-2.5 py-1 text-xs
                         text-v2-text-1 placeholder-v2-text-3
                         focus:outline-none focus:border-v2-accent/50 transition-colors"
            />
            <button
              onClick={addSymbol}
              disabled={!inputSym.trim()}
              className="px-3 py-1 rounded-v2-sm bg-v2-accent-soft border border-v2-accent/30 text-v2-accent
                         text-xs font-bold hover:bg-v2-accent-soft/80 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('add_benchmark')}
            </button>
          </div>
        </div>

        {/* Chart or state messages */}
        {loading ? (
          <div className="h-64 animate-pulse bg-v2-surface-alt rounded-v2-md" />
        ) : error ? (
          <div className="text-xs text-v2-negative bg-v2-negative-bg border border-v2-negative/20 rounded-v2-md px-3 py-2">
            {error}
          </div>
        ) : !hasHistory ? (
          <EmptyState message={t('no_history')} className="py-10" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-border-subtle, #f1f5f9)" />
              <XAxis
                dataKey="date" interval={xInterval}
                tick={{ fill: 'var(--color-v2-text-3, #94a3b8)', fontSize: 10 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fill: 'var(--color-v2-text-3, #94a3b8)', fontSize: 10 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v: number) => v.toFixed(0)}
                width={40}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
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

        {hasHistory && history.first_date && (
          <p className="text-ds-caption text-v2-text-3 text-right">
            Normalized to 100 at {history.first_date}
          </p>
        )}
      </div>
    </SectionCard>
  )
})

// ── P&L Attribution Panel (V2) ──────────────────────────────────────────────
const AttributionPanelV2 = memo(function AttributionPanelV2({
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
    <SectionCard noPadding>
      <div className="px-5 py-3 border-b border-v2-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-ds-h3 text-v2-text-1">
            {t('pnl_attribution')}
          </h3>
          {hasData && (
            <span className="text-ds-caption text-v2-text-3">{t('attr_subtitle')}</span>
          )}
        </div>

        {hasData && (
          <div className="flex items-center gap-4 text-xs tnum">
            <div className="text-right">
              <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">{t('attr_time_decay')}</div>
              <span className={`font-bold text-sm ${totalDecay >= 0 ? 'text-v2-caution' : 'text-v2-negative'}`}>
                {fmtUsdShort(totalDecay)}
              </span>
            </div>
            <div className="text-right">
              <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">{t('attr_directional')}</div>
              <span className={`font-bold text-sm ${totalDir >= 0 ? 'text-v2-accent' : 'text-v2-negative'}`}>
                {fmtUsdShort(totalDir)}
              </span>
            </div>
            <div className="text-right border-l border-v2-border pl-4">
              <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">{t('attr_total')}</div>
              <span className={`font-bold text-sm ${totalUnreal >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
                {fmtUsdShort(totalUnreal)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="p-5">
        {loading ? (
          <div className="h-56 animate-pulse bg-v2-surface-alt rounded-v2-md" />
        ) : error ? (
          <div className="text-xs text-v2-negative bg-v2-negative-bg border border-v2-negative/20 rounded-v2-md px-3 py-2">
            {error}
          </div>
        ) : !hasData ? (
          <EmptyState message={t('attr_empty')} className="py-8" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-border-subtle, #f1f5f9)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--color-v2-text-3, #94a3b8)', fontSize: 10 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: 'var(--color-v2-text-3, #94a3b8)', fontSize: 10 }}
                axisLine={false} tickLine={false}
                tickFormatter={(v: number) =>
                  (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
                }
                width={52}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
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
              <Bar dataKey="time_decay"  stackId="pnl" fill="#d9770660" radius={[0, 0, 0, 0]} />
              <Bar dataKey="directional" stackId="pnl" fill="#0284c760" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.directional >= 0 ? '#0284c760' : '#e11d4860'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </SectionCard>
  )
})

// ── Expiry Chart (V2) ────────────────────────────────────────────────────────
const ExpiryChartV2 = memo(function ExpiryChartV2({
  dashboard, isEn,
}: {
  dashboard: RiskDashboard; isEn: boolean
}) {
  const data = dashboard.expiry_buckets.map((b) => ({
    label: b.label, contracts: Math.abs(b.net_contracts), delta: parseFloat(b.delta_exposure),
  }))

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Expiry Distribution' : '到期分布'} />
      <SectionCard.Body>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-border-subtle, #f1f5f9)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--color-v2-text-3, #94a3b8)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--color-v2-text-3, #94a3b8)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="contracts" name="Contracts" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.contracts > 0 ? '#e11d4870' : '#05966980'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard.Body>
    </SectionCard>
  )
})

// ── Sector Exposure (V2) ─────────────────────────────────────────────────────
// Asset-class keys that must NOT appear in sector views (strict dimension separation)
const ASSET_CLASS_KEYS = new Set(['Stock', 'ETF/Index', 'Crypto', 'Option'])

const SectorExposureV2 = memo(function SectorExposureV2({
  sectorExp, isEn,
}: {
  sectorExp: Record<string, string>; isEn: boolean
}) {
  // Filter out asset_class keys — sector and asset_class are strictly separate dimensions
  const entries = Object.entries(sectorExp).filter(([key]) => !ASSET_CLASS_KEYS.has(key))
  if (entries.length === 0) return null
  const sorted = [...entries].sort((a, b) => Math.abs(parseFloat(b[1])) - Math.abs(parseFloat(a[1])))
  const maxAbs = Math.max(...sorted.map(([, v]) => Math.abs(parseFloat(v))), 1)

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Sector Exposure' : '行业敞口'} />
      <SectionCard.Body>
        <div className="space-y-3">
          {sorted.map(([tag, deltaStr]) => {
            const delta = parseFloat(deltaStr)
            const pct = (Math.abs(delta) / maxAbs) * 100
            const isLong = delta >= 0
            return (
              <div key={tag}>
                <div className="flex items-center justify-between text-ds-sm mb-1">
                  <span className="text-v2-text-1 font-bold">{tag}</span>
                  <span className={`tnum font-bold ${isLong ? 'text-v2-positive' : 'text-v2-negative'}`}>
                    {isLong ? '+' : ''}{fmtNum(deltaStr)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-v2-surface-alt overflow-hidden">
                  <div className={`h-full rounded-full ${isLong ? 'bg-v2-positive/60' : 'bg-v2-negative/60'}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
})

// ── Benchmark Panel (V2) ────────────────────────────────────────────────────
const BenchmarkPanelV2 = memo(function BenchmarkPanelV2({
  dashboard, isEn,
}: {
  dashboard: RiskDashboard; isEn: boolean
}) {
  if (!dashboard.benchmark_ytd?.length) return null

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Market Benchmarks' : '市场基准'} />
      <SectionCard.Body>
        <div className="grid grid-cols-2 gap-3">
          {dashboard.benchmark_ytd.map((bench) => {
            const ytd = bench.ytd_return != null ? parseFloat(bench.ytd_return) : null
            const pctStr = ytd != null ? (ytd * 100).toFixed(2) + '%' : '—'
            const isPos = ytd != null && ytd >= 0
            const cls = ytd == null ? 'text-v2-text-3' : isPos ? 'text-v2-positive' : 'text-v2-negative'
            return (
              <div key={bench.symbol} className="bg-v2-surface-alt rounded-v2-md border border-v2-border p-4 text-center">
                <div className="text-ds-caption text-v2-text-3 uppercaser mb-2">{bench.symbol}</div>
                <div className={`text-xl font-bold tnum ${cls}`}>{isPos ? '+' : ''}{pctStr}</div>
                <div className="text-ds-caption text-v2-text-3 mt-1 uppercaser">
                  {isEn ? 'YTD Return' : 'YTD回报'}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
})

// ── Insight Panel (V2) ──────────────────────────────────────────────────────
const InsightPanelV2 = memo(function InsightPanelV2({
  portfolioId,
}: {
  portfolioId: number | null | undefined
}) {
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
    short_gamma_positive_theta: 'text-v2-caution',
    long_gamma_positive_theta:  'text-v2-positive',
    short_gamma_negative_theta: 'text-v2-negative',
    long_gamma_negative_theta:  'text-v2-accent',
  }
  const postureColor = data ? (POSTURE_COLOR[data.risk_posture] ?? 'text-v2-text-2') : 'text-v2-text-3'

  return (
    <SectionCard>
      <SectionCard.Header
        title={t('insights_title')}
        action={
          <span className="text-ds-caption px-2 py-0.5 rounded-md bg-v2-accent-soft text-v2-accent border border-v2-accent/20">
            LLM-Ready
          </span>
        }
      />
      <SectionCard.Body>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-3 bg-v2-surface-alt rounded animate-pulse" />)}
          </div>
        ) : !data ? (
          <p className="text-ds-sm text-v2-text-3">{t('var_no_data')}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">{t('insights_posture')}</div>
                <span className={`text-ds-sm font-mono ${postureColor}`}>
                  {data.risk_posture.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="border-l border-v2-border pl-3">
                <div className="text-ds-caption text-v2-text-3 uppercaser mb-0.5">{t('dominant_risk')}</div>
                <span className="text-ds-sm text-v2-text-1 uppercase">{data.dominant_risk}</span>
              </div>
            </div>

            {Object.keys(data.strategy_mix).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.strategy_mix).map(([strat, count]) => (
                  <span key={strat}
                    className="text-ds-caption px-2 py-0.5 rounded-full bg-v2-surface-alt text-v2-text-2 border border-v2-border">
                    {count}x {strat}
                  </span>
                ))}
              </div>
            )}

            <p className="text-ds-sm text-v2-text-2 leading-relaxed border-t border-v2-border pt-3">
              {data.natural_language_hint}
            </p>
          </div>
        )}
      </SectionCard.Body>
    </SectionCard>
  )
})

// ── Page ────────────────────────────────────────────────────────────────────
export default function RiskPageV2() {
  const { selectedPortfolioId, refreshKey, portfolios } = usePortfolio()
  const { lang } = useLanguage()
  const { lastRiskUpdate, lastHoldingsUpdate } = useWebSocket()
  const isEn = lang !== 'zh'

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

  useEffect(() => {
    if (!lastRiskUpdate) return
    if (lastRiskUpdate.portfolioId !== selectedPortfolioId) return
    setDashboard((prev) => prev ? { ...prev, ...lastRiskUpdate.data } : prev)
  }, [lastRiskUpdate, selectedPortfolioId])

  useEffect(() => {
    if (!lastHoldingsUpdate) return
    if (lastHoldingsUpdate.portfolioId !== selectedPortfolioId) return
    setHoldings(lastHoldingsUpdate.data)
  }, [lastHoldingsUpdate, selectedPortfolioId])

  const hasSector = dashboard && Object.keys(dashboard.sector_exposure ?? {}).length > 0

  // Find selected portfolio node
  const selectedPortfolio: Portfolio | null = (() => {
    const walk = (nodes: Portfolio[]): Portfolio | null => {
      for (const p of nodes) {
        if (p.id === selectedPortfolioId) return p
        const found = walk(p.children)
        if (found) return found
      }
      return null
    }
    return walk(portfolios)
  })()

  return (
    <div className="space-y-6">
      {/* ── Portfolio breadcrumb ────────────────────────────────── */}
      {selectedPortfolio && (
        <div className="flex items-center gap-2">
          <span className="text-ds-body-r text-v2-text-1">{selectedPortfolio.name}</span>
          {selectedPortfolio.is_folder && (
            <span className="text-ds-caption uppercase px-1.5 py-0.5 rounded-md bg-v2-accent-soft text-v2-accent">
              {isEn ? 'Folder' : '文件夹'}
            </span>
          )}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-v2-negative-bg border border-v2-negative/20 rounded-v2-md px-4 py-3 text-v2-negative text-sm">
          {error}
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-5">
          {/* Hero skeleton — VaR headline + 4 greek metrics */}
          <div className="h-16 bg-v2-surface rounded-v2-lg shadow-v2-sm animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-v2-surface rounded-v2-lg shadow-v2-sm animate-pulse" />
            ))}
          </div>
          {/* Flex skeleton: main + right panel */}
          <div className="flex gap-5">
            <div className="flex-1 min-w-0 space-y-4">
              <div className="h-48 bg-v2-surface rounded-v2-lg shadow-v2-sm animate-pulse" />
              <div className="h-36 bg-v2-surface rounded-v2-lg shadow-v2-sm animate-pulse" />
              <div className="h-44 bg-v2-surface rounded-v2-lg shadow-v2-sm animate-pulse" />
            </div>
            <RightPanel>
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 bg-v2-surface rounded-v2-lg shadow-v2-sm animate-pulse" />
              ))}
            </RightPanel>
          </div>
        </div>
      ) : dashboard ? (
        <>
          {/* ── Risk Hero ──────────────────────────────────────── */}
          <RiskHero dashboard={dashboard} isEn={isEn} />

          {/* ── Flex layout: Main + Right Panel ────────────────── */}
          <div className="flex gap-5">
            {/* ── Main column ─────────────────────────────────── */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Alpha Dashboard */}
              <AlphaDashboardV2 portfolioId={selectedPortfolioId} />

              {/* P&L Attribution */}
              <AttributionPanelV2 portfolioId={selectedPortfolioId} />

              {/* Scenario Simulation */}
              <ScenarioStressPanel
                holdings={holdings}
                computeScenarioPnL={computeScenarioPnL}
                isEn={isEn}
              />

              {/* Top Risk Contributors */}
              <ConcentrationTable holdings={holdings} isEn={isEn} />

              {/* Expiry + Delta charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ExpiryChartV2 dashboard={dashboard} isEn={isEn} />
                <RiskHeatmap holdings={holdings} isEn={isEn} />
              </div>
            </div>

            {/* ── Right Panel (shell component) ───────────────── */}
            <RightPanel>
              <RiskAlertStack alerts={dashboard.risk_alerts ?? []} isEn={isEn} />
              <InsightPanelV2 portfolioId={selectedPortfolioId} />
              {hasSector && (
                <SectorExposureV2 sectorExp={dashboard.sector_exposure} isEn={isEn} />
              )}
              <BenchmarkPanelV2 dashboard={dashboard} isEn={isEn} />
            </RightPanel>
          </div>

          {/* ── Last updated ───────────────────────────────────── */}
          <p className="text-ds-caption text-v2-text-3 text-right tnum">
            {isEn ? 'as of' : '截至'} {new Date(dashboard.as_of).toLocaleTimeString()}
          </p>
        </>
      ) : !error ? (
        <SectionCard minHeight="200px">
          <EmptyState
            message={isEn ? 'No risk data available' : '暂无风险数据'}
            hint={isEn ? 'Open positions to see risk analysis' : '建立仓位后将显示风险分析'}
          />
        </SectionCard>
      ) : null}

      {/* ── AI Coach sidebar ───────────────────────────────────── */}
      <CoachPanel portfolioId={selectedPortfolioId} />
    </div>
  )
}
