/**
 * HoldingsPageV2 — Professional trading workspace.
 *
 * Layout (flex):
 *   Main column (flex-1): Hero → Chart → Treemap → Holdings Table
 *   Hero → NLV Chart → Treemap (full width)
 *
 * Focus mode: chart expands to full-width, right panel collapses.
 * All V1 business logic preserved — this is a visual-only rebuild.
 */

// Module-level singleton: lifecycle sweep fires at most once per browser session.
let _lifecycleCalledThisSession = false

import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Treemap, Tooltip, ResponsiveContainer,
} from 'recharts'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useLanguage }   from '@/context/LanguageContext'
import { useWebSocket }  from '@/context/WebSocketContext'
import { useSidebar }    from '@/context/SidebarContext'
import {
  fetchHoldings, fetchCash,
  triggerLifecycle, fetchRiskDashboard,
} from '@/api/holdings'
import type {
  HoldingGroup, OptionLeg, StockLeg, CashSummary,
  TradeAction, ClosePositionState, LifecycleResult,
  RiskDashboard, Portfolio,
} from '@/types'
import { fmtUSD, fmtNum, fmtGreek, dteBadgeClass, signClass } from '@/utils/format'
import PortfolioHistoryChart from '@/components/PortfolioHistoryChart'
import HeroSection           from '@/design-system/workspace/HeroSection'
import TradeRecordTimeline   from '@/design-system/workspace/TradeRecordTimeline'
import SectionCard           from '@/design-system/primitives/SectionCard'
import TabsV2               from '@/design-system/primitives/TabsV2'

// ── Safe helpers ──────────────────────────────────────────────────────────────
function safeFloat(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return isFinite(n) ? n : null
}

// ── Period ────────────────────────────────────────────────────────────────────
type Period = '1d' | '5d' | '1m' | '3m'
const PERIOD_LABELS: Record<Period, { en: string; zh: string }> = {
  '1d': { en: '1D', zh: '1日' },
  '5d': { en: '5D', zh: '5日' },
  '1m': { en: '1M', zh: '1月' },
  '3m': { en: '3M', zh: '3月' },
}

// ── Treemap helpers ──────────────────────────────────────────────────────────
function perfColor(pct: number | null | undefined): string {
  if (pct == null || !isFinite(pct)) return '#a1a1aa'  // zinc-400 neutral
  if (pct >=  4) return '#3d7a5a'  // deep muted green
  if (pct >=  2) return '#5f9c7b'  // mid muted green
  if (pct >=  0) return '#8ab8a0'  // light muted green
  if (pct >= -2) return '#c49a97'  // light muted red
  if (pct >= -4) return '#b55a55'  // mid muted red
  return '#944a46'                  // deep muted red
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

// ── Treemap custom cell ──────────────────────────────────────────────────────
function CustomCell(props: Record<string, unknown>) {
  const x       = (typeof props.x      === 'number') ? props.x      : 0
  const y       = (typeof props.y      === 'number') ? props.y      : 0
  const width   = (typeof props.width  === 'number') ? props.width  : 0
  const height  = (typeof props.height === 'number') ? props.height : 0
  const name    = (typeof props.name   === 'string') ? props.name   : (props.name != null ? String(props.name) : '')
  const perf    = (typeof props.perf   === 'number' && isFinite(props.perf as number)) ? props.perf as number : null
  const isShort = (props.isShort === true)

  const fill  = perfColor(perf)
  const label = isShort ? `${name} (S)` : name

  if (width <= 0 || height <= 0) return <g />

  const fontSize    = Math.min(13, Math.max(8, width / 6))
  const subFontSize = Math.min(11, Math.max(8, width / 8))
  const showText    = width > 36 && height > 22

  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(0, width - 2)} height={Math.max(0, height - 2)}
        fill={fill} rx={8} stroke="rgba(255,255,255,0.15)" strokeWidth={1}
      />
      {showText && (
        <>
          <text
            x={x + width / 2} y={y + height / 2 - (height > 40 ? 8 : 0)}
            textAnchor="middle" dominantBaseline="middle"
            fill="rgba(255,255,255,0.9)"
            fontSize={fontSize} fontWeight="500" fontFamily="Inter, sans-serif"
          >
            {label || '?'}
          </text>
          {height > 40 && perf != null && (
            <text
              x={x + width / 2} y={y + height / 2 + 10}
              textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,0.7)"
              fontSize={subFontSize} fontWeight="400" fontFamily="Inter, sans-serif"
            >
              {perf >= 0 ? '+' : ''}{perf.toFixed(1)}%
            </text>
          )}
        </>
      )}
    </g>
  )
}

// ── Treemap tooltip ──────────────────────────────────────────────────────────
function TreemapTooltip({ active, payload }: { active?: boolean; payload?: readonly unknown[] }) {
  if (!active || !payload?.length) return null
  const item     = (payload[0] ?? {}) as Record<string, unknown>
  const name     = (typeof item.name    === 'string') ? item.name    : String(item.name ?? '?')
  const perf     = (typeof item.perf    === 'number' && isFinite(item.perf))    ? item.perf    : null
  const rawPerf  = (typeof item.rawPerf === 'number' && isFinite(item.rawPerf)) ? item.rawPerf : null
  const exposure = (typeof item.exposure === 'number') ? item.exposure : null
  const isShort  = (item.isShort === true)

  return (
    <div className="bg-v2-surface border border-v2-border rounded-v2-md shadow-v2-lg px-3 py-2.5 text-xs min-w-[165px]">
      <div className="font-bold text-v2-text-1 text-sm mb-1.5 flex items-center gap-1.5">
        {name || '?'}
        {isShort && (
          <span className="text-ds-caption text-v2-negative bg-v2-negative-bg px-1 py-0.5 rounded">(S)</span>
        )}
      </div>
      <div className="space-y-0.5 text-v2-text-3">
        {exposure != null && (
          <div>Notional: <span className="font-bold text-v2-text-1">{fmtUSD(String(exposure))}</span></div>
        )}
        {rawPerf != null && (
          <div>
            Underlying:{' '}
            <span className={`font-bold ${rawPerf >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
              {rawPerf >= 0 ? '+' : ''}{rawPerf.toFixed(2)}%
            </span>
          </div>
        )}
        {perf != null && (
          <div className="border-t border-v2-border pt-0.5 mt-0.5">
            P&L direction:{' '}
            <span className={`font-bold ${perf >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
              {perf >= 0 ? '+' : ''}{perf.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ShimmerCell ──────────────────────────────────────────────────────────────
function ShimmerCell({ w = 'w-12' }: { w?: string }) {
  return <span className={`inline-block h-3.5 ${w} bg-v2-surface-alt rounded ds-shimmer`} />
}

// ── Exit button ──────────────────────────────────────────────────────────────
function ExitBtn({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title ?? 'Close this position'}
      className="px-2 py-0.5 rounded-v2-sm text-ds-sm text-v2-text-3
                 hover:text-v2-negative hover:bg-v2-negative-bg transition-colors whitespace-nowrap"
    >
      Exit
    </button>
  )
}

// ── Asset badge ──────────────────────────────────────────────────────────────
const ASSET_BADGE: Record<string, { cls: string; label: string }> = {
  stock:  { cls: 'bg-blue-50   text-blue-600   border-blue-200',   label: 'STOCK'  },
  etf:    { cls: 'bg-emerald-50 text-emerald-600 border-emerald-200', label: 'ETF'  },
  index:  { cls: 'bg-amber-50  text-amber-600  border-amber-200',  label: 'INDEX'  },
  crypto: { cls: 'bg-violet-50 text-violet-600 border-violet-200', label: 'CRYPTO' },
  option: { cls: 'bg-rose-50   text-rose-600   border-rose-200',   label: 'OPTION' },
}

function AssetBadge({ type }: { type: string }) {
  const b = ASSET_BADGE[type] ?? ASSET_BADGE.stock
  return (
    <span className={`px-2 py-0.5 rounded-md text-ds-sm border ${b.cls}`}>
      {b.label}
    </span>
  )
}

// ── Stock legs table ─────────────────────────────────────────────────────────
function StockLegsTable({
  legs, symbol, assetClass = 'stock', onClose,
}: {
  legs: StockLeg[]
  spot?: string | null
  symbol: string
  assetClass?: string
  onClose: (symbol: string, leg: StockLeg) => void
}) {
  const { t } = useLanguage()
  if (legs.length === 0) return null

  return (
    <div className="overflow-x-auto border-b border-v2-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-v2-border">
            <th className="th-left text-ds-caption">Asset Class</th>
            <th className="th text-ds-caption">{t('col_shares')}</th>
            <th className="th text-ds-caption">{t('col_cost')}</th>
            <th className="th text-ds-caption">{t('col_mkt_value')}</th>
            <th className="th text-ds-caption">{t('total_pnl')}</th>
            <th className="th text-ds-caption">{t('col_delta_exp')}</th>
            <th className="th text-ds-caption">{/* Exit */}</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => {
            const isLong   = leg.net_shares > 0
            const deltaPos = parseFloat(leg.delta_exposure) > 0
            return (
              <tr key={leg.instrument_id} className="border-b border-v2-border hover:bg-v2-surface-hover transition-colors">
                <td className="td-left"><AssetBadge type={assetClass} /></td>
                <td className="td">
                  <span className={`font-bold ${isLong ? 'text-v2-positive' : 'text-v2-negative'}`}>
                    {leg.net_shares > 0 ? '+' : ''}{leg.net_shares}
                  </span>
                </td>
                <td className="td text-v2-text-2">${fmtNum(leg.avg_open_price)}</td>
                <td className="td text-v2-text-1">
                  {leg.market_value != null ? fmtUSD(leg.market_value) : <span className="text-v2-text-3">—</span>}
                </td>
                <td className="td">
                  {leg.total_pnl != null ? (
                    <span className={`font-bold ${signClass(leg.total_pnl)}`}>
                      {fmtUSD(leg.total_pnl)}
                      {leg.total_pnl_pct != null && (
                        <span className="text-ds-caption ml-0.5 opacity-70">
                          ({(parseFloat(leg.total_pnl_pct) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  ) : <span className="text-v2-text-3">—</span>}
                </td>
                <td className="td">
                  <span className={`font-bold ${deltaPos ? 'text-v2-positive' : 'text-v2-negative'}`}>
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

// ── Strategy badge helpers ───────────────────────────────────────────────────
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

// ── Efficiency helpers ───────────────────────────────────────────────────────
function fmtEfficiency(v: string | null | undefined): string | null {
  if (v == null) return null
  const n = parseFloat(v)
  if (!isFinite(n) || n === 0) return null
  return (n * 100).toFixed(1) + '%'
}

function efficiencyClass(v: string | null | undefined): string {
  if (v == null) return 'bg-slate-100 text-slate-500'
  const n = parseFloat(v) * 100
  if (n >= 100) return 'bg-emerald-50 text-emerald-700'
  if (n >= 50)  return 'bg-sky-50 text-sky-700'
  return 'bg-slate-100 text-slate-500'
}

// ── Greek exposure sum ───────────────────────────────────────────────────────
function sumGreekExposure(legs: OptionLeg[], greek: 'gamma' | 'theta') {
  return legs.reduce((sum, leg) => {
    const val = parseFloat(leg[greek] ?? '0')
    if (!isFinite(val)) return sum
    return sum + val * Math.abs(leg.net_contracts) * 100
  }, 0)
}

// ── Holdings Table (V2) ──────────────────────────────────────────────────────
function HoldingsTableV2({ groups }: { groups: HoldingGroup[] }) {
  const { t }             = useLanguage()
  const { openTradeEntry, openPriceAlerts } = useSidebar()
  const { lastSpotChangePct } = useWebSocket()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (sym: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(sym) ? next.delete(sym) : next.add(sym)
      return next
    })

  function closeOption(symbol: string, leg: OptionLeg) {
    const qty: number     = Math.abs(leg.net_contracts)
    const action: TradeAction = leg.net_contracts < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    const state: ClosePositionState = {
      symbol, instrumentType: 'OPTION', optionType: leg.option_type,
      strike: leg.strike, expiry: leg.expiry, action, quantity: String(qty),
    }
    openTradeEntry(state)
  }

  function closeStock(symbol: string, leg: StockLeg) {
    const qty: number     = Math.abs(leg.net_shares)
    const action: TradeAction = leg.net_shares < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    const state: ClosePositionState = {
      symbol, instrumentType: 'STOCK', action, quantity: String(qty),
    }
    openTradeEntry(state)
  }

  if (groups.length === 0) {
    return (
      <SectionCard className="text-center py-10">
        <span className="text-v2-text-3 text-sm">{t('no_positions')}</span>
      </SectionCard>
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

  return (
    <div className="space-y-3">
      {sortedGroups.map((group) => {
        const isCollapsed   = collapsed.has(group.symbol)
        const deltaVal      = parseFloat(group.total_delta_exposure)
        const deltaPositive = deltaVal > 0

        const totalLegs  = group.option_legs.length + group.stock_legs.length
        const hasOptions = group.option_legs.length > 0
        const hasStocks  = group.stock_legs.length > 0
        const greeksLoading = hasOptions && group.option_legs.some(l => l.delta == null)

        return (
          <div key={group.symbol}>
            {sectionStarts.has(group.symbol) && (
              <div className="flex items-center gap-2 mt-2 mb-1">
                <span className="text-ds-caption uppercase text-v2-text-3">
                  {SECTION_LABELS[group.strategy_type] ?? group.strategy_type}
                </span>
                <div className="flex-1 border-t border-v2-border" />
              </div>
            )}
            <div className={`bg-v2-surface rounded-v2-lg overflow-hidden shadow-v2-sm
                             border-l-[3px] ${deltaPositive ? 'border-l-v2-positive' : 'border-l-v2-negative'}`}>
              {/* ── Group header ───────────────────────────────────── */}
              <button
                onClick={() => toggle(group.symbol)}
                className="w-full flex items-center justify-between px-4 py-3
                           hover:bg-v2-surface-hover transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`text-v2-text-3 text-xs transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}>
                    ▶
                  </span>
                  <span className="font-bold text-v2-text-1 text-base">{group.symbol}</span>
                  {group.spot_price ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-v2-text-2 tnum">${fmtNum(group.spot_price)}</span>
                      {lastSpotChangePct?.[group.symbol] != null && (() => {
                        const pct = parseFloat(lastSpotChangePct![group.symbol])
                        return (
                          <span className={`text-ds-caption tnum px-1.5 py-0.5 rounded-full
                            ${pct >= 0 ? 'text-v2-positive bg-v2-positive-bg' : 'text-v2-negative bg-v2-negative-bg'}`}>
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
                      openPriceAlerts({ symbol: group.symbol, price: parseFloat(group.spot_price ?? '0') })
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click() }}
                    title={`${t('alert_set_for')} ${group.symbol}`}
                    className="cursor-pointer px-1 py-0.5 rounded text-v2-text-3 hover:text-v2-caution
                               hover:bg-v2-caution-bg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </span>
                  <span className="text-ds-caption px-1.5 py-0.5 rounded-md bg-v2-surface-alt text-v2-text-3">
                    {totalLegs} leg{totalLegs !== 1 ? 's' : ''}
                  </span>
                  {hasOptions && (
                    <span className={`text-ds-caption px-2 py-0.5 rounded-full border ${strategyBadgeClass(group.strategy_type)}`}>
                      {group.strategy_label}
                    </span>
                  )}
                  {hasStocks && hasOptions && (
                    <span className="text-ds-caption px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200">
                      +stock
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs tnum">
                  {fmtEfficiency(group.capital_efficiency) && (
                    <div className="text-right hidden md:block">
                      <div className="text-v2-text-3 uppercaser text-ds-caption mb-0.5">{t('cap_efficiency')}</div>
                      <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold ${efficiencyClass(group.capital_efficiency)}`}>
                        {fmtEfficiency(group.capital_efficiency)}
                      </span>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-v2-text-3 uppercaser text-ds-caption">{t('delta_exposure')}</div>
                    {greeksLoading ? <ShimmerCell w="w-16" /> : (
                      <div className={`font-bold text-sm ${signClass(group.total_delta_exposure)}`}>
                        {fmtNum(group.total_delta_exposure)}
                      </div>
                    )}
                  </div>
                  {group.total_pnl != null && (
                    <div className="text-right hidden lg:block">
                      <div className="text-v2-text-3 uppercaser text-ds-caption">{t('total_pnl')}</div>
                      <div className={`font-bold text-sm ${signClass(group.total_pnl)}`}>
                        {fmtUSD(group.total_pnl)}
                        {group.total_pnl_pct != null && (
                          <span className="text-ds-caption ml-1 opacity-70">
                            ({(parseFloat(group.total_pnl_pct) * 100).toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {group.daily_pnl != null && (
                    <div className="text-right hidden lg:block">
                      <div className="text-v2-text-3 uppercaser text-ds-caption">{t('daily_pnl')}</div>
                      <div className={`font-bold text-sm ${signClass(group.daily_pnl)}`}>{fmtUSD(group.daily_pnl)}</div>
                    </div>
                  )}
                  <div className="text-right hidden xl:block">
                    <div className="text-v2-text-3 uppercaser text-ds-caption">{t('margin_req')}</div>
                    <div className="text-v2-text-1 font-bold">{fmtUSD(group.total_maintenance_margin)}</div>
                  </div>
                </div>
              </button>

              {/* ── Expanded body ──────────────────────────────── */}
              {!isCollapsed && (
                <>
                  {hasStocks && (
                    <StockLegsTable
                      legs={group.stock_legs} spot={group.spot_price}
                      symbol={group.symbol} assetClass={group.asset_class}
                      onClose={closeStock}
                    />
                  )}
                  {hasOptions && (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-v2-border bg-v2-surface-alt/40">
                            <th className="th-left">{t('col_type')}</th>
                            <th className="th">{t('col_strike')}</th>
                            <th className="th">{t('col_expiry')}</th>
                            <th className="th">{t('col_dte')}</th>
                            <th className="th">{t('col_net_qty')}</th>
                            <th className="th">{t('col_cost')}</th>
                            <th className="th">{t('total_pnl')}</th>
                            <th className="th">{t('col_delta')}</th>
                            <th className="th">{t('col_delta_exp')}</th>
                            <th className="th">{t('col_theta')}</th>
                            <th className="th">{t('col_margin')}</th>
                            <th className="th">{/* Exit */}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.option_legs.map((leg) => {
                            const isLong = leg.net_contracts > 0
                            return (
                              <tr key={leg.instrument_id} className="border-b border-v2-border hover:bg-v2-surface-hover transition-colors">
                                <td className="td-left">
                                  <span className={`px-2 py-0.5 rounded-md text-ds-sm border
                                    ${leg.option_type === 'CALL'
                                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                                      : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                    {leg.option_type}
                                  </span>
                                </td>
                                <td className="td tnum">${fmtNum(leg.strike)}</td>
                                <td className="td text-v2-text-2 text-xs">{leg.expiry}</td>
                                <td className="td">
                                  <span className={`px-1.5 py-0.5 rounded-md text-ds-sm ${dteBadgeClass(leg.days_to_expiry)}`}>
                                    {leg.days_to_expiry}d
                                  </span>
                                </td>
                                <td className="td">
                                  <span className={`font-bold ${isLong ? 'text-v2-positive' : 'text-v2-negative'}`}>
                                    {leg.net_contracts > 0 ? '+' : ''}{leg.net_contracts}
                                  </span>
                                </td>
                                <td className="td text-v2-text-2">${fmtNum(leg.avg_open_price)}</td>
                                <td className="td">
                                  {leg.total_pnl != null ? (
                                    <span className={`font-bold ${signClass(leg.total_pnl)}`}>
                                      {fmtUSD(leg.total_pnl)}
                                      {leg.total_pnl_pct != null && (
                                        <span className="text-ds-caption ml-0.5 opacity-70">
                                          ({(parseFloat(leg.total_pnl_pct) * 100).toFixed(1)}%)
                                        </span>
                                      )}
                                    </span>
                                  ) : <span className="text-v2-text-3">—</span>}
                                </td>
                                <td className="td">
                                  {leg.delta != null ? (
                                    <span className={signClass(leg.delta)}>{fmtGreek(leg.delta)}</span>
                                  ) : <ShimmerCell w="w-10" />}
                                </td>
                                <td className="td">
                                  {leg.delta_exposure != null ? (
                                    <span className={`font-bold ${signClass(leg.delta_exposure)}`}>{fmtNum(leg.delta_exposure)}</span>
                                  ) : <ShimmerCell />}
                                </td>
                                <td className="td">
                                  {leg.theta != null ? (
                                    <span className={signClass(leg.theta)}>{fmtGreek(leg.theta)}</span>
                                  ) : <ShimmerCell w="w-10" />}
                                </td>
                                <td className="td text-v2-text-2">{fmtUSD(leg.maintenance_margin)}</td>
                                <td className="td pr-3">
                                  <ExitBtn
                                    onClick={() => closeOption(group.symbol, leg)}
                                    title={`Close ${Math.abs(leg.net_contracts)} ${leg.option_type} $${fmtNum(leg.strike)} ${leg.expiry}`}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                          {group.option_legs.length > 1 && (
                            <tr className="bg-v2-surface-alt/30 border-t border-v2-border">
                              <td colSpan={7} className="td-left text-ds-sm text-v2-text-3 uppercaser">
                                Subtotal
                              </td>
                              <td className="td">
                                <span className={`font-bold ${signClass(group.total_delta_exposure)}`}>
                                  {fmtNum(group.total_delta_exposure)}
                                </span>
                              </td>
                              <td className="td" />
                              <td className="td">
                                <span className={`font-bold ${sumGreekExposure(group.option_legs, 'theta') >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
                                  {sumGreekExposure(group.option_legs, 'theta').toFixed(2)}
                                </span>
                              </td>
                              <td className="td text-v2-text-2 font-bold">{fmtUSD(group.total_maintenance_margin)}</td>
                              <td className="td" />
                            </tr>
                          )}
                        </tbody>
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

// ── Sector Pie Chart (compact V2 version) ────────────────────────────────────
const ASSET_CLASS_KEYS = new Set(['Stock', 'ETF/Index', 'Crypto', 'Option'])
const SECTOR_NAMED_COLORS: Record<string, string> = {
  'Technology': '#6366f1', 'Healthcare': '#10b981', 'Finance': '#0ea5e9',
  'Financials': '#0ea5e9', 'Energy': '#f59e0b', 'Consumer Discretionary': '#f97316',
  'Consumer Staples': '#84cc16', 'Industrials': '#64748b', 'Materials': '#78716c',
  'Real Estate': '#a78bfa', 'Communication Services': '#22d3ee',
  'Utilities': '#4ade80', 'Other / Diversified': '#94a3b8',
}
const SECTOR_FALLBACK_PALETTE = [
  '#6366f1', '#0ea5e9', '#f97316', '#10b981',
  '#f59e0b', '#ec4899', '#84cc16', '#22d3ee',
]

// ══════════════════════════════════════════════════════════════════════════════
// ── Page Component ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'overview' | 'details' | 'records'

export default function HoldingsPageV2() {
  const { selectedPortfolioId, refreshKey, triggerRefresh, portfolios } = usePortfolio()
  const { lang, t } = useLanguage()
  const { lastHoldingsUpdate, lastSpotChangePct } = useWebSocket()
  const isEn = lang !== 'zh'

  // Tab from URL
  const location  = useLocation()
  const navigate  = useNavigate()
  const activeTab: Tab = location.pathname.includes('/details') ? 'details'
    : location.pathname.includes('/records') ? 'records'
    : 'overview'

  const TAB_ITEMS = useMemo(() => [
    { key: 'overview', label: isEn ? 'Overview' : '概览' },
    { key: 'details',  label: isEn ? 'Details'  : '详情' },
    { key: 'records',  label: isEn ? 'Records'  : '记录' },
  ], [isEn])

  const handleTabChange = (key: string) => {
    const path = key === 'overview' ? '/holdings/overview'
      : key === 'details' ? '/holdings/details'
      : '/holdings/records'
    navigate(path)
  }

  const [holdings,        setHoldings]        = useState<HoldingGroup[]>([])
  const [cash,            setCash]            = useState<CashSummary | null>(null)
  const [riskDash,        setRiskDash]        = useState<RiskDashboard | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [period,          setPeriod]          = useState<Period>('1d')
  const [lifecycleResult, setLifecycleResult] = useState<LifecycleResult | null>(null)

  const lastValidHoldings = useRef<HoldingGroup[]>([])

  // ── Main data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchHoldings(selectedPortfolioId),
      fetchCash(selectedPortfolioId),
      fetchRiskDashboard(selectedPortfolioId).catch(() => null),
    ])
      .then(([h, c, r]) => {
        const hArr = Array.isArray(h) ? h : []
        setHoldings(hArr)
        lastValidHoldings.current = hArr
        setCash(c ?? null)
        setRiskDash(r ?? null)
      })
      .catch(() => { setHoldings([]); setCash(null); setRiskDash(null) })
      .finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  // ── Real-time WS holdings push ───────────────────────────────────────────
  useEffect(() => {
    if (!lastHoldingsUpdate) return
    if (lastHoldingsUpdate.portfolioId !== selectedPortfolioId) return
    const newData = lastHoldingsUpdate.data

    const isCold = newData.length > 0 &&
      newData.every(g => (safeFloat(g.effective_perf_1d) ?? 0) === 0 && g.effective_perf_1d == null)
    if (isCold && lastValidHoldings.current.length > 0) return

    const prev = lastValidHoldings.current
    const merged: typeof newData = newData.map(ng => {
      const old = prev.find(o => o.symbol === ng.symbol)
      if (!old) return ng
      return {
        ...ng,
        perf_5d:           ng.perf_5d           ?? old.perf_5d,
        perf_1m:           ng.perf_1m           ?? old.perf_1m,
        perf_3m:           ng.perf_3m           ?? old.perf_3m,
        effective_perf_5d: ng.effective_perf_5d ?? old.effective_perf_5d,
        effective_perf_1m: ng.effective_perf_1m ?? old.effective_perf_1m,
        effective_perf_3m: ng.effective_perf_3m ?? old.effective_perf_3m,
      }
    })
    setHoldings(merged)
    lastValidHoldings.current = merged
  }, [lastHoldingsUpdate, selectedPortfolioId])

  // ── Stale-While-Revalidate on language change ────────────────────────────
  useEffect(() => {
    if (selectedPortfolioId === null) return
    let cancelled = false
    Promise.all([
      fetchHoldings(selectedPortfolioId),
      fetchCash(selectedPortfolioId),
    ]).then(([h, c]) => {
      if (cancelled) return
      if (Array.isArray(h)) {
        const merged = h.map(newGroup => {
          const old = lastValidHoldings.current.find(o => o.symbol === newGroup.symbol)
          if (old && (safeFloat(newGroup.effective_perf_1d) ?? 0) === 0 && (safeFloat(old.effective_perf_1d) ?? 0) !== 0) {
            return { ...newGroup, effective_perf_1d: old.effective_perf_1d, effective_perf_5d: old.effective_perf_5d, perf_1d: old.perf_1d, perf_5d: old.perf_5d, perf_1m: old.perf_1m, perf_3m: old.perf_3m }
          }
          return newGroup
        })
        setHoldings(merged)
        lastValidHoldings.current = merged
      }
      if (c) setCash(c)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // ── Lifecycle sweep ──────────────────────────────────────────────────────
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

  // ── Hero metrics ─────────────────────────────────────────────────────────
  const heroMetrics = useMemo(() => {
    let dailyUnrealizedPnl = 0
    let totalUnrealizedPnl = 0
    let netExposure        = 0
    let portfolioValue     = 0
    let hasAnyHolding      = false
    let hasTotalPnl        = false

    for (const g of holdings) {
      hasAnyHolding = true
      const exposure = safeFloat(g.delta_adjusted_exposure) ?? 0
      netExposure += exposure

      const dayPnl = safeFloat(g.daily_pnl) ?? safeFloat(g.bs_pnl_1d)
      if (dayPnl != null && isFinite(dayPnl)) {
        dailyUnrealizedPnl += dayPnl
      } else {
        const pctStr = lastSpotChangePct?.[g.symbol]
        const pct    = pctStr != null ? parseFloat(pctStr) : (safeFloat(g.effective_perf_1d) ?? 0)
        if (isFinite(pct) && isFinite(exposure)) dailyUnrealizedPnl += exposure * pct / 100
      }

      const grpTotal = safeFloat(g.total_pnl)
      if (grpTotal != null && isFinite(grpTotal)) { totalUnrealizedPnl += grpTotal; hasTotalPnl = true }

      for (const sl of g.stock_legs ?? []) {
        const mv = safeFloat(sl.market_value)
        if (mv != null) portfolioValue += Math.abs(mv)
      }
      for (const ol of g.option_legs ?? []) {
        const premium = safeFloat(ol.avg_open_price)
        const qty     = Math.abs(ol.net_contracts)
        if (premium != null && qty > 0) portfolioValue += premium * qty * 100
      }
    }

    const realizedPnl         = safeFloat(cash?.realized_pnl) ?? 0
    const dailyUnrealizedPnlPct = portfolioValue > 0 ? (dailyUnrealizedPnl / portfolioValue) * 100 : 0
    const realizedPnlPct        = portfolioValue > 0 ? (realizedPnl / portfolioValue) * 100 : 0
    const totalUnrealizedPnlPct = portfolioValue > 0 && hasTotalPnl ? (totalUnrealizedPnl / portfolioValue) * 100 : 0

    return { dailyUnrealizedPnl, totalUnrealizedPnl, netExposure, portfolioValue, realizedPnl, dailyUnrealizedPnlPct, totalUnrealizedPnlPct, realizedPnlPct, hasAnyHolding, hasTotalPnl }
  }, [holdings, cash, lastSpotChangePct])

  // ── Treemap data ─────────────────────────────────────────────────────────
  const treemapData = useMemo(() => {
    return holdings
      .filter((g) => {
        if (!g?.symbol) return false
        const exp = safeFloat(g.delta_adjusted_exposure)
        return exp != null && Math.abs(exp) > 0
      })
      .map((g) => {
        const isShort = g.is_short === true
        let perf: number, rawPerf: number
        if (period === '1d') {
          const wsChangePct = lastSpotChangePct?.[g.symbol] != null ? parseFloat(lastSpotChangePct![g.symbol]) : null
          const wsEffective = wsChangePct != null ? wsChangePct * (isShort ? -1 : 1) : null
          const backendPerf = safeFloat(g.effective_perf_1d)
          const backendRaw  = safeFloat(g.perf_1d)
          perf    = wsEffective ?? backendPerf ?? 0
          rawPerf = wsChangePct ?? backendRaw ?? 0
        } else {
          const staticPerf = getEffectivePerf(g, period)
          const staticRaw  = getRawPerf(g, period)
          const wsChangePct = lastSpotChangePct?.[g.symbol] != null ? parseFloat(lastSpotChangePct![g.symbol]) : null
          perf    = staticPerf != null ? staticPerf : (wsChangePct != null ? wsChangePct * (isShort ? -1 : 1) : 0)
          rawPerf = staticRaw  != null ? staticRaw  : (wsChangePct ?? 0)
        }
        return {
          name: g.symbol, size: Math.abs(safeFloat(g.delta_adjusted_exposure) ?? 0),
          perf, rawPerf, exposure: safeFloat(g.delta_adjusted_exposure) ?? 0, isShort,
        }
      })
      .filter((d) => d.size > 0 && d.name)
      .sort((a, b) => b.size - a.size)
  }, [holdings, period, lastSpotChangePct])

  const hadSettlement = lifecycleResult && lifecycleResult.expired + lifecycleResult.assigned > 0

  // Portfolio breadcrumb
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

  // ══════════════════════════════════════════════════════════════════════════
  // ── RENDER ─────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* ── Portfolio context indicator ──────────────────────────────── */}
      {selectedPortfolio && (
        <div className="flex items-center gap-2">
          {selectedPortfolio.is_folder ? (
            <svg className="w-3.5 h-3.5 shrink-0 text-v2-accent" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0 text-v2-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          )}
          <span className="text-ds-body-r text-v2-text-1">{selectedPortfolio.name}</span>
          {selectedPortfolio.is_folder && (
            <span className="text-ds-caption uppercase px-1.5 py-0.5 rounded-md
                             bg-v2-accent-soft text-v2-accent">
              {isEn ? 'Folder' : '文件夹'}
            </span>
          )}
        </div>
      )}

      {/* ── Lifecycle banner ─────────────────────────────────────────── */}
      {hadSettlement && (
        <div className="flex items-center gap-3 bg-v2-caution-bg border border-v2-caution/20 rounded-v2-lg px-4 py-3 text-xs">
          <span className="text-v2-caution font-bold">{t('lifecycle_notice')}</span>
          <span className="text-v2-text-2">
            {(lifecycleResult?.expired ?? 0) > 0 && <span className="mr-3">{lifecycleResult?.expired} expired</span>}
            {(lifecycleResult?.assigned ?? 0) > 0 && <span className="text-v2-caution font-bold">{lifecycleResult?.assigned} assigned</span>}
          </span>
        </div>
      )}

      {/* ── Tab Navigation ──────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <TabsV2 tabs={TAB_ITEMS} activeKey={activeTab} onChange={handleTabChange} />
      </div>

      {/* ════════════════════════════════════════════════════════════ */}
      {/* OVERVIEW TAB                                                */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        loading ? (
          <div className="space-y-8">
            <div className="h-32 bg-v2-surface border border-v2-border rounded-v2-lg ds-shimmer" />
            <div className="h-64 bg-v2-surface border border-v2-border rounded-v2-lg ds-shimmer" />
            <div className="h-72 bg-v2-surface border border-v2-border rounded-v2-lg ds-shimmer" />
          </div>
        ) : (
          <div className="space-y-10">
            {/* ── Hero — dominant, maximum breathing space ────── */}
            <div className="pt-2">
              <HeroSection metrics={heroMetrics} portfolioId={selectedPortfolioId} isEn={isEn} isLoading={loading} />
            </div>

            {/* ── NLV Chart — pure curve, no container ───────── */}
            <PortfolioHistoryChart portfolioId={selectedPortfolioId} />

            {/* ── Treemap — raw surface, no card wrapper ─────── */}
            {treemapData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-v2-text-3 text-xs">
                {isEn ? 'No positions' : '暂无持仓'}
              </div>
            ) : (
              <div className="rounded-v2-lg overflow-hidden">
                <ResponsiveContainer width="100%" height={340}>
                  <Treemap data={treemapData} dataKey="size" aspectRatio={4/3} stroke="#fff" content={CustomCell}>
                    <Tooltip content={TreemapTooltip} />
                  </Treemap>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* DETAILS TAB                                                 */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === 'details' && (
        loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 bg-v2-surface border border-v2-border rounded-v2-lg ds-shimmer" />
            ))}
          </div>
        ) : (
          <HoldingsTableV2 groups={holdings} />
        )
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* RECORDS TAB                                                 */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === 'records' && (
        <TradeRecordTimeline portfolioId={selectedPortfolioId} isFolder={selectedPortfolio?.is_folder ?? false} />
      )}
    </div>
  )
}
