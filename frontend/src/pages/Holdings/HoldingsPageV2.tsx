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
import { fmtUSD, fmtUSDSigned, fmtNum, fmtSigned, fmtGreek, dteBadgeClass, signClass } from '@/utils/format'
import PortfolioHistoryChart from '@/components/PortfolioHistoryChart'
import HeroSection           from '@/design-system/workspace/HeroSection'
import TradeRecordTimeline   from '@/design-system/workspace/TradeRecordTimeline'
import ActivityPanel         from '@/design-system/workspace/ActivityPanel'
import SectionCard           from '@/design-system/primitives/SectionCard'
import TabsV2               from '@/design-system/primitives/TabsV2'
import HoldingChartPanel     from '@/components/holdings/HoldingChartPanel'
import { useHoldingChartPanel } from '@/components/holdings/useHoldingChartPanel'

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
  const onCellClick = props.onCellClick as ((name: string) => void) | undefined

  const fill  = perfColor(perf)
  const label = isShort ? `${name} (S)` : name

  if (width <= 0 || height <= 0) return <g />

  const fontSize    = Math.min(13, Math.max(8, width / 6))
  const subFontSize = Math.min(11, Math.max(8, width / 8))
  const showText    = width > 36 && height > 22

  return (
    <g style={{ cursor: 'pointer' }} onClick={() => name && onCellClick?.(name)}>
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
            style={{ pointerEvents: 'none' }}
          >
            {label || '?'}
          </text>
          {height > 40 && perf != null && (
            <text
              x={x + width / 2} y={y + height / 2 + 10}
              textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,0.7)"
              fontSize={subFontSize} fontWeight="400" fontFamily="Inter, sans-serif"
              style={{ pointerEvents: 'none' }}
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
function TreemapTooltip({ active, payload, periodLabel, t }: {
  active?: boolean; payload?: readonly unknown[]; periodLabel: string
  t: (key: string) => string
}) {
  if (!active || !payload?.length) return null
  const item      = (payload[0] ?? {}) as Record<string, unknown>
  const name      = (typeof item.name     === 'string') ? item.name     : String(item.name ?? '?')
  const perf      = (typeof item.perf     === 'number' && isFinite(item.perf))     ? item.perf     : null
  const rawPerf   = (typeof item.rawPerf  === 'number' && isFinite(item.rawPerf))  ? item.rawPerf  : null
  const perf1d    = (typeof item.perf1d   === 'number' && isFinite(item.perf1d as number))   ? item.perf1d as number   : null
  const rawPerf1d = (typeof item.rawPerf1d === 'number' && isFinite(item.rawPerf1d as number)) ? item.rawPerf1d as number : null
  const exposure  = (typeof item.exposure === 'number') ? item.exposure : null
  const isShort   = (item.isShort === true)

  return (
    <div className="bg-v2-surface border border-v2-border rounded-v2-md shadow-v2-lg px-3 py-2.5 text-xs min-w-[175px]">
      <div className="font-bold text-v2-text-1 text-sm mb-1.5 flex items-center gap-1.5">
        {name || '?'}
        {isShort && (
          <span className="text-ds-caption text-v2-negative bg-v2-negative-bg px-1 py-0.5 rounded">(S)</span>
        )}
      </div>
      <div className="space-y-0.5 text-v2-text-3">
        {exposure != null && (
          <div>{t('tm_notional')}: <span className="font-bold text-v2-text-1">{fmtUSD(String(exposure))}</span></div>
        )}
        {rawPerf != null && (
          <div>
            {t('tm_underlying')} ({periodLabel}):{' '}
            <span className={`font-bold ${rawPerf >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
              {rawPerf >= 0 ? '+' : ''}{rawPerf.toFixed(2)}%
            </span>
          </div>
        )}
        {perf != null && (
          <div className="border-t border-v2-border pt-0.5 mt-0.5">
            {t('tm_pnl_dir')} ({periodLabel}):{' '}
            <span className={`font-bold ${perf >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
              {perf >= 0 ? '+' : ''}{perf.toFixed(2)}%
            </span>
          </div>
        )}
        {/* 1D comparison — shown when viewing non-1D periods */}
        {periodLabel !== '1D' && periodLabel !== '1日' && rawPerf1d != null && (
          <div className="text-v2-text-3 pt-0.5">
            {t('tm_1d_compare')}:{' '}
            <span className={`font-medium ${rawPerf1d >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
              {rawPerf1d >= 0 ? '+' : ''}{rawPerf1d.toFixed(2)}%
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
function ExitBtn({ onClick, title, label }: { onClick: () => void; title?: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      className="px-2 py-0.5 rounded-v2-sm text-xs text-stone-400
                 hover:text-rose-500 hover:bg-rose-50
                 opacity-0 group-hover:opacity-100
                 cursor-pointer whitespace-nowrap"
      style={{ transition: 'opacity 200ms ease-out, color 150ms ease-out, background-color 150ms ease-out' }}
    >
      {label}
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
/** Grid column template for the financial matrix (9-col trading surface) */
const GRID_COLS = 'grid grid-cols-[minmax(120px,1fr)_70px_90px_90px_110px_110px_110px_90px_56px] gap-x-3 min-w-[910px]'

/** Grid header cell */
function GH({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <div className={`text-right text-xs uppercase tracking-wider text-stone-400 font-medium py-2 ${className}`}>{children}</div>
}

/** Grid data cell — py-3 for comfortable scan */
function GD({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <div className={`text-right text-sm tnum py-3 ${className}`}>{children}</div>
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

// ── Option market value derivation ───────────────────────────────────────────
const CONTRACT_MULTIPLIER = 100

/** Derive option position market value: backend explicit > cost+pnl fallback */
function deriveOptionMarketValue(leg: OptionLeg): number | null {
  const cost    = safeFloat(leg.avg_open_price)
  const qty     = leg.net_contracts
  const pnl     = safeFloat(leg.total_pnl)
  if (cost == null || qty == null || pnl == null) return null
  return qty * cost * CONTRACT_MULTIPLIER + pnl
}

// ── Holdings Table (V2) ──────────────────────────────────────────────────────
function HoldingsTableV2({ groups, onOpenChart }: { groups: HoldingGroup[]; onOpenChart?: (symbol: string) => void }) {
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
    const qty = Math.abs(leg.net_contracts)
    const action: TradeAction = leg.net_contracts < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    openTradeEntry({ symbol, instrumentType: 'OPTION', optionType: leg.option_type, strike: leg.strike, expiry: leg.expiry, action, quantity: String(qty) })
  }

  function closeStock(symbol: string, leg: StockLeg) {
    const qty = Math.abs(leg.net_shares)
    const action: TradeAction = leg.net_shares < 0 ? 'BUY_CLOSE' : 'SELL_CLOSE'
    openTradeEntry({ symbol, instrumentType: 'STOCK', action, quantity: String(qty) })
  }

  if (groups.length === 0) {
    return <div className="text-center py-10 text-stone-400 text-sm">{t('no_positions')}</div>
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isOpen = !collapsed.has(group.symbol)
        const deltaVal = parseFloat(group.total_delta_exposure)
        const hasOptions = group.option_legs.length > 0
        const hasStocks = group.stock_legs.length > 0
        const marginVal = parseFloat(group.total_maintenance_margin ?? '0')
        const groupDayPnl = safeFloat(group.daily_pnl) ?? safeFloat(group.bs_pnl_1d)

        return (
          <div key={group.symbol} className="rounded-v2-lg mb-1"
               style={{ borderLeft: `3px solid ${deltaVal >= 0 ? '#4a9a6b' : '#c05c56'}` }}>

            {/* ═══ POSITION HEADER — uses GRID_COLS for pixel-perfect column alignment ═══ */}
            <button
              onClick={() => toggle(group.symbol)}
              className="w-full ds-hover-surface text-left"
            >
              <div className={`${GRID_COLS} px-4 py-3 items-center`}>
                {/* Asset: symbol + chevron + badge */}
                <div className="flex items-center gap-2 text-left min-w-0">
                  <span className={`text-stone-400 text-xs shrink-0 ${isOpen ? 'rotate-90' : ''}`} style={{ transition: 'transform 120ms ease-out' }}>▶</span>
                  <span className="text-base font-semibold text-stone-800 truncate">{group.symbol}</span>
                  {onOpenChart && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); onOpenChart(group.symbol) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenChart(group.symbol) } }}
                      className="shrink-0 text-stone-400 hover:text-emerald-600 cursor-pointer p-1 rounded-v2-sm hover:bg-stone-100"
                      title={group.symbol}
                      style={{ transition: 'color 150ms ease-out, background-color 150ms ease-out' }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </span>
                  )}
                  {hasOptions && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border shrink-0 ${strategyBadgeClass(group.strategy_type)}`}>
                      {group.strategy_label}
                    </span>
                  )}
                </div>
                {/* Qty — empty */}
                <div />
                {/* Cost — empty */}
                <div />
                {/* Spot — empty */}
                <div />
                {/* Market — empty */}
                <div />
                {/* P&L — aligned to column */}
                <div className="text-right tnum">
                  {group.total_pnl != null && (
                    <>
                      <div className="text-xs uppercase tracking-wider text-stone-400 mb-0.5">{t('total_pnl')}</div>
                      <div className={`text-sm font-medium ${signClass(group.total_pnl)}`}>{fmtUSDSigned(group.total_pnl)}</div>
                    </>
                  )}
                </div>
                {/* Day P&L — aligned to column */}
                <div className="text-right tnum">
                  {groupDayPnl != null && (
                    <>
                      <div className="text-xs uppercase tracking-wider text-stone-400 mb-0.5">{t('col_day_pnl')}</div>
                      <div className={`text-sm font-medium ${signClass(String(groupDayPnl))}`}>{fmtUSDSigned(String(groupDayPnl))}</div>
                    </>
                  )}
                </div>
                {/* Δ Exp — aligned to column */}
                <div className="text-right tnum">
                  <div className="text-xs uppercase tracking-wider text-stone-400 mb-0.5">{t('col_delta_exp')}</div>
                  <div className={`text-sm font-medium ${deltaVal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {fmtSigned(group.total_delta_exposure)}
                  </div>
                </div>
                {/* Action — empty */}
                <div />
              </div>
            </button>

            {/* ═══ EXPANDED BREAKDOWN ═══════════════════════════ */}
            {isOpen && (
              <div className="border-t border-stone-100 overflow-x-auto">
                {/* Column header */}
                <div className={`${GRID_COLS} px-4 border-b border-stone-100 bg-stone-50/40`}>
                  <GH className="text-left">{t('col_asset')}</GH>
                  <GH>{t('col_qty')}</GH>
                  <GH>{t('col_cost')}</GH>
                  <GH>{t('col_spot')}</GH>
                  <GH>{t('col_market')}</GH>
                  <GH>{t('col_pnl')}</GH>
                  <GH>{t('col_day_pnl')}</GH>
                  <GH>{t('col_delta_exp')}</GH>
                  <GH />
                </div>

                {/* ── Stock rows ───────────────────────────────── */}
                {hasStocks && group.stock_legs.map(leg => {
                  const isLong = leg.net_shares > 0
                  const stockDayPnl = safeFloat(leg.daily_pnl)
                  return (
                    <div key={leg.instrument_id} className={`${GRID_COLS} px-4 ds-table-row group`}>
                      <GD className="text-left text-stone-600 pl-4">{t('label_stock')}</GD>
                      <GD><span className={`font-medium ${isLong ? 'text-emerald-600' : 'text-rose-500'}`}>{leg.net_shares > 0 ? '+' : ''}{leg.net_shares}</span></GD>
                      <GD className="text-stone-500">${fmtNum(leg.avg_open_price)}</GD>
                      <GD>{group.spot_price != null ? <span className="text-stone-700">${fmtNum(group.spot_price)}</span> : '—'}</GD>
                      <GD>{leg.market_value != null ? fmtUSD(leg.market_value) : '—'}</GD>
                      <GD>{leg.total_pnl != null ? <span className={`font-medium ${signClass(leg.total_pnl)}`}>{fmtUSDSigned(leg.total_pnl)}</span> : '—'}</GD>
                      <GD>{stockDayPnl != null ? <span className={`font-medium ${signClass(String(stockDayPnl))}`}>{fmtUSDSigned(String(stockDayPnl))}</span> : '—'}</GD>
                      <GD><span className={`font-medium ${parseFloat(leg.delta_exposure) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmtSigned(leg.delta_exposure)}</span></GD>
                      <GD>
                        <ExitBtn onClick={() => closeStock(group.symbol, leg)} title={`Close ${Math.abs(leg.net_shares)} shares`} label={t('label_exit')} />
                      </GD>
                    </div>
                  )
                })}

                {/* ── Option rows ──────────────────────────────── */}
                {hasOptions && (
                  <>
                    {hasStocks && <div className="mt-2 mx-4 border-t border-stone-200/60" />}
                    <div className="px-4 py-2 text-xs uppercase tracking-wider text-stone-400 font-medium pl-8">
                      {t('label_options')}
                    </div>
                    {group.option_legs.map(leg => {
                      const isLong = leg.net_contracts > 0
                      const optLabel = `${leg.option_type} $${fmtNum(leg.strike)} ${leg.expiry}`
                      const optMktVal = deriveOptionMarketValue(leg)
                      const optDayPnl = safeFloat(leg.daily_pnl)
                      return (
                        <div key={leg.instrument_id}>
                          <div className={`${GRID_COLS} px-4 ds-table-row group`}>
                            <GD className="text-left pl-6">
                              <span className={`text-xs px-1.5 py-0.5 rounded border ${leg.option_type === 'CALL' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                {t(leg.option_type === 'CALL' ? 'label_call' : 'label_put')}
                              </span>
                              <span className="ml-2 text-stone-600 tnum">${fmtNum(leg.strike)}</span>
                              <span className="ml-1.5 text-stone-400 text-xs">{leg.expiry}</span>
                              <span className={`ml-1.5 text-xs px-1 py-0.5 rounded ${dteBadgeClass(leg.days_to_expiry)}`}>{leg.days_to_expiry}d</span>
                            </GD>
                            <GD><span className={`font-medium ${isLong ? 'text-emerald-600' : 'text-rose-500'}`}>{leg.net_contracts > 0 ? '+' : ''}{leg.net_contracts}</span></GD>
                            <GD className="text-stone-500">${fmtNum(leg.avg_open_price)}</GD>
                            <GD className="text-stone-400">—</GD>
                            <GD title={t('opt_mkt_tooltip')}>{optMktVal != null ? fmtUSD(String(optMktVal)) : '—'}</GD>
                            <GD>{leg.total_pnl != null ? <span className={`font-medium ${signClass(leg.total_pnl)}`}>{fmtUSDSigned(leg.total_pnl)}</span> : '—'}</GD>
                            <GD>{optDayPnl != null ? <span className={`font-medium ${signClass(String(optDayPnl))}`}>{fmtUSDSigned(String(optDayPnl))}</span> : '—'}</GD>
                            <GD>{leg.delta_exposure != null ? <span className={`font-medium ${signClass(leg.delta_exposure)}`}>{fmtSigned(leg.delta_exposure)}</span> : <ShimmerCell />}</GD>
                            <GD>
                              <ExitBtn onClick={() => closeOption(group.symbol, leg)} title={`Close ${optLabel}`} label={t('label_exit')} />
                            </GD>
                          </div>
                          {/* Greeks — aligned to 9-col grid, visually receded */}
                          {(leg.delta != null || leg.theta != null) && (
                            <div className={`${GRID_COLS} px-4 pb-1`}>
                              <div className="text-left pl-6 text-xs text-stone-400 font-light">{t('label_greeks')}</div>
                              <div />
                              <div className="text-right text-xs text-stone-400 font-light tnum">{leg.delta != null ? `Δ ${fmtGreek(leg.delta)}` : ''}</div>
                              <div className="text-right text-xs text-stone-400 font-light tnum">{leg.theta != null ? `Θ ${fmtGreek(leg.theta)}` : ''}</div>
                              <div />
                              <div />
                              <div />
                              <div className="text-right text-xs text-stone-400 font-light tnum">
                                {marginVal > 0.01 && leg.maintenance_margin && parseFloat(leg.maintenance_margin) > 0.01
                                  ? fmtUSD(leg.maintenance_margin) : ''}
                              </div>
                              <div />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Exposure Panel — multi-label center-axis bar visualization ────────────────
const EXPOSURE_ASSET_CLASS_KEYS = new Set(['Stock', 'ETF/Index', 'Crypto', 'Option'])
const TOP_N = 8

/** Normalize a tag name to a translation key: "Big Tech" → "tag_big_tech" */
function tagToI18nKey(tag: string): string {
  return 'tag_' + tag.toLowerCase().replace(/[\s/]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

interface ExposureRow {
  name: string       // raw tag name from backend
  i18nKey: string    // translation key
  notional: number   // signed notional market value
  pctOfNlv: number   // % of total portfolio NLV (signed)
}

function ExposurePanel({ sectorAlloc, portfolioNlv, isEn, t }: {
  sectorAlloc: Record<string, string> | null | undefined
  portfolioNlv: number
  isEn: boolean
  t: (key: string) => string
}) {
  const [showOthers, setShowOthers] = useState(false)

  const rows = useMemo<ExposureRow[]>(() => {
    if (!sectorAlloc) return []
    const entries: ExposureRow[] = []
    for (const [key, v] of Object.entries(sectorAlloc)) {
      if (EXPOSURE_ASSET_CLASS_KEYS.has(key)) continue
      const notional = parseFloat(v) || 0
      if (Math.abs(notional) < 0.01) continue
      const pctOfNlv = portfolioNlv > 0 ? (notional / portfolioNlv) * 100 : 0
      entries.push({ name: key, i18nKey: tagToI18nKey(key), notional, pctOfNlv })
    }
    entries.sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional))
    return entries
  }, [sectorAlloc, portfolioNlv])

  if (rows.length === 0) return null

  const topRows = rows.slice(0, TOP_N)
  const otherRows = rows.slice(TOP_N)
  const hasOthers = otherRows.length > 0

  // Scale: half-track = 100% of NLV; overflow allowed beyond
  const maxAbsPct = Math.max(100, ...rows.map(r => Math.abs(r.pctOfNlv)))

  return (
    <div className="space-y-1">
      {topRows.map((row) => (
        <ExposureBar key={row.name} row={row} maxAbsPct={maxAbsPct} t={t} />
      ))}

      {hasOthers && (
        <>
          <button
            type="button"
            onClick={() => setShowOthers(!showOthers)}
            className="flex items-center gap-1.5 w-full text-left px-1 py-1 text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
            style={{ transition: 'color 150ms ease-out' }}
          >
            <span className={`text-[10px] ${showOthers ? 'rotate-90' : ''}`} style={{ transition: 'transform 120ms ease-out' }}>▶</span>
            <span>{otherRows.length} {t('exp_n_more')}</span>
          </button>
          {showOthers && otherRows.map((row) => (
            <ExposureBar key={row.name} row={row} maxAbsPct={maxAbsPct} t={t} />
          ))}
        </>
      )}
    </div>
  )
}

/** Single exposure bar row — center-axis signed layout */
function ExposureBar({ row, maxAbsPct, t }: {
  row: ExposureRow; maxAbsPct: number; t: (key: string) => string
}) {
  const isLong = row.notional >= 0
  const absPct = Math.abs(row.pctOfNlv)
  // Half-width = 100% NLV; bar fills the appropriate side of center axis
  const barHalfPct = maxAbsPct > 0 ? Math.min(100, (absPct / maxAbsPct) * 100) : 0
  const isOverflow = absPct > 100

  // i18n: try translation key, fall back to raw tag name
  const translated = t(row.i18nKey)
  const label = translated !== row.i18nKey ? translated : row.name

  const barFill = isOverflow
    ? (isLong ? 'bg-emerald-500' : 'bg-rose-400')
    : (isLong ? 'bg-emerald-400/70' : 'bg-rose-400/70')

  const stripeGradient = isOverflow
    ? 'repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 5px)'
    : undefined

  return (
    <div className="rounded-v2-sm px-2 py-1.5 hover:bg-stone-50/60"
         style={{ transition: 'background-color 150ms ease-out' }}>
      {/* Label row: tag name (stacks above bar on narrow) + signed % */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-stone-600 truncate flex-1 mr-2">{label}</span>
        <span className={`tnum text-xs font-medium shrink-0 ${
          isLong ? 'text-emerald-600' : 'text-rose-500'
        }`}>
          {row.pctOfNlv >= 0 ? '+' : ''}{row.pctOfNlv.toFixed(1)}%
        </span>
      </div>

      {/* Center-axis bar track: left half = short, right half = long */}
      <div className="flex h-2 items-center">
        {/* Left half — short bars grow from center toward left */}
        <div className="flex-1 h-full flex justify-end overflow-hidden rounded-l-full bg-stone-100/60">
          {!isLong && (
            <div
              className={`h-full rounded-l-full ${barFill}`}
              style={{
                width: `${barHalfPct}%`,
                minWidth: absPct > 0.01 ? '2px' : '0px',
                transition: 'width 200ms ease-out',
                backgroundImage: stripeGradient,
              }}
            />
          )}
        </div>
        {/* Center axis */}
        <div className="w-px h-3 shrink-0" style={{ backgroundColor: '#78716c' }} />
        {/* Right half — long bars grow from center toward right */}
        <div className="flex-1 h-full flex justify-start overflow-hidden rounded-r-full bg-stone-100/60">
          {isLong && (
            <div
              className={`h-full rounded-r-full ${barFill}`}
              style={{
                width: `${barHalfPct}%`,
                minWidth: absPct > 0.01 ? '2px' : '0px',
                transition: 'width 200ms ease-out',
                backgroundImage: stripeGradient,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Page Component ───────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'overview' | 'details' | 'records'

export default function HoldingsPageV2() {
  const { selectedPortfolioId, refreshKey, triggerRefresh, portfolios } = usePortfolio()
  const { lang, t } = useLanguage()
  const { lastHoldingsUpdate, lastSpotChangePct } = useWebSocket()
  const chartPanel = useHoldingChartPanel()
  const isEn = lang !== 'zh'

  // Tab from URL
  const location  = useLocation()
  const navigate  = useNavigate()
  const activeTab: Tab = location.pathname.includes('/details') ? 'details'
    : location.pathname.includes('/records') ? 'records'
    : 'overview'

  const TAB_ITEMS = useMemo(() => [
    { key: 'overview', label: t('tab_overview') },
    { key: 'details',  label: t('tab_details') },
    { key: 'records',  label: t('tab_records') },
  ], [t])

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

        // Always compute 1D for tooltip cross-reference
        const wsChangePct = lastSpotChangePct?.[g.symbol] != null ? parseFloat(lastSpotChangePct![g.symbol]) : null
        const wsEffective1d = wsChangePct != null ? wsChangePct * (isShort ? -1 : 1) : null
        const backendPerf1d = safeFloat(g.effective_perf_1d)
        const backendRaw1d  = safeFloat(g.perf_1d)
        const perf1d    = wsEffective1d ?? backendPerf1d ?? 0
        const rawPerf1d = wsChangePct ?? backendRaw1d ?? 0

        let perf: number, rawPerf: number
        if (period === '1d') {
          perf    = perf1d
          rawPerf = rawPerf1d
        } else {
          const staticPerf = getEffectivePerf(g, period)
          const staticRaw  = getRawPerf(g, period)
          perf    = staticPerf != null ? staticPerf : (wsChangePct != null ? wsChangePct * (isShort ? -1 : 1) : 0)
          rawPerf = staticRaw  != null ? staticRaw  : (wsChangePct ?? 0)
        }
        return {
          name: g.symbol, size: Math.abs(safeFloat(g.delta_adjusted_exposure) ?? 0),
          perf, rawPerf, perf1d, rawPerf1d,
          exposure: safeFloat(g.delta_adjusted_exposure) ?? 0, isShort,
          onCellClick: chartPanel.openPanel,
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
          <span className="text-sm font-medium text-stone-700">{selectedPortfolio.name}</span>
          {selectedPortfolio.is_folder && (
            <span className="text-xs uppercase px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500">
              {t('label_folder')}
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

            {/* ── Treemap — period selector + heatmap ─────── */}
            <div>
              {/* Period selector — V2 pill style */}
              <div className="flex items-center gap-1 mb-3">
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 rounded-v2-md text-xs font-medium cursor-pointer ${
                      period === p
                        ? 'bg-stone-800 text-white'
                        : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
                    }`}
                    style={{ transition: 'background-color 150ms ease-out, color 150ms ease-out' }}
                  >
                    {PERIOD_LABELS[p]?.[isEn ? 'en' : 'zh'] ?? p}
                  </button>
                ))}
              </div>

              {treemapData.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-v2-text-3 text-xs">
                  {t('no_positions_short')}
                </div>
              ) : (
                <div className="rounded-v2-lg overflow-hidden">
                  <ResponsiveContainer width="100%" height={340}>
                    <Treemap data={treemapData} dataKey="size" aspectRatio={4/3} stroke="#fff" content={CustomCell}>
                      <Tooltip content={
                        <TreemapTooltip
                          periodLabel={PERIOD_LABELS[period]?.[isEn ? 'en' : 'zh'] ?? period}
                          t={t}
                        />
                      } />
                    </Treemap>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ── Divider + scroll hint ───────────────────────── */}
            <div className="pt-6 pb-2">
              <div className="border-t border-stone-200/40" />
              <div className="flex justify-center pt-3">
                <svg className="w-4 h-4 text-stone-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </div>

            {/* ═══ DEEP DIVE — 2-column below the fold ══════════ */}
            <div className="flex gap-8 pt-2">

              {/* Left column (60%) — Recent Activity */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium uppercase tracking-wider text-stone-500 mb-4">
                  {t('recent_activity')}
                </div>
                <ActivityPanel portfolioId={selectedPortfolioId} isEn={isEn} />
              </div>

              {/* Right column (40%) — Ranked Exposure Panel */}
              {riskDash && Object.keys(riskDash.sector_allocation ?? riskDash.sector_exposure ?? {}).length > 0 && (
                <div className="w-[40%] shrink-0">
                  <div className="text-xs font-medium uppercase tracking-wider text-stone-500 mb-4">
                    {t('sector_exposure')}
                  </div>
                  <ExposurePanel
                    sectorAlloc={riskDash.sector_allocation ?? riskDash.sector_exposure}
                    portfolioNlv={heroMetrics.portfolioValue}
                    isEn={isEn}
                    t={t}
                  />
                </div>
              )}
            </div>
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
          <HoldingsTableV2 groups={holdings} onOpenChart={chartPanel.openPanel} />
        )
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* RECORDS TAB                                                 */}
      {/* ════════════════════════════════════════════════════════════ */}
      {activeTab === 'records' && (
        <TradeRecordTimeline portfolioId={selectedPortfolioId} isFolder={selectedPortfolio?.is_folder ?? false} />
      )}

      {/* ── Holding Chart Panel (slide-over from treemap clicks) ──── */}
      <HoldingChartPanel
        open={chartPanel.isOpen}
        symbol={chartPanel.symbol}
        view={chartPanel.view}
        onClose={chartPanel.closePanel}
        onViewChange={chartPanel.setView}
        intraday5min={chartPanel.intraday5min}
        eodLight={chartPanel.eodLight}
        status={chartPanel.status}
      />
    </div>
  )
}
