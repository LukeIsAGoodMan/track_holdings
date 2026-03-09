/**
 * Holdings Page — Phase 14.13 (Merged)
 * 14.12 full components + 14.13 sticky-state improvements:
 *   · lastValidSpots ref (spots survive WS reconnect)
 *   · isCold WS guard (reject all-zero perf push)
 *   · Smart per-symbol i18n merge (preserves old perf where new is 0)
 *   · currentSpots fallback in heroMetrics & treemapData
 */

// Module-level singleton: lifecycle sweep fires at most once per browser session.
let _lifecycleCalledThisSession = false

import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate }  from 'react-router-dom'
import { Treemap, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useLanguage }   from '@/context/LanguageContext'
import { useWebSocket }  from '@/context/WebSocketContext'
import {
  fetchHoldings, fetchCash, fetchSettledTrades,
  triggerLifecycle, fetchRiskDashboard,
} from '@/api/holdings'
import type {
  HoldingGroup, OptionLeg, StockLeg, CashSummary,
  SettledTrade, LifecycleResult, RiskDashboard,
} from '@/types'
import { fmtUSD, fmtNum, fmtGreek, dteBadgeClass, signClass } from '@/utils/format'
import PortfolioHistoryChart from '@/components/PortfolioHistoryChart'
import AiInsightPanel        from '@/components/AiInsightPanel'

// ── Local types ────────────────────────────────────────────────────────────────
type Tab    = 'overview' | 'details'
type Period = '1d' | '5d' | '1m' | '3m'
const PERIOD_LABELS: Record<Period, { en: string; zh: string }> = {
  '1d': { en: '1D', zh: '1日' },
  '5d': { en: '5D', zh: '5日' },
  '1m': { en: '1M', zh: '1月' },
  '3m': { en: '3M', zh: '3月' },
}

interface HeroMetrics {
  dailyUnrealizedPnl:    number
  netExposure:           number
  portfolioValue:        number
  realizedPnl:           number
  dailyUnrealizedPnlPct: number | null
  realizedPnlPct:        number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function safeFloat(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return isFinite(n) ? n : null
}

function perfColor(pct: number | null | undefined): string {
  if (pct == null || !isFinite(pct)) return '#e2e8f0'
  if (pct >=  4) return '#059669'
  if (pct >=  2) return '#34d399'
  if (pct >=  0) return '#a7f3d0'
  if (pct >= -2) return '#fecaca'
  if (pct >= -4) return '#f87171'
  return '#e11d48'
}

function getEffectivePerf(g: HoldingGroup, period: Period): number | null {
  const raw = period === '1d' ? g.effective_perf_1d
    : period === '5d' ? g.effective_perf_5d
    : period === '1m' ? g.effective_perf_1m
    : g.effective_perf_3m
  return safeFloat(raw)
}

function getRawPerf(g: HoldingGroup, period: Period): number | null {
  const raw = period === '1d' ? g.perf_1d
    : period === '5d' ? g.perf_5d
    : period === '1m' ? g.perf_1m
    : g.perf_3m
  return safeFloat(raw)
}

// ── Treemap cell ───────────────────────────────────────────────────────────────
function CustomCell(props: Record<string, unknown>) {
  const x      = typeof props.x      === 'number' ? props.x      : 0
  const y      = typeof props.y      === 'number' ? props.y      : 0
  const width  = typeof props.width  === 'number' ? props.width  : 0
  const height = typeof props.height === 'number' ? props.height : 0
  const name   = typeof props.name   === 'string' ? props.name   : String(props.name ?? '')
  const perf   = typeof props.perf   === 'number' && isFinite(props.perf as number) ? props.perf as number : null
  const isShort = props.isShort === true

  if (width <= 0 || height <= 0) return <g />

  const fill  = perfColor(perf)
  const label = isShort ? `${name} (S)` : name
  const shadowStyle = { paintOrder: 'stroke fill' } as React.CSSProperties

  return (
    <g>
      <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} fill={fill} rx={6} stroke="#ffffff" strokeWidth={2} />
      {width > 36 && height > 22 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - (height > 40 ? 9 : 0)} textAnchor="middle" dominantBaseline="middle" fill="white" stroke="rgba(0,0,0,0.45)" strokeWidth={2.5} strokeLinejoin="round" style={shadowStyle} fontSize={Math.min(13, Math.max(8, width / 6))} fontWeight="800">{label || '?'}</text>
          {height > 40 && perf != null && (
            <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" dominantBaseline="middle" fill="white" stroke="rgba(0,0,0,0.35)" strokeWidth={2} strokeLinejoin="round" style={shadowStyle} fontSize={Math.min(11, Math.max(8, width / 8))} fontWeight="700">{perf >= 0 ? '+' : ''}{perf.toFixed(2)}%</text>
          )}
        </>
      )}
    </g>
  )
}

// ── Treemap tooltip ────────────────────────────────────────────────────────────
function TreemapTooltip({ active, payload }: { active?: boolean; payload?: readonly unknown[] }) {
  if (!active || !payload?.length) return null
  const item = (payload[0] as Record<string, unknown>)?.payload as Record<string, unknown> | undefined
  if (!item) return null
  const name     = typeof item.name     === 'string' ? item.name : '?'
  const perf     = typeof item.perf     === 'number' && isFinite(item.perf)     ? item.perf     : null
  const exposure = typeof item.exposure === 'number'                            ? item.exposure : null
  const isShort  = item.isShort === true
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-xs font-sans min-w-[165px]">
      <div className="font-bold text-slate-900 text-sm mb-1.5 flex items-center gap-1.5">
        {name}
        {isShort && <span className="text-[10px] font-semibold text-rose-500 bg-rose-50 border border-rose-200 px-1 py-0.5 rounded">(S)</span>}
      </div>
      <div className="space-y-0.5 text-slate-500">
        {exposure != null && <div>Notional: <span className="font-semibold text-slate-800">{fmtUSD(String(exposure))}</span></div>}
        {perf != null && (
          <div className="border-t border-slate-100 pt-0.5 mt-0.5">P&L direction: <span className={`font-bold ${perf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{perf >= 0 ? '+' : ''}{perf.toFixed(2)}%</span></div>
        )}
      </div>
    </div>
  )
}

// ── StatCard ───────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, valueClass = 'text-slate-900' }: {
  label: string; value: string; sub?: string; valueClass?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-4 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums leading-tight ${valueClass}`}>{value || '—'}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

// ── Sector Pie ─────────────────────────────────────────────────────────────────
const SECTOR_COLORS = ['#0284c7', '#7c3aed', '#d97706', '#059669', '#ea580c', '#9333ea', '#2563eb', '#b45309', '#16a34a', '#dc2626', '#0891b2', '#c026d3']
function SectorPieChart({ sectorExp, isEn }: { sectorExp: Record<string, string> | null | undefined; isEn: boolean }) {
  const entries = sectorExp ? Object.entries(sectorExp) : []
  if (entries.length === 0) return null
  const data = [...entries]
    .sort((a, b) => Math.abs(parseFloat(b[1])) - Math.abs(parseFloat(a[1])))
    .map(([tag, deltaStr], i) => ({ name: tag, value: Math.max(0.001, Math.abs(parseFloat(deltaStr) || 0)), delta: parseFloat(deltaStr) || 0, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }))
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">{isEn ? 'Sector Exposure' : '板块敞口'}</div>
      <div className="flex items-center gap-6 flex-wrap">
        <div className="shrink-0">
          <ResponsiveContainer width={190} height={190}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload as typeof data[0] | undefined
                if (!d) return null
                return (
                  <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                    <div className="font-bold text-slate-900 mb-1">{d.name}</div>
                    <div className={d.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{d.delta >= 0 ? '+' : ''}{d.delta.toFixed(2)} Δ</div>
                    <div className="text-slate-400">{total > 0 ? (d.value / total * 100).toFixed(1) : '0'}% of exposure</div>
                  </div>
                )
              }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2.5 min-w-0">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
              <span className="text-slate-700 truncate flex-1 font-medium min-w-0">{entry.name}</span>
              <span className={`tabular-nums font-semibold shrink-0 ${entry.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{entry.delta >= 0 ? '+' : ''}{entry.delta.toFixed(1)}Δ</span>
              <span className="text-slate-400 tabular-nums shrink-0 w-9 text-right">{total > 0 ? (entry.value / total * 100).toFixed(0) : '0'}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Strategy Pie ───────────────────────────────────────────────────────────────
const STRATEGY_COLORS: Record<string, string> = { IRON_CONDOR: '#7c3aed', VERTICAL: '#0284c7', STRADDLE: '#d97706', STRANGLE: '#ea580c', CALENDAR: '#059669', CUSTOM: '#c026d3', SINGLE: '#64748b' }
const STRATEGY_LABELS: Record<string, string> = { IRON_CONDOR: 'Iron Condor', VERTICAL: 'Vertical', STRADDLE: 'Straddle', STRANGLE: 'Strangle', CALENDAR: 'Calendar', CUSTOM: 'Custom', SINGLE: 'Single' }
function StrategyPieChart({ holdings, isEn }: { holdings: HoldingGroup[]; isEn: boolean }) {
  const data = useMemo(() => {
    const byStrategy: Record<string, number> = {}
    for (const g of holdings) {
      const type = g.strategy_type || 'SINGLE'
      const exp  = safeFloat(g.delta_adjusted_exposure) ?? 0
      if (exp > 0) byStrategy[type] = (byStrategy[type] ?? 0) + exp
    }
    return Object.entries(byStrategy)
      .map(([type, value]) => ({ name: type, displayName: STRATEGY_LABELS[type] ?? type, value, color: STRATEGY_COLORS[type] ?? '#94a3b8' }))
      .sort((a, b) => b.value - a.value)
  }, [holdings])
  if (data.length === 0) return null
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">{isEn ? 'Strategy Mix' : '策略分布'}</div>
      <div className="flex items-center gap-6 flex-wrap">
        <div className="shrink-0">
          <ResponsiveContainer width={190} height={190}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="displayName" cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload as typeof data[0] | undefined
                if (!d) return null
                return (
                  <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                    <div className="font-bold text-slate-900 mb-1">{d.displayName}</div>
                    <div className="text-slate-500">{fmtUSD(String(Math.round(d.value)))} notional</div>
                    <div className="text-slate-400">{total > 0 ? (d.value / total * 100).toFixed(1) : '0'}% of exposure</div>
                  </div>
                )
              }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2.5 min-w-0">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
              <span className="text-slate-700 truncate flex-1 font-medium min-w-0">{entry.displayName}</span>
              <span className="text-slate-500 tabular-nums shrink-0">{fmtUSD(String(Math.round(entry.value)))}</span>
              <span className="text-slate-400 tabular-nums shrink-0 w-9 text-right">{total > 0 ? (entry.value / total * 100).toFixed(0) : '0'}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Table helpers ──────────────────────────────────────────────────────────────
function ShimmerCell({ w = 'w-12' }: { w?: string }) {
  return <span className={`inline-block h-3.5 ${w} bg-slate-200 rounded animate-pulse`} />
}
function ExitBtn({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }} title={title ?? 'Close this position'}
      className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors whitespace-nowrap">
      ✕ Exit
    </button>
  )
}

function StockLegsTable({ legs, symbol, onClose }: { legs: StockLeg[]; symbol: string; onClose: (symbol: string, leg: StockLeg) => void }) {
  const { t } = useLanguage()
  if (legs.length === 0) return null
  return (
    <div className="overflow-x-auto border-b border-slate-100">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="th-left"><span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold pl-4 py-2 block">Stock / ETF</span></th>
            <th className="th text-[10px]">{t('col_shares')}</th>
            <th className="th text-[10px]">{t('col_cost')}</th>
            <th className="th text-[10px]">{t('col_mkt_value')}</th>
            <th className="th text-[10px]">{t('col_delta_exp')}</th>
            <th className="th text-[10px]">{/* Exit */}</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => (
            <tr key={leg.instrument_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
              <td className="td-left"><span className="px-2 py-0.5 rounded-md text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">STOCK</span></td>
              <td className="td"><span className={`font-semibold ${leg.net_shares > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{leg.net_shares > 0 ? '+' : ''}{leg.net_shares}</span></td>
              <td className="td text-slate-500">${fmtNum(leg.avg_open_price)}</td>
              <td className="td text-slate-700">{leg.market_value != null ? fmtUSD(leg.market_value) : <span className="text-slate-300">—</span>}</td>
              <td className="td"><span className={`font-semibold ${parseFloat(leg.delta_exposure) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtNum(leg.delta_exposure)}</span></td>
              <td className="td pr-3"><ExitBtn onClick={() => onClose(symbol, leg)} title={`Close ${Math.abs(leg.net_shares)} shares of ${symbol}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Holdings table ─────────────────────────────────────────────────────────────
function HoldingsTable({ groups }: { groups: HoldingGroup[] }) {
  const { t }  = useLanguage()
  const navigate = useNavigate()
  const { lastSpotChangePct } = useWebSocket()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (sym: string) => setCollapsed((prev) => {
    const next = new Set(prev); next.has(sym) ? next.delete(sym) : next.add(sym); return next
  })
  const sumGreekExp = (legs: OptionLeg[], field: 'gamma' | 'theta'): number =>
    legs.reduce((acc, leg) => { const v = leg[field]; if (v == null) return acc; return acc + parseFloat(v) * leg.net_contracts * 100 }, 0)

  if (groups.length === 0) return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center text-slate-400 text-sm">{t('no_positions')}</div>
  )

  const SECTION_LABELS: Record<string, string> = { IRON_CONDOR: 'Iron Condors', VERTICAL: 'Vertical Spreads', STRADDLE: 'Straddles', STRANGLE: 'Strangles', CALENDAR: 'Calendar Spreads', CUSTOM: 'Custom Multi-Leg', SINGLE: 'Single Positions' }
  const STRATEGY_ORDER = ['IRON_CONDOR', 'VERTICAL', 'STRADDLE', 'STRANGLE', 'CALENDAR', 'CUSTOM', 'SINGLE']
  const sorted = [...groups].sort((a, b) => (STRATEGY_ORDER.indexOf(a.strategy_type) ?? 9) - (STRATEGY_ORDER.indexOf(b.strategy_type) ?? 9))
  let lastST = ''; const sectionStarts = new Set<string>()
  for (const g of sorted) { if (g.strategy_type !== lastST) { sectionStarts.add(g.symbol); lastST = g.strategy_type } }

  return (
    <div className="space-y-3">
      {sorted.map((group) => {
        const isCollapsed = collapsed.has(group.symbol)
        const hasStocks   = group.stock_legs.length > 0
        const hasOptions  = group.option_legs.length > 0
        const totalGamma  = sumGreekExp(group.option_legs, 'gamma')
        const totalTheta  = sumGreekExp(group.option_legs, 'theta')
        return (
          <div key={group.symbol}>
            {sectionStarts.has(group.symbol) && (
              <div className="flex items-center gap-2 mt-2 mb-1">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{SECTION_LABELS[group.strategy_type] || group.strategy_type}</span>
                <div className="flex-1 border-t border-slate-200" />
              </div>
            )}
            <div className={`bg-white border border-slate-200 border-l-4 ${parseFloat(group.total_delta_exposure) > 0 ? 'border-l-emerald-400' : 'border-l-rose-400'} rounded-2xl overflow-hidden shadow-sm`}>
              {/* Group header */}
              <button onClick={() => toggle(group.symbol)} className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60 hover:bg-slate-100/60 transition-colors text-left">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`text-slate-400 text-xs transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                  <span className="font-bold text-slate-900 text-base">{group.symbol}</span>
                  {group.spot_price
                    ? <span className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 tabular-nums">${fmtNum(group.spot_price)}</span>
                        {lastSpotChangePct?.[group.symbol] != null && (() => {
                          const pct = parseFloat(lastSpotChangePct![group.symbol])
                          return <span className={`text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded-full ${pct >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                        })()}
                      </span>
                    : <ShimmerCell w="w-14" />
                  }
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-semibold border border-slate-200">{group.option_legs.length + group.stock_legs.length} legs</span>
                  {group.option_legs.length > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-slate-100 text-slate-500">{group.strategy_label}</span>}
                </div>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  {group.capital_efficiency && (
                    <div className="text-right">
                      <div className="text-slate-400 uppercase tracking-wider text-[10px] mb-0.5">{t('cap_efficiency')}</div>
                      <span className="px-1.5 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-700">{(parseFloat(group.capital_efficiency) * 100).toFixed(2)}%</span>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-slate-400 uppercase tracking-wider text-[10px]">{t('delta_exposure')}</div>
                    <div className={`font-bold text-sm ${signClass(group.total_delta_exposure)}`}>{fmtNum(group.total_delta_exposure)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400 uppercase tracking-wider text-[10px]">{t('margin_req')}</div>
                    <div className="text-slate-700 font-semibold">{fmtUSD(group.total_maintenance_margin)}</div>
                  </div>
                </div>
              </button>

              {/* Expanded body */}
              {!isCollapsed && (
                <>
                  {hasStocks && (
                    <StockLegsTable
                      legs={group.stock_legs}
                      symbol={group.symbol}
                      onClose={(s, l) => navigate('/trade', { state: { closePosition: { symbol: s, instrumentType: 'STOCK', action: l.net_shares < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE', quantity: String(Math.abs(l.net_shares)) } } })}
                    />
                  )}
                  {hasOptions && (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="th-left">{t('col_type')}</th>
                            <th className="th">{t('col_strike')}</th>
                            <th className="th">{t('col_expiry')}</th>
                            <th className="th">{t('col_dte')}</th>
                            <th className="th">{t('col_net_qty')}</th>
                            <th className="th">{t('col_cost')}</th>
                            <th className="th">{t('col_delta')}</th>
                            <th className="th">{t('col_delta_exp')}</th>
                            <th className="th">{t('col_theta')}</th>
                            <th className="th">{t('col_margin')}</th>
                            <th className="th">{/* Exit */}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.option_legs.map((leg) => (
                            <tr key={leg.instrument_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                              <td className="td-left">
                                <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${leg.option_type === 'PUT' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-primary-soft text-primary border-primary/20'}`}>{leg.option_type}</span>
                              </td>
                              <td className="td text-slate-800">${fmtNum(leg.strike)}</td>
                              <td className="td text-slate-500 text-xs">{leg.expiry}</td>
                              <td className="td">
                                <span className={`inline-block px-1.5 py-0.5 rounded-md text-xs font-semibold ${dteBadgeClass(leg.days_to_expiry)}`}>{leg.days_to_expiry}d</span>
                              </td>
                              <td className="td">
                                <span className={`font-semibold ${leg.net_contracts < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{leg.net_contracts > 0 ? '+' : ''}{leg.net_contracts}</span>
                              </td>
                              <td className="td text-slate-500">${fmtNum(leg.avg_open_price)}</td>
                              <td className="td text-slate-700">{leg.delta != null ? fmtGreek(leg.delta) : '—'}</td>
                              <td className="td">
                                <span className={`font-semibold ${parseFloat(leg.delta_exposure || '0') > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtNum(leg.delta_exposure)}</span>
                              </td>
                              <td className="td text-amber-600">{leg.theta != null ? fmtGreek(leg.theta) : '—'}</td>
                              <td className="td text-slate-500">{fmtUSD(leg.maintenance_margin)}</td>
                              <td className="td pr-3">
                                <ExitBtn
                                  onClick={() => navigate('/trade', { state: { closePosition: { symbol: group.symbol, instrumentType: 'OPTION', optionType: leg.option_type, strike: leg.strike, expiry: leg.expiry, action: leg.net_contracts < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE', quantity: String(Math.abs(leg.net_contracts)) } } })}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-100 bg-slate-50/60">
                            <td colSpan={6} className="td-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Σ Exposure</td>
                            <td className="td"><div className="text-[10px] text-slate-400 uppercase tracking-wider">Γ</div><div className={`text-xs font-semibold tabular-nums ${totalGamma > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{totalGamma.toFixed(2)}</div></td>
                            <td className="td" />
                            <td className="td"><div className="text-[10px] text-slate-400 uppercase tracking-wider">Θ/d</div><div className={`text-xs font-semibold tabular-nums ${totalTheta > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{totalTheta.toFixed(2)}</div></td>
                            <td className="td" /><td className="td" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Settlement history ─────────────────────────────────────────────────────────
const STATUS_CLASSES: Record<string, string> = {
  EXPIRED:  'bg-slate-100 text-slate-500 border border-slate-200',
  ASSIGNED: 'bg-amber-50 text-amber-700 border border-amber-200',
  CLOSED:   'bg-slate-100 text-slate-400 border border-slate-200',
  ACTIVE:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
}
function SettledTradesSection({ portfolioId }: { portfolioId: number | null | undefined }) {
  const { t } = useLanguage()
  const [open,       setOpen]       = useState(false)
  const [trades,     setTrades]     = useState<SettledTrade[]>([])
  const [loading,    setLoading]    = useState(false)
  const [sinceHours, setSinceHours] = useState<24 | null>(24)

  function load(h: 24 | null) {
    setLoading(true)
    fetchSettledTrades(portfolioId, h).then((r) => setTrades(r.trades)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { if (open) load(sinceHours) }, [open, portfolioId, sinceHours]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('settled_history')}</span>
          {trades.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">{trades.length}</span>}
        </div>
        <span className={`text-slate-400 text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          <div className="flex items-center justify-end gap-1 px-5 pt-2.5 pb-1.5">
            {([24, null] as Array<24 | null>).map((h) => (
              <button key={String(h)} onClick={() => setSinceHours(h)}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${sinceHours === h ? 'bg-primary-soft text-primary border border-primary/20' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
                {h === 24 ? t('settled_24h') : t('settled_all_hist')}
              </button>
            ))}
          </div>
          {loading
            ? <div className="h-16 flex items-center justify-center animate-pulse bg-slate-50" />
            : trades.length === 0
              ? <div className="py-8 text-center text-xs text-slate-400">{t('no_settled')}</div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="th-left text-[10px]">Symbol</th>
                        <th className="th text-[10px]">Type</th>
                        <th className="th text-[10px]">Qty</th>
                        <th className="th text-[10px]">Status</th>
                        <th className="th text-[10px]">Premium</th>
                        <th className="th text-[10px]">Eff.Cost</th>
                        <th className="th text-[10px]">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((row) => (
                        <tr key={row.trade_event_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="td-left font-bold text-slate-900 text-sm">{row.symbol}</td>
                          <td className="td">
                            {row.option_type
                              ? <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold border ${row.option_type === 'PUT' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-primary-soft text-primary border-primary/20'}`}>{row.option_type}</span>
                              : <span className="px-1.5 py-0.5 rounded-md text-xs font-bold border bg-teal-50 text-teal-700 border-teal-200">STOCK</span>}
                          </td>
                          <td className="td">
                            <span className={`font-semibold text-xs ${row.action === 'SELL_OPEN' ? 'text-rose-600' : 'text-emerald-600'}`}>{row.action === 'SELL_OPEN' ? '-' : '+'}{row.quantity}</span>
                          </td>
                          <td className="td">
                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${STATUS_CLASSES[row.status] ?? ''}`}>{row.status}</span>
                          </td>
                          <td className="td text-xs">{row.premium_per_share ? `$${fmtNum(row.premium_per_share)}` : '—'}</td>
                          <td className="td text-xs">{row.effective_cost_per_share ? `$${fmtNum(row.effective_cost_per_share)}` : '—'}</td>
                          <td className="td text-slate-400 text-xs">{row.settled_date ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          }
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function HoldingsPage() {
  const { selectedPortfolioId, refreshKey, triggerRefresh } = usePortfolio()
  const { lang, t } = useLanguage()
  const { lastHoldingsUpdate, lastSpotChangePct } = useWebSocket()

  // ── Shadow caches ────────────────────────────────────────────────────────────
  const lastValidHoldings = useRef<HoldingGroup[]>([])
  const lastValidMetrics  = useRef<HeroMetrics | null>(null)
  // Accumulates spot % changes across WS reconnects so prices never disappear
  const lastValidSpots    = useRef<Record<string, string>>({})

  const [activeTab,       setActiveTab]       = useState<Tab>('overview')
  const [holdings,        setHoldings]        = useState<HoldingGroup[]>([])
  const [cash,            setCash]            = useState<CashSummary | null>(null)
  const [riskDash,        setRiskDash]        = useState<RiskDashboard | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [period,          setPeriod]          = useState<Period>('1d')
  const [lifecycleResult, setLifecycleResult] = useState<LifecycleResult | null>(null)

  // Merge new spots into persistent cache whenever WS delivers them
  useEffect(() => {
    if (lastSpotChangePct) lastValidSpots.current = { ...lastValidSpots.current, ...lastSpotChangePct }
  }, [lastSpotChangePct])

  // Use live holdings state; fall back to shadow ref when state is momentarily empty
  const activeHoldings = holdings.length > 0 ? holdings : lastValidHoldings.current

  // ── 1. Initial REST load ───────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchHoldings(selectedPortfolioId),
      fetchCash(selectedPortfolioId),
      fetchRiskDashboard(selectedPortfolioId).catch(() => null),
    ]).then(([h, c, r]) => {
      const data = Array.isArray(h) ? h : []
      setHoldings(data); lastValidHoldings.current = data
      setCash(c ?? null); setRiskDash(r ?? null)
    }).finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  // ── 2. Real-time WS sync (isCold guard) ───────────────────────────────────
  // Reject a push where every holding reports 0 perf — backend cache not warm yet.
  useEffect(() => {
    if (lastHoldingsUpdate?.portfolioId !== selectedPortfolioId) return
    const newData = lastHoldingsUpdate.data
    const isCold  = newData.length > 0 && newData.every((g) => safeFloat(g.effective_perf_1d) === 0)
    if (!isCold) { setHoldings(newData); lastValidHoldings.current = newData }
  }, [lastHoldingsUpdate, selectedPortfolioId])

  // ── 3. i18n smart merge (silent, per-symbol perf preservation) ────────────
  // When backend returns 0 perf for a symbol (cache miss), graft the old perf value
  // from lastValidHoldings so the Treemap never flashes all-green 0%.
  useEffect(() => {
    if (selectedPortfolioId === null) return
    let cancelled = false
    Promise.all([fetchHoldings(selectedPortfolioId), fetchCash(selectedPortfolioId)]).then(([h, c]) => {
      if (cancelled || !Array.isArray(h)) return
      const merged = h.map((newG) => {
        const oldG = lastValidHoldings.current.find((p) => p.symbol === newG.symbol)
        if (safeFloat(newG.effective_perf_1d) === 0 && oldG) {
          return { ...newG, effective_perf_1d: oldG.effective_perf_1d, effective_perf_5d: oldG.effective_perf_5d }
        }
        return newG
      })
      setHoldings(merged); lastValidHoldings.current = merged
      if (c) setCash(c)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, selectedPortfolioId])

  // ── 4. Lifecycle sweep (once per session) ─────────────────────────────────
  useEffect(() => {
    if (selectedPortfolioId === null || _lifecycleCalledThisSession) return
    _lifecycleCalledThisSession = true
    triggerLifecycle().then((result) => {
      setLifecycleResult(result)
      if (result.expired + result.assigned > 0) triggerRefresh()
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortfolioId])

  // ── 5. Hero metrics ────────────────────────────────────────────────────────
  // Use persisted spots when WS hasn't reconnected yet (prevents flash-to-zero).
  const heroMetrics = useMemo<HeroMetrics>(() => {
    let dailyUnrealizedPnl = 0
    let netExposure        = 0
    let portfolioValue     = 0
    const currentSpots = (lastSpotChangePct && Object.keys(lastSpotChangePct).length > 0)
      ? lastSpotChangePct : lastValidSpots.current

    for (const g of activeHoldings) {
      const exposure = safeFloat(g.delta_adjusted_exposure) ?? 0
      netExposure += exposure
      const pctStr = currentSpots?.[g.symbol]
      const pct    = pctStr != null ? parseFloat(pctStr) : (safeFloat(g.effective_perf_1d) ?? 0)
      if (isFinite(pct)) dailyUnrealizedPnl += exposure * pct / 100
      for (const sl of g.stock_legs ?? []) {
        const mv = safeFloat(sl.market_value); if (mv != null) portfolioValue += Math.abs(mv)
      }
      for (const ol of g.option_legs ?? []) {
        const cost = safeFloat(ol.avg_open_price); const qty = Math.abs(ol.net_contracts)
        if (cost != null && qty > 0) portfolioValue += cost * qty * 100
      }
    }
    const realized = safeFloat(cash?.realized_pnl) ?? 0
    const result: HeroMetrics = {
      dailyUnrealizedPnl, netExposure, portfolioValue, realizedPnl: realized,
      dailyUnrealizedPnlPct: portfolioValue > 0 ? (dailyUnrealizedPnl / portfolioValue) * 100 : null,
      realizedPnlPct:        portfolioValue > 0 ? (realized / portfolioValue) * 100 : null,
    }
    // Sticky patch: if WS reconnect yields momentary 0 but positions exist, hold last value
    if (dailyUnrealizedPnl === 0 && activeHoldings.length > 0 && lastValidMetrics.current) return lastValidMetrics.current
    lastValidMetrics.current = result; return result
  }, [activeHoldings, cash, lastSpotChangePct])

  // ── 6. Treemap data ────────────────────────────────────────────────────────
  const treemapData = useMemo(() => {
    const currentSpots = (lastSpotChangePct && Object.keys(lastSpotChangePct).length > 0)
      ? lastSpotChangePct : lastValidSpots.current
    return activeHoldings
      .filter((g) => g?.symbol && (safeFloat(g.delta_adjusted_exposure) ?? 0) > 0)
      .map((g) => {
        const isShort    = g.is_short === true
        const staticPerf = getEffectivePerf(g, period)
        const wsCP       = currentSpots?.[g.symbol] != null
          ? parseFloat(currentSpots[g.symbol]) * (isShort ? -1 : 1)
          : null
        const rawPerf = getRawPerf(g, period)
        return {
          name:     g.symbol,
          size:     safeFloat(g.delta_adjusted_exposure) ?? 0,
          perf:     wsCP != null ? wsCP : (staticPerf ?? 0),
          rawPerf:  rawPerf ?? (wsCP ?? 0),
          exposure: safeFloat(g.delta_adjusted_exposure) ?? 0,
          isShort,
        }
      })
      .sort((a, b) => b.size - a.size)
  }, [activeHoldings, period, lastSpotChangePct])

  const isEn          = lang !== 'zh'
  const hadSettlement = lifecycleResult && lifecycleResult.expired + lifecycleResult.assigned > 0

  return (
    <div className="max-w-7xl mx-auto font-sans space-y-4">

      {/* Lifecycle notice */}
      {hadSettlement && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs">
          <span className="text-amber-700 font-semibold">{t('lifecycle_notice')}</span>
          <span className="text-slate-500">
            {lifecycleResult!.expired  > 0 && <span className="mr-3">{lifecycleResult!.expired} expired</span>}
            {lifecycleResult!.assigned > 0 && <span className="text-amber-700 font-semibold">{lifecycleResult!.assigned} assigned</span>}
          </span>
        </div>
      )}

      {/* Tab header */}
      <div className="flex items-center border-b border-slate-200">
        {([{ key: 'overview', en: 'Overview', zh: '总览' }, { key: 'details', en: 'Details', zh: '持仓明细' }] as const).map(({ key, en, zh }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-5 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px ${activeTab === key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {isEn ? en : zh}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        loading
          ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-white border border-slate-200 rounded-2xl animate-pulse" />)}</div>
          : (
            <div className="space-y-5">
              {/* Hero Banner */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  label={isEn ? 'Portfolio Value' : '持仓总市值'}
                  value={fmtUSD(String(Math.round(heroMetrics.portfolioValue)))}
                  sub={isEn ? 'Stocks MtM + Options basis' : '标的当前估算公允价值'}
                />
                <StatCard
                  label={isEn ? 'Net Exposure' : '净敞口总额'}
                  value={fmtUSD(String(Math.round(Math.abs(heroMetrics.netExposure))))}
                  sub={isEn ? 'Σ delta-adjusted notional' : 'Σ Delta加权名义敞口'}
                  valueClass={heroMetrics.netExposure >= 0 ? 'text-slate-900' : 'text-rose-600'}
                />
                <StatCard
                  label={isEn ? 'Daily Unrealized P&L' : '今日浮盈变动'}
                  value={(heroMetrics.dailyUnrealizedPnl >= 0 ? '+' : '') + fmtUSD(String(Math.round(heroMetrics.dailyUnrealizedPnl)))}
                  sub={
                    heroMetrics.dailyUnrealizedPnlPct != null && heroMetrics.dailyUnrealizedPnl !== 0
                      ? `${heroMetrics.dailyUnrealizedPnlPct >= 0 ? '+' : ''}${heroMetrics.dailyUnrealizedPnlPct.toFixed(2)}% ${isEn ? 'of port' : '占持仓'}`
                      : isEn ? 'Intraday fluctuation' : '持仓较昨收变动'
                  }
                  valueClass={heroMetrics.dailyUnrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                />
                <StatCard
                  label={isEn ? 'Total Realized P&L' : '累计已实现盈亏'}
                  value={(heroMetrics.realizedPnl >= 0 ? '+' : '') + fmtUSD(String(Math.round(heroMetrics.realizedPnl)))}
                  sub={
                    heroMetrics.realizedPnlPct != null && heroMetrics.realizedPnl !== 0
                      ? `${heroMetrics.realizedPnlPct >= 0 ? '+' : ''}${heroMetrics.realizedPnlPct.toFixed(2)}% ${isEn ? 'return' : '总收益率'}`
                      : isEn ? 'From closed trades' : '仅含已平仓收益'
                  }
                  valueClass={heroMetrics.realizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                />
              </div>

              <PortfolioHistoryChart portfolioId={selectedPortfolioId} />

              {/* Exposure Treemap */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{isEn ? 'Exposure Map' : '敞口地图'}</span>
                  <div className="flex gap-1">
                    {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${period === p ? 'bg-primary-soft text-primary border border-primary/20' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
                        {isEn ? PERIOD_LABELS[p].en : PERIOD_LABELS[p].zh}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="px-3 pb-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <Treemap data={treemapData} dataKey="size" stroke="#fff" content={CustomCell}>
                      <Tooltip content={<TreemapTooltip />} />
                    </Treemap>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SectorPieChart sectorExp={riskDash?.sector_exposure} isEn={isEn} />
                <StrategyPieChart holdings={activeHoldings} isEn={isEn} />
              </div>

              <AiInsightPanel holdings={activeHoldings} />
            </div>
          )
      )}

      {/* Details */}
      {activeTab === 'details' && (
        <div className="space-y-5">
          <HoldingsTable groups={activeHoldings} />
          <SettledTradesSection portfolioId={selectedPortfolioId} />
        </div>
      )}
    </div>
  )
}
