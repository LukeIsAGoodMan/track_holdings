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
  PieChart, Pie, Cell,
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
const GRID_COLS = 'grid grid-cols-[minmax(120px,1fr)_70px_90px_90px_110px_110px_110px_90px_56px] gap-x-3'

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
          <div key={group.symbol} className="rounded-v2-lg overflow-hidden mb-1"
               style={{ borderLeft: `3px solid ${deltaVal >= 0 ? '#4a9a6b' : '#c05c56'}` }}>

            {/* ═══ POSITION HEADER — compact: symbol left, metrics right ═══ */}
            <button
              onClick={() => toggle(group.symbol)}
              className="w-full ds-hover-surface text-left"
            >
              <div className="flex items-center justify-between px-4 py-3">
                {/* Left: symbol + badge */}
                <div className="flex items-center gap-2.5">
                  <span className={`text-stone-400 text-xs ${isOpen ? 'rotate-90' : ''}`} style={{ transition: 'transform 120ms ease-out' }}>▶</span>
                  <span className="text-base font-semibold text-stone-800">{group.symbol}</span>
                  {hasOptions && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border ${strategyBadgeClass(group.strategy_type)}`}>
                      {group.strategy_label}
                    </span>
                  )}
                </div>

                {/* Right: labeled summary metrics — aligned to P&L / Day P&L / Δ Exp columns */}
                <div className="flex items-start justify-end gap-5 tnum ml-auto shrink">
                  {group.total_pnl != null && (
                    <div className="text-right min-w-0">
                      <div className="text-xs uppercase tracking-wider text-stone-400 mb-0.5">{t('total_pnl')}</div>
                      <div className={`text-sm font-medium ${signClass(group.total_pnl)}`}>{fmtUSDSigned(group.total_pnl)}</div>
                    </div>
                  )}
                  {groupDayPnl != null && (
                    <div className="text-right min-w-0">
                      <div className="text-xs uppercase tracking-wider text-stone-400 mb-0.5">{t('col_day_pnl')}</div>
                      <div className={`text-sm font-medium ${signClass(String(groupDayPnl))}`}>{fmtUSDSigned(String(groupDayPnl))}</div>
                    </div>
                  )}
                  <div className="text-right min-w-0">
                    <div className="text-xs uppercase tracking-wider text-stone-400 mb-0.5">{t('col_delta_exp')}</div>
                    <div className={`text-sm font-medium ${deltaVal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {fmtSigned(group.total_delta_exposure)}
                    </div>
                  </div>
                </div>
              </div>
            </button>

            {/* ═══ EXPANDED BREAKDOWN ═══════════════════════════ */}
            {isOpen && (
              <div className="border-t border-stone-100">
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

// ── Sector Donut Chart ───────────────────────────────────────────────────────

// Muted multi-hue institutional palette — adjacent slices always differ in hue
const SECTOR_PALETTE = [
  '#1e293b', // slate core
  '#0f766e', // muted teal
  '#92400e', // muted amber
  '#334155', // slate lighter
  '#4338ca', // muted indigo
  '#3f6212', // muted olive
  '#7c2d12', // muted rust
  '#475569', // slate mid
  '#64748b', // slate soft
]

const ASSET_CLASS_KEYS_SET = new Set(['Stock', 'ETF/Index', 'Crypto', 'Option'])

function SectorDonut({ sectorExp, isEn }: { sectorExp: Record<string, string> | null | undefined; isEn: boolean }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  const data = useMemo(() => {
    if (!sectorExp) return []
    const map: Record<string, number> = {}
    let otherTotal = 0
    for (const [key, v] of Object.entries(sectorExp)) {
      const val = Math.abs(parseFloat(v) || 0)
      if (val < 0.01) continue
      if (ASSET_CLASS_KEYS_SET.has(key)) { otherTotal += val } else { map[key] = (map[key] ?? 0) + val }
    }
    if (otherTotal > 0.01) map['Other'] = (map['Other'] ?? 0) + otherTotal
    return Object.entries(map)
      .map(([name, value], i) => ({ name, value, color: SECTOR_PALETTE[i % SECTOR_PALETTE.length] }))
      .sort((a, b) => b.value - a.value)
  }, [sectorExp])

  if (data.length === 0) return null
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex items-start gap-6">
      {/* Donut — left, larger */}
      <div className="w-52 h-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} dataKey="value" cx="50%" cy="50%"
              innerRadius="60%" outerRadius="92%"
              strokeWidth={1} stroke="rgba(255,255,255,0.8)"
              isAnimationActive={false}
              onMouseEnter={(_, idx) => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
              label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                if (percent < 0.10) return null
                const RADIAN = Math.PI / 180
                const r = (Number(innerRadius) + Number(outerRadius)) / 2
                const x = Number(cx) + r * Math.cos(-midAngle * RADIAN)
                const y = Number(cy) + r * Math.sin(-midAngle * RADIAN)
                return (
                  <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={500}>
                    {`${(percent * 100).toFixed(0)}%`}
                  </text>
                )
              }}
              labelLine={false}
            >
              {data.map((d, i) => (
                <Cell
                  key={d.name}
                  fill={d.color}
                  opacity={activeIdx != null && activeIdx !== i ? 0.35 : 1}
                  style={{ transition: 'opacity 120ms ease-out' }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend — right, vertical structured list */}
      <div className="flex-1 min-w-0 space-y-2 pt-3">
        {data.slice(0, 8).map((d, i) => {
          const pct = total > 0 ? Math.round(d.value / total * 100) : 0
          const isActive = activeIdx === i
          return (
            <button
              key={d.name}
              type="button"
              className={`flex items-center gap-2.5 w-full text-left ds-color cursor-pointer rounded-v2-sm px-1 py-0.5 ${
                isActive ? 'bg-stone-100/60' : ''
              }`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
              onClick={() => setActiveIdx(activeIdx === i ? null : i)}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
              <span className={`truncate flex-1 text-xs ${isActive ? 'text-stone-800' : 'text-stone-600'}`}>{d.name}</span>
              <span className={`tnum text-xs font-medium shrink-0 ${isActive ? 'text-stone-800' : 'text-stone-500'}`}>{pct}%</span>
            </button>
          )
        })}
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

            {/* ── Treemap — raw surface, no card wrapper ─────── */}
            {treemapData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-v2-text-3 text-xs">
                {t('no_positions_short')}
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

              {/* Right column (40%) — Sector Donut */}
              {riskDash && Object.keys(riskDash.sector_exposure ?? {}).length > 0 && (
                <div className="w-[40%] shrink-0">
                  <div className="text-xs font-medium uppercase tracking-wider text-stone-500 mb-4">
                    {t('sector_exposure')}
                  </div>
                  <SectorDonut sectorExp={riskDash.sector_exposure} isEn={isEn} />
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
