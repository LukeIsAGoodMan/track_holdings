/**
 * Holdings Page — Tabbed layout (Overview | Details)
 *
 * Overview Tab:
 *   Hero Banner (4 stats) · History Chart
 *   Treemap (period filter) · Sector Pie Chart · AI Insights
 *
 * Details Tab:
 *   Positions Table · Transaction History
 */

// Module-level singleton: lifecycle sweep fires at most once per browser session.
let _lifecycleCalledThisSession = false

import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Treemap, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useLanguage }   from '@/context/LanguageContext'
import { useWebSocket }  from '@/context/WebSocketContext'
import { useSidebar }    from '@/context/SidebarContext'
import {
  fetchHoldings, fetchCash, fetchSettledTrades,
  triggerLifecycle, fetchRiskDashboard, fetchTransactionHistory,
} from '@/api/holdings'
import type {
  HoldingGroup, OptionLeg, StockLeg, CashSummary,
  TradeAction, ClosePositionState, SettledTrade, LifecycleResult,
  RiskDashboard, Transaction,
} from '@/types'
import { fmtUSD, fmtNum, fmtGreek, dteBadgeClass, signClass } from '@/utils/format'
import PortfolioHistoryChart from '@/components/PortfolioHistoryChart'
import AiInsightPanel        from '@/components/AiInsightPanel'

// ── Period ────────────────────────────────────────────────────────────────────
type Period = '1d' | '5d' | '1m' | '3m'
const PERIOD_LABELS: Record<Period, { en: string; zh: string }> = {
  '1d': { en: '1D', zh: '1日' },
  '5d': { en: '5D', zh: '5日' },
  '1m': { en: '1M', zh: '1月' },
  '3m': { en: '3M', zh: '3月' },
}

// ── Safe helpers ──────────────────────────────────────────────────────────────
function safeFloat(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return isFinite(n) ? n : null
}

// ── Treemap color helpers ─────────────────────────────────────────────────────
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

// ── Treemap custom cell ───────────────────────────────────────────────────────
// Recharts passes layout (x,y,w,h) + all data-item keys directly as props.
// Guard every access — Recharts may call content for parent/layout nodes too.
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

  // paint-order trick: stroke renders first → creates a dark outline/shadow
  const shadowStyle = { paintOrder: 'stroke fill' } as React.CSSProperties

  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(0, width - 2)} height={Math.max(0, height - 2)}
        fill={fill} rx={6} stroke="#ffffff" strokeWidth={2}
      />
      {showText && (
        <>
          <text
            x={x + width / 2} y={y + height / 2 - (height > 40 ? 9 : 0)}
            textAnchor="middle" dominantBaseline="middle"
            fill="white"
            stroke="rgba(0,0,0,0.45)" strokeWidth={2.5} strokeLinejoin="round"
            style={shadowStyle}
            fontSize={fontSize}
            fontWeight="800"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            {label || '?'}
          </text>
          {height > 40 && perf != null && (
            <text
              x={x + width / 2} y={y + height / 2 + 10}
              textAnchor="middle" dominantBaseline="middle"
              fill="white"
              stroke="rgba(0,0,0,0.35)" strokeWidth={2} strokeLinejoin="round"
              style={shadowStyle}
              fontSize={subFontSize}
              fontWeight="700"
              fontFamily="Plus Jakarta Sans, sans-serif"
            >
              {perf >= 0 ? '+' : ''}{perf.toFixed(2)}%
            </text>
          )}
        </>
      )}
    </g>
  )
}

// ── Treemap tooltip ───────────────────────────────────────────────────────────
function TreemapTooltip({ active, payload }: { active?: boolean; payload?: readonly unknown[] }) {
  if (!active || !payload?.length) return null
  const item     = (payload[0] ?? {}) as Record<string, unknown>
  const name     = (typeof item.name    === 'string') ? item.name    : String(item.name ?? '?')
  const perf     = (typeof item.perf    === 'number' && isFinite(item.perf))    ? item.perf    : null
  const rawPerf  = (typeof item.rawPerf === 'number' && isFinite(item.rawPerf)) ? item.rawPerf : null
  const exposure = (typeof item.exposure === 'number') ? item.exposure : null
  const isShort  = (item.isShort === true)

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-xs font-sans min-w-[165px]">
      <div className="font-bold text-slate-900 text-sm mb-1.5 flex items-center gap-1.5">
        {name || '?'}
        {isShort && (
          <span className="text-[10px] font-semibold text-rose-500 bg-rose-50 border border-rose-200 px-1 py-0.5 rounded">(S)</span>
        )}
      </div>
      <div className="space-y-0.5 text-slate-500">
        {exposure != null && (
          <div>Notional: <span className="font-semibold text-slate-800">{fmtUSD(String(exposure))}</span></div>
        )}
        {rawPerf != null && (
          <div>
            Underlying:{' '}
            <span className={`font-semibold ${rawPerf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {rawPerf >= 0 ? '+' : ''}{rawPerf.toFixed(2)}%
            </span>
          </div>
        )}
        {perf != null && (
          <div className="border-t border-slate-100 pt-0.5 mt-0.5">
            P&L direction:{' '}
            <span className={`font-bold ${perf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {perf >= 0 ? '+' : ''}{perf.toFixed(2)}%
            </span>
          </div>
        )}
        <div className="text-[10px] text-slate-400 italic mt-1">
          {isShort ? 'Bearish / net short delta' : 'Bullish / net long delta'}
        </div>
      </div>
    </div>
  )
}

// ── Hero stat card ────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, valueClass = 'text-slate-900',
}: {
  label: string; value: string; sub?: string; valueClass?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-4 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums leading-tight ${valueClass}`}>{value || '—'}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Sector Pie Chart ──────────────────────────────────────────────────────────
const SECTOR_COLORS = [
  '#0284c7', '#7c3aed', '#d97706', '#059669',
  '#ea580c', '#9333ea', '#2563eb', '#b45309',
  '#16a34a', '#dc2626', '#0891b2', '#c026d3',
]

interface SectorDatum { name: string; value: number; delta: number; color: string }

function SectorPieChart({
  sectorExp, isEn,
}: {
  sectorExp: Record<string, string> | null | undefined
  isEn: boolean
}) {
  const entries = sectorExp ? Object.entries(sectorExp) : []
  if (entries.length === 0) return null

  const sorted = [...entries].sort((a, b) => Math.abs(parseFloat(b[1])) - Math.abs(parseFloat(a[1])))
  const data: SectorDatum[] = sorted.map(([tag, deltaStr], i) => ({
    name:  tag,
    value: Math.max(0.001, Math.abs(parseFloat(deltaStr) || 0)),
    delta: parseFloat(deltaStr) || 0,
    color: SECTOR_COLORS[i % SECTOR_COLORS.length],
  }))
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
        {isEn ? 'Sector Exposure' : '板块敞口'}
      </div>
      <div className="flex items-center gap-6 flex-wrap">
        {/* Donut */}
        <div className="shrink-0">
          <ResponsiveContainer width={190} height={190}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload as SectorDatum | undefined
                  if (!d) return null
                  const pct = total > 0 ? (d.value / total * 100).toFixed(1) : '0'
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <div className="font-bold text-slate-900 mb-1">{d.name}</div>
                      <div className={d.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                        {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(2)} Δ
                      </div>
                      <div className="text-slate-400">{pct}% of exposure</div>
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2.5 min-w-0">
          {data.map((entry) => {
            const pct = total > 0 ? (entry.value / total * 100).toFixed(0) : '0'
            return (
              <div key={entry.name} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
                <span className="text-slate-700 truncate flex-1 font-medium min-w-0">{entry.name}</span>
                <span className={`tabular-nums font-semibold shrink-0 ${entry.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {entry.delta >= 0 ? '+' : ''}{entry.delta.toFixed(1)}Δ
                </span>
                <span className="text-slate-400 tabular-nums shrink-0 w-9 text-right">{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Holdings-table helpers ────────────────────────────────────────────────────
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

// ── Strategy Pie Chart ────────────────────────────────────────────────────────
const STRATEGY_COLORS: Record<string, string> = {
  IRON_CONDOR: '#7c3aed',
  VERTICAL:    '#0284c7',
  STRADDLE:    '#d97706',
  STRANGLE:    '#ea580c',
  CALENDAR:    '#059669',
  CUSTOM:      '#c026d3',
  SINGLE:      '#64748b',
}
const STRATEGY_LABELS: Record<string, string> = {
  IRON_CONDOR: 'Iron Condor',
  VERTICAL:    'Vertical',
  STRADDLE:    'Straddle',
  STRANGLE:    'Strangle',
  CALENDAR:    'Calendar',
  CUSTOM:      'Custom',
  SINGLE:      'Single',
}

interface PieDatum { name: string; displayName: string; value: number; color: string }

function StrategyPieChart({ holdings, isEn }: { holdings: HoldingGroup[]; isEn: boolean }) {
  const data = useMemo<PieDatum[]>(() => {
    const byStrategy: Record<string, number> = {}
    for (const g of holdings) {
      const type = g.strategy_type || 'SINGLE'
      const exp  = safeFloat(g.delta_adjusted_exposure) ?? 0
      if (exp > 0) byStrategy[type] = (byStrategy[type] ?? 0) + exp
    }
    return Object.entries(byStrategy)
      .map(([type, value]) => ({
        name:        type,
        displayName: STRATEGY_LABELS[type] ?? type,
        value,
        color:       STRATEGY_COLORS[type] ?? '#94a3b8',
      }))
      .sort((a, b) => b.value - a.value)
  }, [holdings])

  if (data.length === 0) return null

  const total = data.reduce((s, d) => s + d.value, 0)
  const label = isEn ? 'Strategy Mix' : '策略分布'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">{label}</div>
      <div className="flex items-center gap-6 flex-wrap">
        {/* Donut */}
        <div className="shrink-0">
          <ResponsiveContainer width={190} height={190}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="displayName"
                cx="50%" cy="50%"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload as PieDatum | undefined
                  if (!d) return null
                  const pct = total > 0 ? (d.value / total * 100).toFixed(1) : '0'
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <div className="font-bold text-slate-900 mb-1">{d.displayName}</div>
                      <div className="text-slate-500">{fmtUSD(String(Math.round(d.value)))} notional</div>
                      <div className="text-slate-400">{pct}% of exposure</div>
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="flex-1 space-y-2.5 min-w-0">
          {data.map((entry) => {
            const pct = total > 0 ? (entry.value / total * 100).toFixed(0) : '0'
            return (
              <div key={entry.name} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.color }} />
                <span className="text-slate-700 truncate flex-1 font-medium min-w-0">{entry.displayName}</span>
                <span className="text-slate-500 tabular-nums shrink-0">{fmtUSD(String(Math.round(entry.value)))}</span>
                <span className="text-slate-400 tabular-nums shrink-0 w-9 text-right">{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Risk Weather Card — Weather icons ─────────────────────────────────────────

function IconSun() {
  return (
    <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
      <circle cx="28" cy="28" r="11" fill="#FCD34D" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180
        return (
          <line key={deg}
            x1={28 + Math.cos(rad) * 16} y1={28 + Math.sin(rad) * 16}
            x2={28 + Math.cos(rad) * 23} y2={28 + Math.sin(rad) * 23}
            stroke="#F59E0B" strokeWidth="2.8" strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

function IconCloud() {
  return (
    <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
      <path
        d="M11 35c0-5.5 3.8-10 9-10a9.5 9.5 0 0 1 8.5-5.5A9.5 9.5 0 0 1 38 29h.5A7.5 7.5 0 0 1 38.5 44H11A8.5 8.5 0 0 1 11 35z"
        fill="#94A3B8"
      />
    </svg>
  )
}

function IconRain() {
  return (
    <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
      <path
        d="M9 31c0-5.5 3.8-10 9-10a9.5 9.5 0 0 1 8.5-5.5A9.5 9.5 0 0 1 36 25h.5A7.5 7.5 0 0 1 36.5 40H9A8.5 8.5 0 0 1 9 31z"
        fill="#64748B"
      />
      <line x1="17" y1="44" x2="14" y2="52" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="26" y1="44" x2="23" y2="52" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="35" y1="44" x2="32" y2="52" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function IconStorm() {
  return (
    <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
      <path
        d="M8 29c0-5.5 3.8-10 9-10a9.5 9.5 0 0 1 8.5-5.5A9.5 9.5 0 0 1 35 23h.5A7.5 7.5 0 0 1 35.5 38H8A8.5 8.5 0 0 1 8 29z"
        fill="#475569"
      />
      <polyline
        points="30,38 24,48 28,46 22,56"
        stroke="#FCD34D" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

type RegimeCfg = {
  icon: React.ReactNode
  label: string; labelZh: string
  glow: string; iconBg: string; textClass: string
}

const REGIME_CFG: Record<string, RegimeCfg> = {
  low_vol_bullish: {
    icon: <IconSun />,
    label: 'Bullish',       labelZh: '看涨行情',
    glow:    'drop-shadow(0 0 10px rgba(251,191,36,0.70))',
    iconBg:  'bg-amber-50',   textClass: 'text-amber-500',
  },
  low_vol_range: {
    icon: <IconCloud />,
    label: 'Range-Bound',   labelZh: '震荡行情',
    glow:    'drop-shadow(0 0 7px rgba(148,163,184,0.50))',
    iconBg:  'bg-slate-50',   textClass: 'text-slate-500',
  },
  rising_vol: {
    icon: <IconCloud />,
    label: 'Volatile',      labelZh: '波动加剧',
    glow:    'drop-shadow(0 0 8px rgba(100,116,139,0.45))',
    iconBg:  'bg-slate-100',  textClass: 'text-slate-600',
  },
  high_vol_selloff: {
    icon: <IconRain />,
    label: 'Sell-Off',      labelZh: '抛售压力',
    glow:    'drop-shadow(0 0 10px rgba(147,197,253,0.65))',
    iconBg:  'bg-blue-50',    textClass: 'text-blue-600',
  },
  crisis: {
    icon: <IconStorm />,
    label: 'Crisis',        labelZh: '市场危机',
    glow:    'drop-shadow(0 0 13px rgba(244,63,94,0.65))',
    iconBg:  'bg-rose-50',    textClass: 'text-rose-600',
  },
}

function vixFillColor(v: number): string {
  if (v < 15) return '#34d399'   // emerald
  if (v < 20) return '#a3e635'   // lime
  if (v < 25) return '#f59e0b'   // amber
  if (v < 30) return '#f97316'   // orange
  return '#f43f5e'               // rose
}

const VIX_MAX = 40

function RiskWeatherCard({ riskDash, isEn }: { riskDash: RiskDashboard | null; isEn: boolean }) {
  const { lastMacroTicker } = useWebSocket()

  const theta     = riskDash ? parseFloat(riskDash.total_theta_daily) : 0
  const var1d     = riskDash?.var_1d_95 != null ? parseFloat(riskDash.var_1d_95) : null
  const alerts    = riskDash?.risk_alerts ?? []

  const regime    = lastMacroTicker?.market_regime ?? 'low_vol_range'
  const vixLevel  = lastMacroTicker?.vix_level ?? null
  const vixTerm   = lastMacroTicker?.vix_term ?? null

  const isBackwardation = vixTerm === 'elevated' || vixTerm === 'crisis'
  const cfg      = REGIME_CFG[regime] ?? REGIME_CFG['low_vol_range']!
  const vixPct   = vixLevel != null ? Math.min((vixLevel / VIX_MAX) * 100, 100) : null
  const vixColor = vixLevel != null ? vixFillColor(vixLevel) : '#e2e8f0'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between min-h-[260px]">

      {/* Label */}
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
        {isEn ? 'Risk Weather' : '风险状态'}
      </div>

      {/* ── Regime icon + label ───────────────────────────────────────── */}
      <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${cfg.iconBg}`}>
        <div className="w-12 h-12 shrink-0" style={{ filter: cfg.glow }}>
          {cfg.icon}
        </div>
        <div className="flex flex-col leading-tight">
          <span className={`text-sm font-black tracking-wide ${cfg.textClass}`}>
            {isEn ? cfg.label : cfg.labelZh}
          </span>
          <span className="text-[10px] text-slate-400 mt-0.5 capitalize">
            {regime.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* ── VIX Gauge ─────────────────────────────────────────────────── */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">VIX</span>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: vixColor }}>
            {vixLevel != null ? vixLevel.toFixed(1) : '—'}
          </span>
        </div>
        {/* Track */}
        <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
          {/* Static zone background */}
          <div className="absolute inset-0 flex pointer-events-none">
            <div style={{ width: `${(15 / VIX_MAX) * 100}%`, background: 'linear-gradient(90deg,#34d39966,#34d39911)' }} />
            <div style={{ width: `${(10 / VIX_MAX) * 100}%`, background: 'linear-gradient(90deg,#f59e0b33,#f59e0b66)' }} />
            <div style={{ flex: 1, background: 'linear-gradient(90deg,#f9731666,#f43f5e55)' }} />
          </div>
          {/* Live fill */}
          {vixPct != null && (
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
              style={{ width: `${vixPct}%`, background: vixColor, boxShadow: `0 0 6px ${vixColor}` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[9px] font-medium tracking-wide">
          <span className="text-emerald-500">0–15 {isEn ? 'Calm' : '平静'}</span>
          <span className="text-amber-500">15–25 {isEn ? 'Caution' : '注意'}</span>
          <span className="text-rose-500">25+ {isEn ? 'Storm' : '风暴'}</span>
        </div>
      </div>

      {/* ── Term Structure ────────────────────────────────────────────── */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {isEn ? 'VIX Term Structure' : 'VIX期限结构'}
          </span>
          <span className={`text-xs font-bold mt-0.5 ${isBackwardation ? 'text-rose-600' : 'text-emerald-600'}`}>
            {isBackwardation ? (isEn ? 'Backwardation' : '期限倒挂') : (isEn ? 'Contango' : '远期升水')}
          </span>
          <span className="text-[9px] text-slate-400 mt-0.5 leading-snug">
            {isBackwardation
              ? (isEn ? 'Near-term fear · Γ risk up' : '近端恐慌 · Gamma风险上升')
              : (isEn ? 'Normal roll · Θ carry healthy' : '正常展期 · Theta收益健康')}
          </span>
        </div>
        {isBackwardation ? (
          <svg viewBox="0 0 36 36" className="w-8 h-8 shrink-0" fill="none">
            <path d="M6 10 L30 28" stroke="#f43f5e" strokeWidth="3" strokeLinecap="round" />
            <polyline points="22,28 30,28 30,20" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 36 36" className="w-8 h-8 shrink-0" fill="none">
            <path d="M6 28 L30 10" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
            <polyline points="22,10 30,10 30,18" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* ── Quick stats ───────────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Θ/day</div>
          <div className={`text-xs font-bold tabular-nums mt-0.5 ${theta >= 0 ? 'text-amber-600' : 'text-rose-600'}`}>
            {theta >= 0 ? '+' : ''}{theta.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
            {isEn ? '1d VaR 95%' : '单日VaR'}
          </div>
          <div className="text-xs font-bold tabular-nums mt-0.5 text-rose-600">
            {var1d != null ? `-${fmtUSD(String(Math.round(var1d)))}` : '—'}
          </div>
        </div>
      </div>

      {/* ── Alert pill ───────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-snug">
          <span className="shrink-0">⚠</span>
          <span className="truncate flex-1">{alerts[0]}</span>
          {alerts.length > 1 && <span className="shrink-0 text-amber-500">+{alerts.length - 1}</span>}
        </div>
      )}
    </div>
  )
}

// ── ShimmerCell ───────────────────────────────────────────────────────────────
function ShimmerCell({ w = 'w-12' }: { w?: string }) {
  return <span className={`inline-block h-3.5 ${w} bg-slate-200 rounded animate-pulse`} />
}

// ── Exit button ───────────────────────────────────────────────────────────────
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

// ── Stock legs table ──────────────────────────────────────────────────────────
// ── Asset class badge (Phase 15.3) ────────────────────────────────────────────
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
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${b.cls}`}>
      {b.label}
    </span>
  )
}

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
    <div className="overflow-x-auto border-b border-slate-100">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="th-left">
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold pl-4 py-2 block">
                Asset Class
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
                  <AssetBadge type={assetClass} />
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

// ── Holdings table ────────────────────────────────────────────────────────────
function HoldingsTable({ groups }: { groups: HoldingGroup[] }) {
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

        const totalGamma = sumGreekExposure(group.option_legs, 'gamma')
        const totalTheta = sumGreekExposure(group.option_legs, 'theta')
        const totalLegs  = group.option_legs.length + group.stock_legs.length
        const hasOptions = group.option_legs.length > 0
        const hasStocks  = group.stock_legs.length > 0
        const greeksLoading = hasOptions && group.option_legs.some(l => l.delta == null)

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
              {/* ── Group header ─────────────────────────────────────────── */}
              <button
                onClick={() => toggle(group.symbol)}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-100
                           bg-slate-50/60 hover:bg-slate-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`text-slate-400 text-xs transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}>
                    ▶
                  </span>
                  <span className="font-bold text-slate-900 text-base">{group.symbol}</span>
                  {group.spot_price ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500 tabular-nums">
                        ${fmtNum(group.spot_price)}
                      </span>
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
                      openPriceAlerts({
                        symbol: group.symbol,
                        price:  parseFloat(group.spot_price ?? '0'),
                      })
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click() }}
                    title={`${t('alert_set_for')} ${group.symbol}`}
                    className="cursor-pointer px-1 py-0.5 rounded text-slate-400 hover:text-amber-600
                               hover:bg-amber-50 transition-colors"
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-semibold">
                      +stock
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs tabular-nums">
                  {fmtEfficiency(group.capital_efficiency) && (
                    <div className="text-right">
                      <div className="text-slate-400 uppercase tracking-wider text-[10px] mb-0.5">
                        {t('cap_efficiency')}
                      </div>
                      <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold ${efficiencyClass(group.capital_efficiency)}`}>
                        {fmtEfficiency(group.capital_efficiency)}
                      </span>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-slate-400 uppercase tracking-wider text-[10px]">
                      {t('delta_exposure')}
                    </div>
                    {greeksLoading ? (
                      <ShimmerCell w="w-16" />
                    ) : (
                      <div className={`font-bold text-sm ${signClass(group.total_delta_exposure)}`}>
                        {fmtNum(group.total_delta_exposure)}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400 uppercase tracking-wider text-[10px]">
                      {t('margin_req')}
                    </div>
                    <div className="text-slate-700 font-semibold">
                      {fmtUSD(group.total_maintenance_margin)}
                    </div>
                  </div>
                </div>
              </button>

              {/* ── Expanded body ─────────────────────────────────────── */}
              {!isCollapsed && (
                <>
                  {hasStocks && (
                    <StockLegsTable
                      legs={group.stock_legs}
                      spot={group.spot_price}
                      symbol={group.symbol}
                      assetClass={group.asset_class}
                      onClose={closeStock}
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
                          {group.option_legs.map((leg) => {
                            const isShort  = leg.net_contracts < 0
                            const deltaPos = leg.delta_exposure != null && parseFloat(leg.delta_exposure) > 0
                            return (
                              <tr key={leg.instrument_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                <td className="td-left">
                                  <span className={`px-2 py-0.5 rounded-md text-xs font-bold border
                                    ${leg.option_type === 'PUT'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-primary-soft text-primary border-primary/20'
                                    }`}>
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
                            <td colSpan={6} className="td-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                              Σ Exposure
                            </td>
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
                            <td className="td" />
                            <td className="td" />
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
        className="w-full flex items-center justify-between px-5 py-3.5
                   hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('settled_history')}
          </span>
          {total > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">
              {total}
            </span>
          )}
          {sinceHours === 24 && total > 0 && hasAssigned && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>
        <span className={`text-slate-400 text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
          ▶
        </span>
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
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
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
                          {row.option_type ? (
                            <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold border
                              ${row.option_type === 'PUT'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-primary-soft text-primary border-primary/20'
                              }`}>
                              {row.option_type}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md text-xs font-bold border bg-teal-50 text-teal-700 border-teal-200">
                              STOCK
                            </span>
                          )}
                        </td>
                        <td className="td text-slate-700">{row.strike ? `$${fmtNum(row.strike)}` : '—'}</td>
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
                              {row.auto_stock_action.replace('_', ' ')} {row.auto_stock_quantity}sh @ {' '}
                              <span className={isBuyOpen ? 'text-rose-600' : 'text-emerald-600'}>
                                ${fmtNum(row.auto_stock_price ?? '0')}
                              </span>
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
                            ? <span className={`font-mono font-semibold ${isBuyOpen ? 'text-sky-600' : 'text-emerald-600'}`}>
                                ${fmtNum(row.effective_cost_per_share)}
                              </span>
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

// ── Transaction History ───────────────────────────────────────────────────────
type SortField = 'date' | 'symbol' | 'action' | 'price'
type SortDir   = 'asc' | 'desc'

const ACTION_BADGE: Record<string, string> = {
  SELL_OPEN:  'bg-rose-50 text-rose-700 border border-rose-200',
  BUY_OPEN:   'bg-sky-50 text-sky-700 border border-sky-200',
  BUY_CLOSE:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  SELL_CLOSE: 'bg-amber-50 text-amber-700 border border-amber-200',
}

function TransactionHistorySection({ portfolioId }: { portfolioId: number | null | undefined }) {
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const [open,  setOpen]  = useState(false)
  const [rows,  setRows]  = useState<Transaction[]>([])
  const [busy,  setBusy]  = useState(false)
  const [field, setField] = useState<SortField>('date')
  const [dir,   setDir]   = useState<SortDir>('desc')

  useEffect(() => {
    if (!open || portfolioId == null) return
    setBusy(true)
    fetchTransactionHistory(portfolioId)
      .then(setRows)
      .catch(() => {})
      .finally(() => setBusy(false))
  }, [open, portfolioId])

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      let cmp = 0
      if (field === 'date')   cmp = a.trade_date.localeCompare(b.trade_date)
      if (field === 'symbol') cmp = a.symbol.localeCompare(b.symbol)
      if (field === 'action') cmp = a.action.localeCompare(b.action)
      if (field === 'price')  cmp = parseFloat(a.price) - parseFloat(b.price)
      return dir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [rows, field, dir])

  function toggleSort(f: SortField) {
    if (field === f) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setField(f); setDir('desc') }
  }

  function SortIcon({ f }: { f: SortField }) {
    return (
      <span className="ml-0.5 text-[9px] text-slate-400">
        {field === f ? (dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    )
  }

  function SortTh({ f, label }: { f: SortField; label: string }) {
    return (
      <th className="th">
        <button
          onClick={() => toggleSort(f)}
          className="flex items-center text-[10px] uppercase tracking-widest text-slate-400 font-semibold hover:text-slate-600"
        >
          {label}<SortIcon f={f} />
        </button>
      </th>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {isEn ? 'Transaction History' : '交易记录'}
          </span>
          {rows.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-semibold">
              {rows.length}
            </span>
          )}
        </div>
        <span className={`text-slate-400 text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {busy ? (
            <div className="space-y-2 px-5 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              {isEn ? 'No transactions found' : '暂无交易记录'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="th-left">
                      <button
                        onClick={() => toggleSort('date')}
                        className="flex items-center text-[10px] uppercase tracking-widest text-slate-400 font-semibold pl-4 py-2 hover:text-slate-600"
                      >
                        {isEn ? 'Date' : '日期'}<SortIcon f="date" />
                      </button>
                    </th>
                    <SortTh f="symbol" label={isEn ? 'Symbol' : '标的'} />
                    <SortTh f="action" label={isEn ? 'Action' : '操作'} />
                    <th className="th text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{isEn ? 'Qty' : '数量'}</th>
                    <SortTh f="price" label={isEn ? 'Price' : '价格'} />
                    <th className="th text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{isEn ? 'Contract' : '合约'}</th>
                    <th className="th text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{isEn ? 'Status' : '状态'}</th>
                    <th className="th text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{isEn ? 'Notes' : '备注'}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((tx) => {
                    const isOption = tx.option_type != null
                    const contractLabel = isOption
                      ? `${tx.option_type} $${fmtNum(tx.strike ?? '0')} ${tx.expiry ?? ''}`
                      : 'STOCK'
                    const noteText = tx.notes || tx.trade_metadata?.trade_reason?.slice(0, 50) || '—'
                    return (
                      <tr key={tx.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="td-left pl-4 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                          {tx.trade_date ? tx.trade_date.slice(0, 16).replace('T', ' ') : '—'}
                        </td>
                        <td className="td font-bold text-slate-900">{tx.symbol}</td>
                        <td className="td">
                          <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${ACTION_BADGE[tx.action] ?? 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                            {tx.action}
                          </span>
                        </td>
                        <td className="td tabular-nums text-slate-700">{tx.quantity}</td>
                        <td className="td tabular-nums text-slate-700">${fmtNum(tx.price)}</td>
                        <td className="td text-slate-500 text-[11px] max-w-[140px]">
                          <span className="truncate block" title={contractLabel}>{contractLabel}</span>
                        </td>
                        <td className="td">
                          <StatusBadge status={tx.status} />
                        </td>
                        <td className="td text-slate-400 text-[11px] max-w-[160px]">
                          <span className="truncate block" title={noteText}>{noteText}</span>
                        </td>
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
type Tab = 'overview' | 'details' | 'records'

export default function HoldingsPage() {
  const { selectedPortfolioId, refreshKey, triggerRefresh } = usePortfolio()
  const { lang, t } = useLanguage()
  const { lastHoldingsUpdate, lastSpotChangePct } = useWebSocket()

  // Derive active tab from URL path — component stays mounted across tab changes
  const location  = useLocation()
  const activeTab: Tab = location.pathname.includes('/details') ? 'details'
    : location.pathname.includes('/records') ? 'records'
    : 'overview'
  const [holdings,        setHoldings]        = useState<HoldingGroup[]>([])
  const [cash,            setCash]            = useState<CashSummary | null>(null)
  const [riskDash,        setRiskDash]        = useState<RiskDashboard | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [period,          setPeriod]          = useState<Period>('1d')
  const [lifecycleResult, setLifecycleResult] = useState<LifecycleResult | null>(null)

  // Shadow ref: preserves last valid holdings across WS reconnects & lang switches
  const lastValidHoldings = useRef<HoldingGroup[]>([])

  // ── Main data fetch ────────────────────────────────────────────────────────
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

  // ── Real-time WS holdings push ─────────────────────────────────────────────
  // Anti-flicker: skip updates where every group has perf=0 (backend price
  // cache not yet warm) unless we have no holdings at all to show.
  useEffect(() => {
    if (!lastHoldingsUpdate) return
    if (lastHoldingsUpdate.portfolioId !== selectedPortfolioId) return
    const newData = lastHoldingsUpdate.data
    const isCold = newData.length > 0 &&
      newData.every(g => (safeFloat(g.effective_perf_1d) ?? 0) === 0)
    if (!isCold || lastValidHoldings.current.length === 0) {
      setHoldings(newData)
      lastValidHoldings.current = newData
    }
  }, [lastHoldingsUpdate, selectedPortfolioId])

  // ── Stale-While-Revalidate on language change ─────────────────────────────
  // Do NOT call triggerRefresh() here — that would set loading=true and blank
  // the entire overview tab (data vacuum).  Instead, fetch quietly in the
  // background; the stale data keeps rendering until fresh data arrives.
  // Cleanup flag prevents setState after unmount or rapid lang toggling.
  useEffect(() => {
    if (selectedPortfolioId === null) return
    let cancelled = false
    Promise.all([
      fetchHoldings(selectedPortfolioId),
      fetchCash(selectedPortfolioId),
    ]).then(([h, c]) => {
      if (cancelled) return
      if (Array.isArray(h)) {
        // Smart merge: if backend returns 0 perf for a symbol (price cache miss
        // on lang switch), graft the last known perf from the shadow ref so the
        // treemap doesn't flash all-green.
        const merged = h.map(newGroup => {
          const old = lastValidHoldings.current.find(o => o.symbol === newGroup.symbol)
          if (
            old &&
            (safeFloat(newGroup.effective_perf_1d) ?? 0) === 0 &&
            (safeFloat(old.effective_perf_1d) ?? 0) !== 0
          ) {
            return {
              ...newGroup,
              effective_perf_1d: old.effective_perf_1d,
              effective_perf_5d: old.effective_perf_5d,
              perf_1d: old.perf_1d,
              perf_5d: old.perf_5d,
              perf_1m: old.perf_1m,
              perf_3m: old.perf_3m,
            }
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

  // ── Lifecycle sweep (once per session) ────────────────────────────────────
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

  // ── Hero metrics ──────────────────────────────────────────────────────────
  // Daily Unrealized P&L = Σ delta_adjusted_exposure × spot_change_pct / 100
  //   delta_adjusted_exposure is already signed (positive = bullish delta,
  //   negative = bearish delta), so no is_short correction is needed.
  //   A brand-new position bought at today's price contributes near-zero P&L
  //   because it only participates in intraday movement from prev_close onwards.
  // Net Exposure = Σ delta_adjusted_exposure (signed sum of all delta bets)
  const heroMetrics = useMemo(() => {
    let dailyUnrealizedPnl = 0
    let netExposure        = 0
    let portfolioValue     = 0

    for (const g of holdings) {
      const exposure = safeFloat(g.delta_adjusted_exposure) ?? 0
      netExposure += exposure

      // Daily Unrealized P&L: live WS pct preferred; fallback to cached 1d perf
      const pctStr = lastSpotChangePct?.[g.symbol]
      const pct    = pctStr != null ? parseFloat(pctStr) : (safeFloat(g.effective_perf_1d) ?? 0)
      if (isFinite(pct) && isFinite(exposure)) {
        dailyUnrealizedPnl += exposure * pct / 100
      }

      // Portfolio Value: stock legs → real-time MtM; option legs → premium × qty × 100
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
    const realizedPnlPct        = portfolioValue > 0 ? (realizedPnl        / portfolioValue) * 100 : 0

    return { dailyUnrealizedPnl, netExposure, portfolioValue, realizedPnl, dailyUnrealizedPnlPct, realizedPnlPct }
  }, [holdings, cash, lastSpotChangePct])

  // ── Treemap data ──────────────────────────────────────────────────────────
  const treemapData = useMemo(() => {
    return holdings
      .filter((g) => {
        if (!g?.symbol) return false
        const exp = safeFloat(g.delta_adjusted_exposure)
        return exp != null && Math.abs(exp) > 0  // include short (negative) positions
      })
      .map((g) => {
        const isShort = g.is_short === true
        const staticPerf = getEffectivePerf(g, period)
        // If backend perf not yet loaded (null/0), fall back to live WS spot change
        const wsChangePct = lastSpotChangePct?.[g.symbol] != null
          ? parseFloat(lastSpotChangePct![g.symbol]) * (isShort ? -1 : 1)
          : null
        const perf    = (staticPerf != null && staticPerf !== 0) ? staticPerf : (wsChangePct ?? 0)
        const rawPerf = getRawPerf(g, period) ?? (wsChangePct ?? 0)
        return {
          name:     g.symbol,
          size:     Math.abs(safeFloat(g.delta_adjusted_exposure) ?? 0),  // Recharts needs positive area
          perf,
          rawPerf,
          exposure: safeFloat(g.delta_adjusted_exposure) ?? 0,  // keep signed for display
          isShort,
        }
      })
      .filter((d) => d.size > 0 && d.name)
      .sort((a, b) => b.size - a.size)
  }, [holdings, period, lastSpotChangePct])

  const isEn = lang !== 'zh'
  const hadSettlement = lifecycleResult && lifecycleResult.expired + lifecycleResult.assigned > 0

  return (
    <div className="max-w-7xl mx-auto font-sans space-y-4">

      {/* ── Lifecycle banner ──────────────────────────────────────────────── */}
      {hadSettlement && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs">
          <span className="text-amber-700 font-semibold">{t('lifecycle_notice')}</span>
          <span className="text-slate-500">
            {lifecycleResult!.expired  > 0 && <span className="mr-3">{lifecycleResult!.expired} expired</span>}
            {lifecycleResult!.assigned > 0 && <span className="text-amber-700 font-semibold">{lifecycleResult!.assigned} assigned</span>}
          </span>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* OVERVIEW TAB                                                      */}
      {/* ────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">

            {/* Hero Banner — 4 stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label={isEn ? 'Portfolio Value' : '持仓总市值'}
                value={heroMetrics.portfolioValue !== 0 ? fmtUSD(String(Math.round(heroMetrics.portfolioValue))) : '—'}
                sub={isEn ? 'Stocks MtM + Options cost basis' : '股票市值 · 期权开仓成本'}
              />
              <StatCard
                label={isEn ? 'Net Exposure' : '净敞口总额'}
                value={heroMetrics.netExposure !== 0 ? fmtUSD(String(Math.round(Math.abs(heroMetrics.netExposure)))) : '—'}
                sub={isEn ? 'Σ delta-adjusted notional' : 'Σ Delta加权名义敞口'}
                valueClass={heroMetrics.netExposure >= 0 ? 'text-slate-900' : 'text-rose-600'}
              />
              <StatCard
                label={isEn ? 'Daily Unrealized Change' : '今日浮盈变动'}
                value={
                  heroMetrics.dailyUnrealizedPnl !== 0
                    ? (heroMetrics.dailyUnrealizedPnl >= 0 ? '+' : '') + fmtUSD(String(Math.round(heroMetrics.dailyUnrealizedPnl)))
                    : '—'
                }
                sub={
                  heroMetrics.dailyUnrealizedPnlPct !== 0
                    ? (heroMetrics.dailyUnrealizedPnlPct >= 0 ? '+' : '') + heroMetrics.dailyUnrealizedPnlPct.toFixed(2) + '%'
                    : undefined
                }
                valueClass={
                  heroMetrics.dailyUnrealizedPnl === 0 ? 'text-slate-900'
                  : heroMetrics.dailyUnrealizedPnl > 0 ? 'text-emerald-600'
                  : 'text-rose-600'
                }
              />
              <StatCard
                label={isEn ? 'Total Realized P&L' : '累计已实现盈亏'}
                value={
                  heroMetrics.realizedPnl !== 0
                    ? (heroMetrics.realizedPnl >= 0 ? '+' : '') + fmtUSD(String(Math.round(heroMetrics.realizedPnl)))
                    : '—'
                }
                sub={
                  heroMetrics.realizedPnlPct !== 0
                    ? (heroMetrics.realizedPnlPct >= 0 ? '+' : '') + heroMetrics.realizedPnlPct.toFixed(2) + '%'
                    : (isEn ? 'From closed trades only' : '仅含已平仓收益')
                }
                valueClass={
                  heroMetrics.realizedPnl === 0 ? 'text-slate-900'
                  : heroMetrics.realizedPnl > 0  ? 'text-emerald-600'
                  : 'text-rose-600'
                }
              />
            </div>

            {/* 30-Day History Chart */}
            <PortfolioHistoryChart portfolioId={selectedPortfolioId} />

            {/* Exposure Treemap */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {/* Header + period pills */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/60 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-800">
                    {isEn ? 'Exposure Map' : '敞口热力图'}
                  </span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider hidden sm:block">
                    {isEn
                      ? 'Area = Notional · Color = P&L direction · (S) = Short'
                      : '面积=名义敞口 · 颜色=盈亏 · (S)=空头'}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                        period === p
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      {PERIOD_LABELS[p]?.[lang === 'zh' ? 'zh' : 'en'] ?? p}
                    </button>
                  ))}
                </div>
              </div>

              {treemapData.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm gap-1">
                  <span>{isEn ? 'No positions with exposure data' : '暂无敞口数据'}</span>
                  <span className="text-xs text-slate-300">
                    {isEn ? '(1-year price history needed for performance coloring)' : '(需要1年历史数据)'}
                  </span>
                </div>
              ) : (
                <div className="p-3">
                  <ResponsiveContainer width="100%" height={320}>
                    <Treemap
                      data={treemapData}
                      dataKey="size"
                      aspectRatio={4 / 3}
                      stroke="#fff"
                      content={CustomCell}
                    >
                      <Tooltip content={TreemapTooltip} />
                    </Treemap>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Color legend */}
              <div className="flex items-center justify-center gap-3 px-5 pb-3 pt-1 flex-wrap">
                {[
                  { color: '#059669', label: '>+4%' },
                  { color: '#34d399', label: '+2~4%' },
                  { color: '#a7f3d0', label: '0~2%' },
                  { color: '#e2e8f0', label: 'N/A' },
                  { color: '#fecaca', label: '-2~0%' },
                  { color: '#f87171', label: '-4~-2%' },
                  { color: '#e11d48', label: '<-4%' },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
                    <span className="text-[10px] text-slate-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Three-col footer: Sector Pie · Strategy Pie · Risk Weather */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <SectorPieChart sectorExp={riskDash?.sector_exposure} isEn={isEn} />
              <StrategyPieChart holdings={holdings} isEn={isEn} />
              <RiskWeatherCard riskDash={riskDash} isEn={isEn} />
            </div>

            {/* AI Insights — holdings passed for fingerprint-based localStorage caching */}
            <AiInsightPanel holdings={holdings} />
          </div>
        )
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* DETAILS TAB                                                       */}
      {/* ────────────────────────────────────────────────────────────────── */}
      {activeTab === 'details' && (
        loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <HoldingsTable groups={holdings} />
        )
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* RECORDS TAB                                                       */}
      {/* ────────────────────────────────────────────────────────────────── */}
      {activeTab === 'records' && (
        <div className="space-y-5">
          <SettledTradesSection portfolioId={selectedPortfolioId} />
          <TransactionHistorySection portfolioId={selectedPortfolioId} />
        </div>
      )}
    </div>
  )
}
