/**
 * DetailsPage — Active positions table + settled trade history
 * Route: /holdings
 *
 * Extracted from HoldingsPage.tsx to be the "Details" counterpart
 * of the new OverviewPage. Contains:
 *  - MarketTicker
 *  - CashCard
 *  - PortfolioHistoryChart
 *  - HoldingsTable (with stock + option legs)
 *  - SettledTradesSection
 */

// Module-level singleton: lifecycle sweep fires at most once per browser session.
let _lifecycleCalledThisSession = false

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchHoldings, fetchCash, fetchSettledTrades, triggerLifecycle } from '@/api/holdings'
import type {
  HoldingGroup, OptionLeg, StockLeg, CashSummary,
  TradeAction, ClosePositionState, SettledTrade, LifecycleResult,
} from '@/types'
import { fmtUSD, fmtNum, fmtGreek, dteBadgeClass, signClass } from '@/utils/format'
import PortfolioHistoryChart from '@/components/PortfolioHistoryChart'
import MarketTicker from '@/components/MarketTicker'

// ── Helpers ───────────────────────────────────────────────────────────────────

function sumGreekExposure(legs: OptionLeg[], field: 'gamma' | 'theta'): number {
  return legs.reduce((acc, leg) => {
    const v = leg[field]
    if (v == null) return acc
    return acc + parseFloat(v) * leg.net_contracts * 100
  }, 0)
}

function fmtGreekExp(value: number): string {
  if (!isFinite(value)) return '—'
  const abs = Math.abs(value)
  return (value >= 0 ? '+' : '') + (abs >= 1000 ? value.toFixed(1) : value.toFixed(3))
}

function fmtEfficiency(raw: string | null): string | null {
  if (raw == null) return null
  const v = parseFloat(raw)
  if (!isFinite(v) || v === 0) return null
  return (v * 100).toFixed(4) + '%'
}

function efficiencyClass(raw: string | null): string {
  if (raw == null) return 'bg-slate-100 text-slate-500 border border-slate-200'
  const pct = parseFloat(raw) * 100
  if (pct >= 0.04) return 'bg-amber-50 text-amber-700 border border-amber-200'
  if (pct >= 0.01) return 'bg-sky-50 text-sky-700 border border-sky-200'
  return 'bg-slate-100 text-slate-500 border border-slate-200'
}

function ShimmerCell({ w = 'w-12' }: { w?: string }) {
  return <span className={`inline-block h-3.5 ${w} bg-slate-200 rounded animate-pulse`} />
}

function ExitBtn({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title ?? 'Close this position'}
      className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-400
                 hover:text-rose-600 hover:bg-rose-50 border border-transparent
                 hover:border-rose-200 transition-colors whitespace-nowrap"
    >
      ✕ Exit
    </button>
  )
}

// ── Cash card ─────────────────────────────────────────────────────────────────
function CashCard({ cash }: { cash: CashSummary | null }) {
  const { t } = useLanguage()
  if (!cash) return <div className="animate-pulse h-28 bg-white rounded-2xl border border-slate-200 shadow-sm" />

  const balance = parseFloat(cash.balance)
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('cash_balance')}
        </span>
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border
          ${balance >= 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
          {balance >= 0 ? t('net_long_cash') : t('net_short_cash')}
        </span>
      </div>
      <div className="text-3xl font-bold tabular-nums text-slate-900">{fmtUSD(cash.balance)}</div>
      <div className="space-y-1 pt-1 border-t border-slate-100">
        {cash.entries.slice(0, 3).map((e) => {
          const amt = parseFloat(e.amount)
          return (
            <div key={e.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-500 truncate max-w-xs">{e.description}</span>
              <span className={`tabular-nums font-semibold ${amt >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {amt >= 0 ? '+' : ''}{fmtUSD(e.amount)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Stock legs table ──────────────────────────────────────────────────────────
function StockLegsTable({ legs, symbol, onClose }: {
  legs: StockLeg[]; spot?: string | null; symbol: string
  onClose: (symbol: string, leg: StockLeg) => void
}) {
  const { t } = useLanguage()
  if (legs.length === 0) return null
  return (
    <div className="overflow-x-auto border-b border-slate-100">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="th-left">
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold pl-4 py-2 block">
                Stock / ETF
              </span>
            </th>
            <th className="th text-[10px]">{t('col_shares')}</th>
            <th className="th text-[10px]">{t('col_cost')}</th>
            <th className="th text-[10px]">{t('col_mkt_value')}</th>
            <th className="th text-[10px]">{t('col_delta_exp')}</th>
            <th className="th text-[10px]">{/* Exit */}</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => {
            const isLong   = leg.net_shares > 0
            const deltaPos = parseFloat(leg.delta_exposure) > 0
            return (
              <tr key={leg.instrument_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="td-left">
                  <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">STOCK</span>
                </td>
                <td className="td">
                  <span className={`font-semibold ${isLong ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {leg.net_shares > 0 ? '+' : ''}{leg.net_shares}
                  </span>
                </td>
                <td className="td text-slate-500">${fmtNum(leg.avg_open_price)}</td>
                <td className="td text-slate-700">
                  {leg.market_value != null ? fmtUSD(leg.market_value) : <span className="text-slate-300">—</span>}
                </td>
                <td className="td">
                  <span className={`font-semibold ${deltaPos ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {fmtNum(leg.delta_exposure)}
                  </span>
                </td>
                <td className="td pr-3">
                  <ExitBtn onClick={() => onClose(symbol, leg)} title={`Close ${Math.abs(leg.net_shares)} shares of ${symbol}`} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Holdings table ────────────────────────────────────────────────────────────
function HoldingsTable({ groups }: { groups: HoldingGroup[] }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { lastSpotChangePct } = useWebSocket()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (sym: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(sym) ? next.delete(sym) : next.add(sym)
      return next
    })

  function closeOption(symbol: string, leg: OptionLeg) {
    const qty: number = Math.abs(leg.net_contracts)
    const action: TradeAction = leg.net_contracts < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    const state: ClosePositionState = {
      symbol, instrumentType: 'OPTION', optionType: leg.option_type,
      strike: leg.strike, expiry: leg.expiry, action, quantity: String(qty),
    }
    navigate('/trade', { state: { closePosition: state } })
  }

  function closeStock(symbol: string, leg: StockLeg) {
    const qty: number = Math.abs(leg.net_shares)
    const action: TradeAction = leg.net_shares < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    const state: ClosePositionState = { symbol, instrumentType: 'STOCK', action, quantity: String(qty) }
    navigate('/trade', { state: { closePosition: state } })
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center text-slate-400 text-sm">
        {t('no_positions')}
      </div>
    )
  }

  const STRATEGY_ORDER: Record<string, number> = {
    IRON_CONDOR: 0, VERTICAL: 1, STRADDLE: 2, STRANGLE: 3, CALENDAR: 4, CUSTOM: 5, SINGLE: 6,
  }
  const sortedGroups = [...groups].sort(
    (a, b) => (STRATEGY_ORDER[a.strategy_type] ?? 9) - (STRATEGY_ORDER[b.strategy_type] ?? 9),
  )
  const sectionStarts = new Set<string>()
  let lastStrategyType = ''
  for (const g of sortedGroups) {
    if (g.strategy_type !== lastStrategyType) {
      sectionStarts.add(g.symbol)
      lastStrategyType = g.strategy_type
    }
  }
  const SECTION_LABELS: Record<string, string> = {
    IRON_CONDOR: 'Iron Condors', VERTICAL: 'Vertical Spreads',
    STRADDLE: 'Straddles', STRANGLE: 'Strangles',
    CALENDAR: 'Calendar Spreads', CUSTOM: 'Custom Multi-Leg',
    SINGLE: 'Single Positions',
  }

  function strategyBadgeClass(type: string): string {
    switch (type) {
      case 'IRON_CONDOR': return 'bg-violet-50 text-violet-700 border-violet-200'
      case 'VERTICAL':    return 'bg-sky-50 text-sky-700 border-sky-200'
      case 'STRADDLE':    return 'bg-amber-50 text-amber-700 border-amber-200'
      case 'STRANGLE':    return 'bg-orange-50 text-orange-700 border-orange-200'
      case 'CALENDAR':    return 'bg-teal-50 text-teal-700 border-teal-200'
      case 'CUSTOM':      return 'bg-pink-50 text-pink-700 border-pink-200'
      default:            return 'bg-slate-100 text-slate-500 border-slate-200'
    }
  }

  return (
    <div className="space-y-3">
      {sortedGroups.map((group) => {
        const isCollapsed   = collapsed.has(group.symbol)
        const deltaVal      = parseFloat(group.total_delta_exposure)
        const deltaPositive = deltaVal > 0
        const accentClass   = deltaPositive ? 'border-l-emerald-400' : 'border-l-rose-400'

        const totalGamma    = sumGreekExposure(group.option_legs, 'gamma')
        const totalTheta    = sumGreekExposure(group.option_legs, 'theta')
        const totalLegs     = group.option_legs.length + group.stock_legs.length
        const hasOptions    = group.option_legs.length > 0
        const hasStocks     = group.stock_legs.length > 0
        const greeksLoading = hasOptions && group.option_legs.some((l) => l.delta == null)

        return (
          <div key={group.symbol}>
            {sectionStarts.has(group.symbol) && (
              <div className="flex items-center gap-2 mt-2 mb-1">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
                  {SECTION_LABELS[group.strategy_type] ?? group.strategy_type}
                </span>
                <div className="flex-1 border-t border-slate-200" />
              </div>
            )}
            <div className={`bg-white border border-slate-200 border-l-4 ${accentClass} rounded-2xl overflow-hidden shadow-sm`}>
              {/* Group header */}
              <button
                onClick={() => toggle(group.symbol)}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-100
                           bg-slate-50/60 hover:bg-slate-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`text-slate-400 text-xs transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                  <span className="font-bold text-slate-900 text-base">{group.symbol}</span>
                  {group.spot_price ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500 tabular-nums">${fmtNum(group.spot_price)}</span>
                      {lastSpotChangePct?.[group.symbol] != null && (() => {
                        const pct = parseFloat(lastSpotChangePct![group.symbol])
                        return (
                          <span className={`text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded-full
                            ${pct >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </span>
                        )
                      })()}
                    </span>
                  ) : (
                    <ShimmerCell w="w-14" />
                  )}
                  <span
                    role="button" tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate('/risk', { state: { prefillAlert: { symbol: group.symbol, spotPrice: group.spot_price } } })
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click() }}
                    title={`${t('alert_set_for')} ${group.symbol}`}
                    className="cursor-pointer px-1 py-0.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-semibold border border-slate-200">
                    {totalLegs} leg{totalLegs !== 1 ? 's' : ''}
                  </span>
                  {group.option_legs.length > 0 && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${strategyBadgeClass(group.strategy_type)}`}>
                      {group.strategy_label}
                    </span>
                  )}
                  {hasStocks && hasOptions && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-semibold">+stock</span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs tabular-nums">
                  {fmtEfficiency(group.capital_efficiency) && (
                    <div className="text-right">
                      <div className="text-slate-400 uppercase tracking-wider text-[10px] mb-0.5">{t('cap_efficiency')}</div>
                      <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold ${efficiencyClass(group.capital_efficiency)}`}>
                        {fmtEfficiency(group.capital_efficiency)}
                      </span>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-slate-400 uppercase tracking-wider text-[10px]">{t('delta_exposure')}</div>
                    {greeksLoading ? (
                      <ShimmerCell w="w-16" />
                    ) : (
                      <div className={`font-bold text-sm ${signClass(group.total_delta_exposure)}`}>
                        {fmtNum(group.total_delta_exposure)}
                      </div>
                    )}
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
                    <StockLegsTable legs={group.stock_legs} spot={group.spot_price} symbol={group.symbol} onClose={closeStock} />
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
                          {group.option_legs.map((leg) => {
                            const isShort  = leg.net_contracts < 0
                            const deltaPos = leg.delta_exposure != null && parseFloat(leg.delta_exposure) > 0
                            return (
                              <tr key={leg.instrument_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                <td className="td-left">
                                  <span className={`px-2 py-0.5 rounded-md text-xs font-bold border
                                    ${leg.option_type === 'PUT'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-primary-soft text-primary border-primary/20'}`}>
                                    {leg.option_type}
                                  </span>
                                </td>
                                <td className="td text-slate-800">${fmtNum(leg.strike)}</td>
                                <td className="td text-slate-500 text-xs">{leg.expiry}</td>
                                <td className="td">
                                  <span className={`inline-block px-1.5 py-0.5 rounded-md text-xs font-semibold ${dteBadgeClass(leg.days_to_expiry)}`}>
                                    {leg.days_to_expiry}d
                                  </span>
                                </td>
                                <td className="td">
                                  <span className={`font-semibold ${isShort ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {leg.net_contracts > 0 ? '+' : ''}{leg.net_contracts}
                                  </span>
                                </td>
                                <td className="td text-slate-500">${fmtNum(leg.avg_open_price)}</td>
                                <td className="td text-slate-700">
                                  {leg.delta != null ? <span>{fmtGreek(leg.delta)}</span> : <ShimmerCell />}
                                </td>
                                <td className="td">
                                  {leg.delta_exposure != null ? (
                                    <span className={`font-semibold ${deltaPos ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      {fmtNum(leg.delta_exposure)}
                                    </span>
                                  ) : <ShimmerCell />}
                                </td>
                                <td className="td text-amber-600">
                                  {leg.theta != null ? <span>{fmtGreek(leg.theta)}</span> : <ShimmerCell />}
                                </td>
                                <td className="td text-slate-500">{fmtUSD(leg.maintenance_margin)}</td>
                                <td className="td pr-3">
                                  <ExitBtn
                                    onClick={() => closeOption(group.symbol, leg)}
                                    title={`Close ${Math.abs(leg.net_contracts)} × ${group.symbol} ${leg.option_type} $${fmtNum(leg.strike)} (${leg.expiry})`}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-100 bg-slate-50/60">
                            <td colSpan={6} className="td-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Σ Exposure</td>
                            <td className="td">
                              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Γ</div>
                              <div className={`text-xs font-semibold tabular-nums ${totalGamma > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {fmtGreekExp(totalGamma)}
                              </div>
                            </td>
                            <td className="td" />
                            <td className="td">
                              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Θ/d</div>
                              <div className={`text-xs font-semibold tabular-nums ${totalTheta > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {fmtGreekExp(totalTheta)}
                              </div>
                            </td>
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

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CLASSES: Record<string, string> = {
  EXPIRED:  'bg-slate-100 text-slate-500 border border-slate-200',
  ASSIGNED: 'bg-amber-50 text-amber-700 border border-amber-200',
  CLOSED:   'bg-slate-100 text-slate-400 border border-slate-200',
  ACTIVE:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-wide
      ${STATUS_CLASSES[status] ?? 'bg-slate-100 text-slate-400 border border-slate-200'}`}>
      {status}
    </span>
  )
}

// ── Settlement history ────────────────────────────────────────────────────────
function SettledTradesSection({ portfolioId }: { portfolioId: number | null | undefined }) {
  const { t } = useLanguage()
  const [open,       setOpen]       = useState(false)
  const [trades,     setTrades]     = useState<SettledTrade[]>([])
  const [loading,    setLoading]    = useState(false)
  const [total,      setTotal]      = useState(0)
  const [sinceHours, setSinceHours] = useState<24 | null>(24)

  function load(hours: 24 | null) {
    setLoading(true)
    fetchSettledTrades(portfolioId, hours)
      .then((r) => { setTrades(r.trades); setTotal(r.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) load(sinceHours)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, portfolioId, sinceHours])

  const hasAssigned = trades.some((r) => r.status === 'ASSIGNED')

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('settled_history')}</span>
          {total > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">{total}</span>
          )}
          {sinceHours === 24 && total > 0 && hasAssigned && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>
        <span className={`text-slate-400 text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          <div className="flex items-center justify-end gap-1 px-5 pt-2.5 pb-1.5">
            {([24, null] as Array<24 | null>).map((h) => (
              <button
                key={String(h)}
                onClick={(e) => { e.stopPropagation(); setSinceHours(h) }}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors
                  ${sinceHours === h
                    ? 'bg-primary-soft text-primary border border-primary/20'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
              >
                {h === 24 ? t('settled_24h') : t('settled_all_hist')}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="h-16 flex items-center justify-center">
              <div className="animate-pulse h-4 w-40 bg-slate-200 rounded" />
            </div>
          ) : trades.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">{t('no_settled')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="th-left text-[10px]">Symbol</th>
                    <th className="th text-[10px]">Type</th>
                    <th className="th text-[10px]">Strike</th>
                    <th className="th text-[10px]">Expiry</th>
                    <th className="th text-[10px]">Dir / Qty</th>
                    <th className="th text-[10px]">{t('settled_status')}</th>
                    <th className="th text-[10px]">{t('settled_assign')}</th>
                    <th className="th text-[10px]">{t('settled_premium')}</th>
                    <th className="th text-[10px]">{t('settled_eff_cost')}</th>
                    <th className="th text-[10px]">{t('settled_date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((row) => {
                    const isShort   = row.action === 'SELL_OPEN'
                    const isBuyOpen = row.auto_stock_action === 'BUY_OPEN'
                    return (
                      <tr key={row.trade_event_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="td-left font-bold text-slate-900 text-sm">{row.symbol}</td>
                        <td className="td">
                          <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold border
                            ${row.option_type === 'PUT'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-primary-soft text-primary border-primary/20'}`}>
                            {row.option_type}
                          </span>
                        </td>
                        <td className="td text-slate-700">${fmtNum(row.strike ?? '0')}</td>
                        <td className="td text-slate-500 text-xs">{row.expiry ?? '—'}</td>
                        <td className="td">
                          <span className={`font-semibold text-xs ${isShort ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {isShort ? '-' : '+'}{row.quantity}
                          </span>
                        </td>
                        <td className="td"><StatusBadge status={row.status} /></td>
                        <td className="td text-xs">
                          {row.auto_stock_action ? (
                            <span className="font-mono text-amber-600 text-[11px]">
                              {row.auto_stock_action.replace('_', ' ')} {row.auto_stock_quantity}sh @ <span className={isBuyOpen ? 'text-rose-600' : 'text-emerald-600'}>${fmtNum(row.auto_stock_price ?? '0')}</span>
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="td text-xs">
                          {row.premium_per_share != null
                            ? <span className="font-mono text-amber-700">${fmtNum(row.premium_per_share)}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="td text-xs">
                          {row.effective_cost_per_share != null
                            ? <span className={`font-mono font-semibold ${isBuyOpen ? 'text-sky-600' : 'text-emerald-600'}`}>${fmtNum(row.effective_cost_per_share)}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="td text-slate-400 text-xs">{row.settled_date ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DetailsPage() {
  const { selectedPortfolioId, refreshKey, triggerRefresh } = usePortfolio()
  const { t } = useLanguage()
  const { lastHoldingsUpdate } = useWebSocket()

  const [holdings,        setHoldings]        = useState<HoldingGroup[]>([])
  const [cash,            setCash]            = useState<CashSummary | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)
  const [lifecycleResult, setLifecycleResult] = useState<LifecycleResult | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([fetchHoldings(selectedPortfolioId), fetchCash(selectedPortfolioId)])
      .then(([h, c]) => { setHoldings(h); setCash(c) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  useEffect(() => {
    if (!lastHoldingsUpdate) return
    if (lastHoldingsUpdate.portfolioId !== selectedPortfolioId) return
    setHoldings(lastHoldingsUpdate.data)
  }, [lastHoldingsUpdate, selectedPortfolioId])

  useEffect(() => {
    if (selectedPortfolioId === null) return
    if (_lifecycleCalledThisSession) return
    _lifecycleCalledThisSession = true
    triggerLifecycle()
      .then((result) => {
        setLifecycleResult(result)
        if (result.expired + result.assigned > 0) triggerRefresh()
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortfolioId])

  const hadSettlement = lifecycleResult && lifecycleResult.expired + lifecycleResult.assigned > 0

  return (
    <div className="max-w-7xl mx-auto space-y-5 font-sans">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('holdings_title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('holdings_sub')}</p>
      </div>

      {hadSettlement && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs">
          <span className="text-amber-700 font-semibold">{t('lifecycle_notice')}</span>
          <span className="text-slate-500">
            {lifecycleResult!.expired > 0 && <span className="mr-3">{lifecycleResult!.expired} expired</span>}
            {lifecycleResult!.assigned > 0 && <span className="text-amber-700 font-semibold">{lifecycleResult!.assigned} assigned</span>}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-rose-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-2xl shadow-sm animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <MarketTicker />
          <CashCard cash={cash} />
          <PortfolioHistoryChart portfolioId={selectedPortfolioId} />
          <HoldingsTable groups={holdings} />
          <SettledTradesSection portfolioId={selectedPortfolioId} />
        </>
      )}
    </div>
  )
}
