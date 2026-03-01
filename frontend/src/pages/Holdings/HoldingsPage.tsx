/**
 * Holdings Page
 *
 * · CashCard   — balance display + recent ledger entries
 * · HoldingsTable — positions grouped by underlying symbol
 *     - Collapsible groups (click header to toggle)
 *     - Header: symbol, spot, total leg count, Δ exposure (color-coded), Eff badge
 *     - Left border accent: green = net long delta, red = net short delta
 *     - StockLegsTable: simplified view (no Strike/Expiry/Greeks) for stock/ETF legs
 *     - Option legs table: full Greek columns
 *     - Footer row per group: Σ Gamma exposure + Σ Daily Theta
 *     - i18n via useLanguage()
 *     - One-click Exit button per leg → navigates to TradeEntry pre-filled for close
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchHoldings, fetchCash, fetchSettledTrades, triggerLifecycle } from '@/api/holdings'
import type {
  HoldingGroup, OptionLeg, StockLeg, CashSummary,
  TradeAction, ClosePositionState, SettledTrade, LifecycleResult,
  PnlDataPoint,
} from '@/types'
import { fmtUSD, fmtNum, fmtGreek, dteBadgeClass, signClass } from '@/utils/format'
import PnlChart from '@/components/PnlChart'
import AiInsightPanel from '@/components/AiInsightPanel'
import MarketTicker from '@/components/MarketTicker'

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  if (raw == null) return 'bg-slate-700 text-slate-400'
  const pct = parseFloat(raw) * 100
  if (pct >= 0.04) return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
  if (pct >= 0.01) return 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30'
  return 'bg-slate-700/60 text-slate-400'
}

// ── Shimmer placeholder for loading Greeks ────────────────────────────────────
function ShimmerCell() {
  return <span className="inline-block h-3.5 w-12 bg-slate-700/60 rounded animate-pulse" />
}

// ── Exit button ────────────────────────────────────────────────────────────────
function ExitBtn({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title ?? 'Close this position'}
      className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-500
                 hover:text-bear hover:bg-bear/10 border border-transparent
                 hover:border-bear/25 transition-colors whitespace-nowrap"
    >
      ✕ Exit
    </button>
  )
}

// ── Cash card ──────────────────────────────────────────────────────────────────
function CashCard({ cash }: { cash: CashSummary | null }) {
  const { t } = useLanguage()
  if (!cash) return <div className="animate-pulse h-28 bg-card rounded-xl border border-line" />

  const balance = parseFloat(cash.balance)
  return (
    <div className="bg-card border border-line rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {t('cash_balance')}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold
          ${balance >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {balance >= 0 ? t('net_long_cash') : t('net_short_cash')}
        </span>
      </div>

      <div className="text-3xl font-bold tabular-nums text-white">
        {fmtUSD(cash.balance)}
      </div>

      <div className="space-y-1 pt-1 border-t border-line">
        {cash.entries.slice(0, 3).map((e) => {
          const amt = parseFloat(e.amount)
          return (
            <div key={e.id} className="flex items-center justify-between text-xs">
              <span className="text-slate-500 truncate max-w-xs">{e.description}</span>
              <span className={`tabular-nums font-semibold ${amt >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {amt >= 0 ? '+' : ''}{fmtUSD(e.amount)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Stock legs table ───────────────────────────────────────────────────────────
function StockLegsTable({
  legs, symbol, onClose,
}: {
  legs: StockLeg[]
  spot?: string | null
  symbol: string
  onClose: (symbol: string, leg: StockLeg) => void
}) {
  const { t } = useLanguage()
  if (legs.length === 0) return null

  return (
    <div className="overflow-x-auto border-b border-line/50">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line bg-slate-800/30">
            <th className="th-left">
              <span className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold pl-4 py-2 block">
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
              <tr key={leg.instrument_id} className="border-b border-line/30 hover:bg-row transition-colors">
                {/* Stock badge */}
                <td className="td-left">
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-teal-500/10 text-teal-400">
                    STOCK
                  </span>
                </td>
                {/* Shares */}
                <td className="td">
                  <span className={`font-semibold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
                    {leg.net_shares > 0 ? '+' : ''}{leg.net_shares}
                  </span>
                </td>
                {/* Avg cost basis */}
                <td className="td text-slate-400">${fmtNum(leg.avg_open_price)}</td>
                {/* Market value */}
                <td className="td text-slate-300">
                  {leg.market_value != null
                    ? fmtUSD(leg.market_value)
                    : <span className="text-slate-600">—</span>}
                </td>
                {/* Delta Exposure (= net_shares) */}
                <td className="td">
                  <span className={`font-semibold ${deltaPos ? 'text-green-400' : 'text-red-400'}`}>
                    {fmtNum(leg.delta_exposure)}
                  </span>
                </td>
                {/* Exit */}
                <td className="td pr-3">
                  <ExitBtn
                    onClick={() => onClose(symbol, leg)}
                    title={`Close ${Math.abs(leg.net_shares)} shares of ${symbol}`}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Holdings table ─────────────────────────────────────────────────────────────
function HoldingsTable({ groups }: { groups: HoldingGroup[] }) {
  const { t }    = useLanguage()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (sym: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(sym) ? next.delete(sym) : next.add(sym)
      return next
    })

  // ── Close helpers ────────────────────────────────────────────────────────
  function closeOption(symbol: string, leg: OptionLeg) {
    const qty: number    = Math.abs(leg.net_contracts)
    const action: TradeAction = leg.net_contracts < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    const state: ClosePositionState = {
      symbol,
      instrumentType: 'OPTION',
      optionType:     leg.option_type,
      strike:         leg.strike,
      expiry:         leg.expiry,
      action,
      quantity:       String(qty),
    }
    navigate('/trade', { state: { closePosition: state } })
  }

  function closeStock(symbol: string, leg: StockLeg) {
    const qty: number    = Math.abs(leg.net_shares)
    const action: TradeAction = leg.net_shares < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    const state: ClosePositionState = {
      symbol,
      instrumentType: 'STOCK',
      action,
      quantity:       String(qty),
    }
    navigate('/trade', { state: { closePosition: state } })
  }

  if (groups.length === 0) {
    return (
      <div className="bg-card border border-line rounded-xl p-10 text-center text-slate-500 text-sm">
        {t('no_positions')}
      </div>
    )
  }

  // ── Strategy grouping: sort groups so multi-leg strategies appear first ──
  const STRATEGY_ORDER: Record<string, number> = {
    IRON_CONDOR: 0, VERTICAL: 1, STRADDLE: 2, STRANGLE: 3, CALENDAR: 4, CUSTOM: 5, SINGLE: 6,
  }
  const sortedGroups = [...groups].sort(
    (a, b) => (STRATEGY_ORDER[a.strategy_type] ?? 9) - (STRATEGY_ORDER[b.strategy_type] ?? 9),
  )
  // Compute which groups start a new strategy section (for section label rendering)
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

  return (
    <div className="space-y-4">
      {sortedGroups.map((group) => {
        const isCollapsed   = collapsed.has(group.symbol)
        const deltaVal      = parseFloat(group.total_delta_exposure)
        const deltaPositive = deltaVal > 0
        const accentClass   = deltaPositive ? 'border-l-bull' : 'border-l-bear'

        const totalGamma = sumGreekExposure(group.option_legs, 'gamma')
        const totalTheta = sumGreekExposure(group.option_legs, 'theta')
        const totalLegs  = group.option_legs.length + group.stock_legs.length
        const hasOptions = group.option_legs.length > 0
        const hasStocks  = group.stock_legs.length > 0
        const greeksLoading = hasOptions && group.option_legs.some(l => l.delta == null)

        return (
          <div key={group.symbol}>
            {/* Strategy section label — shown at the start of each new strategy group */}
            {sectionStarts.has(group.symbol) && (
              <div className="flex items-center gap-2 mt-1 mb-1">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">
                  {SECTION_LABELS[group.strategy_type] ?? group.strategy_type}
                </span>
                <div className="flex-1 border-t border-line/50" />
              </div>
            )}
          <div
            className={`bg-card border border-line border-l-4 ${accentClass} rounded-xl overflow-hidden`}
          >
            {/* ── Group header (clickable) ───────────────────────────── */}
            <button
              onClick={() => toggle(group.symbol)}
              className="w-full flex items-center justify-between px-4 py-3 border-b border-line bg-row/50 hover:bg-row transition-colors text-left"
            >
              {/* Left: chevron + symbol + spot + leg count */}
              <div className="flex items-center gap-3">
                <span className={`text-slate-400 text-xs transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}>
                  ▶
                </span>
                <span className="font-bold text-white text-base">{group.symbol}</span>
                {group.spot_price ? (
                  <span className="text-xs text-slate-500 tabular-nums">
                    ${fmtNum(group.spot_price)}
                  </span>
                ) : (
                  <span className="inline-block h-3 w-14 bg-slate-700/40 rounded animate-pulse" />
                )}
                {/* Bell icon — set price alert for this symbol */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate('/risk', {
                      state: { prefillAlert: { symbol: group.symbol, spotPrice: group.spot_price } },
                    })
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click() }}
                  title={`${t('alert_set_for')} ${group.symbol}`}
                  className="cursor-pointer px-1 py-0.5 rounded text-slate-600 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <svg className="w-3.5 h-3.5 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-semibold">
                  {totalLegs} leg{totalLegs !== 1 ? 's' : ''}
                </span>
                {/* Strategy badge */}
                {group.option_legs.length > 0 && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border
                    ${group.strategy_type === 'IRON_CONDOR'  ? 'bg-violet-500/10 text-violet-300 border-violet-500/30'
                    : group.strategy_type === 'VERTICAL'     ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                    : group.strategy_type === 'STRADDLE'     ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : group.strategy_type === 'STRANGLE'     ? 'bg-orange-500/10 text-orange-300 border-orange-500/30'
                    : group.strategy_type === 'CALENDAR'     ? 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                    : group.strategy_type === 'CUSTOM'       ? 'bg-pink-500/10 text-pink-300 border-pink-500/30'
                    :                                          'bg-slate-700/60 text-slate-400 border-slate-600/30'}`}>
                    {group.strategy_label}
                  </span>
                )}
                {/* Stock badge in header when mixed group */}
                {hasStocks && hasOptions && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 font-semibold">
                    +stock
                  </span>
                )}
              </div>

              {/* Right: Eff badge + Δ Exposure + Margin */}
              <div className="flex items-center gap-4 text-xs tabular-nums">
                {fmtEfficiency(group.capital_efficiency) && (
                  <div className="text-right">
                    <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-0.5">
                      {t('cap_efficiency')}
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${efficiencyClass(group.capital_efficiency)}`}>
                      {fmtEfficiency(group.capital_efficiency)}
                    </span>
                  </div>
                )}

                <div className="text-right">
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">
                    {t('delta_exposure')}
                  </div>
                  {greeksLoading ? (
                    <span className="inline-block h-4 w-16 bg-slate-700/40 rounded animate-pulse mt-0.5" />
                  ) : (
                    <div className={`font-bold text-sm ${signClass(group.total_delta_exposure)}`}>
                      {fmtNum(group.total_delta_exposure)}
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">
                    {t('margin_req')}
                  </div>
                  <div className="text-slate-300 font-semibold">
                    {fmtUSD(group.total_maintenance_margin)}
                  </div>
                </div>
              </div>
            </button>

            {/* ── Expanded body ──────────────────────────────────────── */}
            {!isCollapsed && (
              <>
                {/* Stock legs (simplified — no Strike/Expiry/Greeks) */}
                {hasStocks && (
                  <StockLegsTable
                    legs={group.stock_legs}
                    spot={group.spot_price}
                    symbol={group.symbol}
                    onClose={closeStock}
                  />
                )}

                {/* Option legs (full Greek columns) */}
                {hasOptions && (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-line">
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
                            <tr
                              key={leg.instrument_id}
                              className="border-b border-line/50 hover:bg-row transition-colors"
                            >
                              <td className="td-left">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold
                                  ${leg.option_type === 'PUT'
                                    ? 'bg-red-500/10 text-red-400'
                                    : 'bg-blue-500/10 text-blue-400'
                                  }`}>
                                  {leg.option_type}
                                </span>
                              </td>
                              <td className="td text-slate-200">${fmtNum(leg.strike)}</td>
                              <td className="td text-slate-400 text-xs">{leg.expiry}</td>
                              <td className="td">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${dteBadgeClass(leg.days_to_expiry)}`}>
                                  {leg.days_to_expiry}d
                                </span>
                              </td>
                              <td className="td">
                                <span className={`font-semibold ${isShort ? 'text-red-400' : 'text-green-400'}`}>
                                  {leg.net_contracts > 0 ? '+' : ''}{leg.net_contracts}
                                </span>
                              </td>
                              <td className="td text-slate-400">${fmtNum(leg.avg_open_price)}</td>
                              <td className="td text-slate-300">{leg.delta != null ? fmtGreek(leg.delta) : <ShimmerCell />}</td>
                              <td className="td">
                                {leg.delta_exposure != null ? (
                                  <span className={`font-semibold ${deltaPos ? 'text-green-400' : 'text-red-400'}`}>
                                    {fmtNum(leg.delta_exposure)}
                                  </span>
                                ) : <ShimmerCell />}
                              </td>
                              <td className="td text-amber-400">{leg.theta != null ? fmtGreek(leg.theta) : <ShimmerCell />}</td>
                              <td className="td text-slate-400">{fmtUSD(leg.maintenance_margin)}</td>
                              {/* Exit */}
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

                      {/* Σ footer (options only) */}
                      <tfoot>
                        <tr className="border-t border-line bg-row/30">
                          <td colSpan={6} className="td-left text-[10px] uppercase tracking-widest text-slate-600 font-semibold">
                            Σ Exposure
                          </td>
                          <td className="td">
                            <div className="text-[10px] text-slate-600 uppercase tracking-wider">Γ</div>
                            <div className={`text-xs font-semibold tabular-nums ${totalGamma > 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {fmtGreekExp(totalGamma)}
                            </div>
                          </td>
                          <td className="td" />
                          <td className="td">
                            <div className="text-[10px] text-slate-600 uppercase tracking-wider">Θ/d</div>
                            <div className={`text-xs font-semibold tabular-nums ${totalTheta > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                              {fmtGreekExp(totalTheta)}
                            </div>
                          </td>
                          <td className="td" />
                          <td className="td" />{/* Exit column spacer */}
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

// ── Status badge ───────────────────────────────────────────────────────────────
const STATUS_CLASSES: Record<string, string> = {
  EXPIRED:  'bg-slate-700 text-slate-400',
  ASSIGNED: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  CLOSED:   'bg-slate-600/60 text-slate-500',
  ACTIVE:   'bg-green-500/10 text-green-400',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide
      ${STATUS_CLASSES[status] ?? 'bg-slate-700 text-slate-400'}`}>
      {status}
    </span>
  )
}

// ── Settlement history ──────────────────────────────────────────────────────────
function SettledTradesSection({
  portfolioId,
}: {
  portfolioId: number | null | undefined
}) {
  const { t } = useLanguage()
  const [open,       setOpen]       = useState(false)
  const [trades,     setTrades]     = useState<SettledTrade[]>([])
  const [loading,    setLoading]    = useState(false)
  const [total,      setTotal]      = useState(0)
  const [sinceHours, setSinceHours] = useState<24 | null>(24) // default: last 24h

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

  function toggleTimeFilter(hours: 24 | null) {
    setSinceHours(hours)
  }

  const hasAssigned = trades.some((r) => r.status === 'ASSIGNED')

  return (
    <div className="bg-card border border-line rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-row transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('settled_history')}
          </span>
          {total > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-semibold">
              {total}
            </span>
          )}
          {/* Amber dot when there are recent assignments */}
          {sinceHours === 24 && total > 0 && hasAssigned && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>
        <span className={`text-slate-600 text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
          ▶
        </span>
      </button>

      {open && (
        <div className="border-t border-line">
          {/* 24h / All toggle */}
          <div className="flex items-center justify-end gap-1 px-4 pt-2 pb-1">
            <button
              onClick={(e) => { e.stopPropagation(); toggleTimeFilter(24) }}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors
                ${sinceHours === 24
                  ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                  : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              {t('settled_24h')}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleTimeFilter(null) }}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition-colors
                ${sinceHours === null
                  ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                  : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              {t('settled_all_hist')}
            </button>
          </div>

          {loading ? (
            <div className="h-16 flex items-center justify-center">
              <div className="animate-pulse h-4 w-40 bg-slate-700 rounded" />
            </div>
          ) : trades.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-600">
              {t('no_settled')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-slate-800/30">
                    <th className="th-left text-[10px] uppercase tracking-widest text-slate-600">Symbol</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">Type</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">Strike</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">Expiry</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">Dir / Qty</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">{t('settled_status')}</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">{t('settled_assign')}</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">{t('settled_premium')}</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">{t('settled_eff_cost')}</th>
                    <th className="th text-[10px] uppercase tracking-widest text-slate-600">{t('settled_date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((row) => {
                    const isShort   = row.action === 'SELL_OPEN'
                    const isBuyOpen = row.auto_stock_action === 'BUY_OPEN'
                    return (
                      <tr
                        key={row.trade_event_id}
                        className="border-b border-line/30 hover:bg-row transition-colors"
                      >
                        <td className="td-left font-bold text-white text-sm">{row.symbol}</td>
                        <td className="td">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold
                            ${row.option_type === 'PUT'
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-blue-500/10 text-blue-400'
                            }`}>
                            {row.option_type}
                          </span>
                        </td>
                        <td className="td text-slate-300">${fmtNum(row.strike ?? '0')}</td>
                        <td className="td text-slate-400 text-xs">{row.expiry ?? '—'}</td>
                        <td className="td">
                          <span className={`font-semibold text-xs ${isShort ? 'text-red-400' : 'text-green-400'}`}>
                            {isShort ? '-' : '+'}{row.quantity}
                          </span>
                        </td>
                        <td className="td">
                          <StatusBadge status={row.status} />
                        </td>
                        {/* Auto-assignment: show action + shares + effective cost */}
                        <td className="td text-xs">
                          {row.auto_stock_action ? (
                            <span className="font-mono text-amber-400 text-[11px]">
                              {row.auto_stock_action.replace('_', ' ')}
                              {' '}{row.auto_stock_quantity}sh
                              {' '}@{' '}
                              <span className={isBuyOpen ? 'text-bear' : 'text-bull'}>
                                ${fmtNum(row.auto_stock_price ?? '0')}
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                        {/* Premium per share (what was collected/paid on the option) */}
                        <td className="td text-xs">
                          {row.premium_per_share != null ? (
                            <span className="font-mono text-amber-300">
                              ${fmtNum(row.premium_per_share)}
                            </span>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                        {/* Effective cost per share (strike ± premium) */}
                        <td className="td text-xs">
                          {row.effective_cost_per_share != null ? (
                            <span className={`font-mono font-semibold
                              ${isBuyOpen ? 'text-sky-300' : 'text-green-400'}`}>
                              ${fmtNum(row.effective_cost_per_share)}
                            </span>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                        <td className="td text-slate-500 text-xs">{row.settled_date ?? '—'}</td>
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

// ── Page ───────────────────────────────────────────────────────────────────────
export default function HoldingsPage() {
  const { selectedPortfolioId, refreshKey, triggerRefresh } = usePortfolio()
  const { t } = useLanguage()
  const { lastHoldingsUpdate, lastPnlSnapshot } = useWebSocket()

  const [holdings,        setHoldings]        = useState<HoldingGroup[]>([])
  const [cash,            setCash]            = useState<CashSummary | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)
  const [lifecycleResult, setLifecycleResult] = useState<LifecycleResult | null>(null)

  // ── P&L chart state (Phase 7f) ──────────────────────────────────────────
  const [pnlSeries,    setPnlSeries]    = useState<PnlDataPoint[]>([])
  const [prevCloseNlv, setPrevCloseNlv] = useState<string | null>(null)
  const [dayPnlPct,    setDayPnlPct]    = useState<string | null>(null)
  const [currentNlv,   setCurrentNlv]   = useState<string | null>(null)
  const [currentPnl,   setCurrentPnl]   = useState<string | null>(null)

  // ── Main data fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetchHoldings(selectedPortfolioId),
      fetchCash(selectedPortfolioId),
    ])
      .then(([h, c]) => { setHoldings(h); setCash(c) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  // ── Live WS holdings updates ──────────────────────────────────────────────
  useEffect(() => {
    if (!lastHoldingsUpdate) return
    if (lastHoldingsUpdate.portfolioId !== selectedPortfolioId) return
    setHoldings(lastHoldingsUpdate.data)
  }, [lastHoldingsUpdate, selectedPortfolioId])

  // ── Live WS P&L snapshot (Phase 7f) ──────────────────────────────────────
  useEffect(() => {
    if (!lastPnlSnapshot) return
    if (lastPnlSnapshot.portfolioId !== selectedPortfolioId) return
    setPnlSeries(lastPnlSnapshot.series)
    setPrevCloseNlv(lastPnlSnapshot.prevCloseNlv)
    setDayPnlPct(lastPnlSnapshot.dayPnlPct)
    setCurrentNlv(lastPnlSnapshot.current.nlv)
    setCurrentPnl(lastPnlSnapshot.current.pnl)
  }, [lastPnlSnapshot, selectedPortfolioId])

  // Clear P&L chart on portfolio change
  useEffect(() => {
    setPnlSeries([])
    setPrevCloseNlv(null)
    setDayPnlPct(null)
    setCurrentNlv(null)
    setCurrentPnl(null)
  }, [selectedPortfolioId])

  // ── Lifecycle sweep on portfolio change (fire-and-forget) ─────────────────
  // Runs once per portfolio selection; if trades were settled, triggers a
  // full refresh so newly assigned stock positions appear in the table.
  useEffect(() => {
    triggerLifecycle()
      .then((result) => {
        setLifecycleResult(result)
        if (result.expired + result.assigned > 0) {
          triggerRefresh()
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortfolioId])

  const hadSettlement = lifecycleResult && lifecycleResult.expired + lifecycleResult.assigned > 0

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">{t('holdings_title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('holdings_sub')}</p>
      </div>

      {/* Lifecycle notice — shown when options were auto-settled on this load */}
      {hadSettlement && (
        <div className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/20
                        rounded-xl px-4 py-2.5 text-xs">
          <span className="text-amber-400 font-semibold">{t('lifecycle_notice')}</span>
          <span className="text-slate-400">
            {lifecycleResult!.expired > 0 && (
              <span className="mr-3">
                {lifecycleResult!.expired} expired
              </span>
            )}
            {lifecycleResult!.assigned > 0 && (
              <span className="text-amber-300 font-semibold">
                {lifecycleResult!.assigned} assigned
              </span>
            )}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 bg-card border border-line rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <MarketTicker />
          <CashCard cash={cash} />
          <PnlChart
            series={pnlSeries}
            prevCloseNlv={prevCloseNlv}
            dayPnlPct={dayPnlPct}
            currentNlv={currentNlv}
            currentPnl={currentPnl}
          />
          <AiInsightPanel />
          <HoldingsTable groups={holdings} />
          <SettledTradesSection portfolioId={selectedPortfolioId} />
        </>
      )}
    </div>
  )
}
