/**
 * OverviewPage — Portfolio panoramic view (defensive edition)
 * Route: /  (index)
 *
 * Defensive rules applied throughout:
 *  - All data reads use optional chaining (?.) and nullish fallbacks (?? default)
 *  - Treemap only renders when holdings array is non-empty AND exposure > 0
 *  - Tooltip uses correct Recharts payload shape (payload[0] directly, NOT payload[0].root)
 *  - New Phase 14b fields (is_short, effective_perf_*, signed_delta_notional) all have
 *    safe fallbacks — they may be absent on stale WS messages or old cache hits
 */
import { useState, useEffect, useMemo } from 'react'
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchHoldings, fetchCash } from '@/api/holdings'
import { fmtUSD } from '@/utils/format'
import AiInsightPanel from '@/components/AiInsightPanel'
import type { HoldingGroup, CashSummary } from '@/types'

// ── Period ────────────────────────────────────────────────────────────────────
type Period = '1d' | '5d' | '1m' | '3m'

const PERIOD_LABELS: Record<Period, { en: string; zh: string }> = {
  '1d': { en: '1D', zh: '1日' },
  '5d': { en: '5D', zh: '5日' },
  '1m': { en: '1M', zh: '1月' },
  '3m': { en: '3M', zh: '3月' },
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function perfColor(pct: number | null | undefined): string {
  if (pct == null || !isFinite(pct)) return '#e2e8f0'
  if (pct >=  4) return '#059669'
  if (pct >=  2) return '#34d399'
  if (pct >=  0) return '#a7f3d0'
  if (pct >= -2) return '#fecaca'
  if (pct >= -4) return '#f87171'
  return '#e11d48'
}

function perfTextColor(pct: number | null | undefined): string {
  if (pct == null || !isFinite(pct)) return '#94a3b8'
  return pct >= 0 ? '#065f46' : '#9f1239'
}

// ── Treemap custom cell ───────────────────────────────────────────────────────
// Recharts passes layout (x,y,w,h) + all data-item keys directly as props.
// Guard every access — Recharts may call content for parent/layout nodes too.
function CustomCell(props: Record<string, unknown>) {
  const x       = (typeof props.x       === 'number') ? props.x       : 0
  const y       = (typeof props.y       === 'number') ? props.y       : 0
  const width   = (typeof props.width   === 'number') ? props.width   : 0
  const height  = (typeof props.height  === 'number') ? props.height  : 0
  const name    = (typeof props.name    === 'string') ? props.name    : (props.name != null ? String(props.name) : '')
  const perf    = (typeof props.perf    === 'number' && isFinite(props.perf as number)) ? props.perf as number : null
  const isShort = (props.isShort === true)

  const fill      = perfColor(perf)
  const textColor = perfTextColor(perf)
  const label     = isShort ? `${name} (S)` : name

  const MIN_W = 36
  const MIN_H = 22

  if (width <= 0 || height <= 0) return null

  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(0, width - 2)} height={Math.max(0, height - 2)}
        fill={fill} rx={6} stroke="#ffffff" strokeWidth={2}
      />
      {width > MIN_W && height > MIN_H && (
        <>
          <text
            x={x + width / 2} y={y + height / 2 - (height > 40 ? 9 : 0)}
            textAnchor="middle" dominantBaseline="middle"
            fill={textColor}
            fontSize={Math.min(13, Math.max(8, width / 6))}
            fontWeight="700"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            {label || '?'}
          </text>
          {height > 40 && perf != null && (
            <text
              x={x + width / 2} y={y + height / 2 + 10}
              textAnchor="middle" dominantBaseline="middle"
              fill={textColor}
              fontSize={Math.min(11, Math.max(8, width / 8))}
              fontWeight="600"
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

// ── Treemap Tooltip ───────────────────────────────────────────────────────────
// In Recharts Treemap, tooltip payload[0] IS the data item — NOT payload[0].root.
// All fields are accessed directly on payload[0] with safe fallbacks.
function TreemapTooltip({ active, payload }: { active?: boolean; payload?: unknown[] }) {
  if (!active || !payload?.length) return null

  // Recharts may pass payload items of varying shapes — be fully defensive
  const item = (payload[0] ?? {}) as Record<string, unknown>
  const name    = (typeof item.name    === 'string') ? item.name    : String(item.name ?? '?')
  const perf    = (typeof item.perf    === 'number' && isFinite(item.perf))    ? item.perf    : null
  const rawPerf = (typeof item.rawPerf === 'number' && isFinite(item.rawPerf)) ? item.rawPerf : null
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
            P&L contribution:{' '}
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
      <div className={`text-xl font-bold tabular-nums leading-tight ${valueClass}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Shimmer loading skeleton ──────────────────────────────────────────────────
function Skeleton({ h = 'h-32' }: { h?: string }) {
  return <div className={`${h} bg-white border border-slate-200 rounded-2xl animate-pulse`} />
}

// ── Safe field helpers ────────────────────────────────────────────────────────
function safeFloat(v: string | null | undefined): number | null {
  if (v == null) return null
  const n = parseFloat(v)
  return isFinite(n) ? n : null
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const { selectedPortfolioId, refreshKey } = usePortfolio()
  const { lang } = useLanguage()
  const { lastSpotChangePct } = useWebSocket()

  const [holdings, setHoldings] = useState<HoldingGroup[]>([])
  const [cash,     setCash]     = useState<CashSummary | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [period,   setPeriod]   = useState<Period>('1d')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchHoldings(selectedPortfolioId),
      fetchCash(selectedPortfolioId),
    ])
      .then(([h, c]) => {
        setHoldings(Array.isArray(h) ? h : [])
        setCash(c ?? null)
      })
      .catch(() => {
        setHoldings([])
        setCash(null)
      })
      .finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  // ── Derived metrics (all reads guarded) ───────────────────────────────────
  const metrics = useMemo(() => {
    let totalStockValue  = 0
    let dayPnl           = 0
    let netDeltaNotional = 0
    let bestSymbol       = ''
    let bestEff          = -Infinity
    let worstSymbol      = ''
    let worstEff         = Infinity

    for (const g of holdings) {
      if (!g) continue

      // Stock market value
      for (const sl of g.stock_legs ?? []) {
        const mv = safeFloat(sl?.market_value)
        if (mv != null) totalStockValue += mv
      }

      // Net delta notional — guard missing field
      const sdn = safeFloat(g.signed_delta_notional)
      if (sdn != null) netDeltaNotional += sdn

      // Day P&L: effective_perf_1d applied to notional exposure
      const effPerf1d = getEffectivePerf(g, '1d')
      // Prefer live WS data; apply direction sign if available
      const isShort = g.is_short === true
      const livePct = (lastSpotChangePct?.[g.symbol] != null)
        ? parseFloat(lastSpotChangePct![g.symbol]) * (isShort ? -1 : 1)
        : effPerf1d

      const exposure = safeFloat(g.delta_adjusted_exposure)
      if (livePct != null && exposure != null && isFinite(livePct)) {
        dayPnl += exposure * livePct / 100
      }

      // Best / worst effective performer for selected period
      const eff = getEffectivePerf(g, period)
      if (eff != null) {
        const sym = g.symbol ?? ''
        if (eff > bestEff)  { bestEff = eff;   bestSymbol = sym }
        if (eff < worstEff) { worstEff = eff;  worstSymbol = sym }
      }
    }

    const cashBalance = safeFloat(cash?.balance) ?? 0
    const totalValue  = totalStockValue + cashBalance

    return { totalValue, dayPnl, netDeltaNotional, bestSymbol, bestEff, worstSymbol, worstEff }
  }, [holdings, cash, period, lastSpotChangePct])

  // ── Treemap data ──────────────────────────────────────────────────────────
  const treemapData = useMemo(() => {
    return holdings
      .filter((g) => {
        if (!g?.symbol) return false
        const exp = safeFloat(g.delta_adjusted_exposure)
        return exp != null && exp > 0
      })
      .map((g) => {
        const exposure = safeFloat(g.delta_adjusted_exposure) ?? 0
        return {
          name:    g.symbol ?? '?',
          size:    exposure,                      // area = absolute notional
          perf:    getEffectivePerf(g, period),   // color = direction-adjusted perf
          rawPerf: getRawPerf(g, period),         // tooltip raw underlying %
          exposure,
          isShort: g.is_short === true,
        }
      })
      .filter((d) => d.size > 0 && d.name)
      .sort((a, b) => b.size - a.size)
  }, [holdings, period])

  const t_en       = lang !== 'zh'
  const periodLabel = PERIOD_LABELS[period]?.[lang === 'zh' ? 'zh' : 'en'] ?? period.toUpperCase()

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-5 font-sans">
        <Skeleton h="h-8" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[1,2,3,4,5].map((i) => <Skeleton key={i} h="h-24" />)}
        </div>
        <Skeleton h="h-96" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5 font-sans">
      {/* ── Title ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          {t_en ? 'Portfolio Overview' : '持仓总览'}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {t_en
            ? 'Direction-adjusted exposure · Green = position profits · Red = position loses'
            : '方向敞口热力图 · 绿=盈利 · 红=亏损'}
        </p>
      </div>

      {/* ── Hero Banner ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label={t_en ? 'Portfolio Value' : '总资产'}
          value={metrics.totalValue !== 0 ? fmtUSD(String(metrics.totalValue)) : '—'}
        />
        <StatCard
          label={t_en ? 'Est. Day P&L' : '当日盈亏'}
          value={
            isFinite(metrics.dayPnl) && metrics.dayPnl !== 0
              ? (metrics.dayPnl >= 0 ? '+' : '') + fmtUSD(String(metrics.dayPnl))
              : '—'
          }
          valueClass={metrics.dayPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          sub={t_en ? 'direction-adjusted' : '方向加权'}
        />
        <StatCard
          label={t_en ? 'Net Delta Exposure' : '净Delta敞口'}
          value={
            isFinite(metrics.netDeltaNotional) && metrics.netDeltaNotional !== 0
              ? (metrics.netDeltaNotional >= 0 ? '+' : '') + fmtUSD(String(Math.round(metrics.netDeltaNotional)))
              : '—'
          }
          valueClass={metrics.netDeltaNotional >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          sub={
            metrics.netDeltaNotional !== 0
              ? (t_en
                  ? (metrics.netDeltaNotional >= 0 ? 'Net long bias' : 'Net short bias')
                  : (metrics.netDeltaNotional >= 0 ? '净多头' : '净空头'))
              : undefined
          }
        />
        <StatCard
          label={t_en ? `Best (${periodLabel})` : `最强 (${periodLabel})`}
          value={metrics.bestSymbol || '—'}
          sub={
            metrics.bestEff !== -Infinity && isFinite(metrics.bestEff)
              ? `${metrics.bestEff >= 0 ? '+' : ''}${metrics.bestEff.toFixed(2)}%`
              : undefined
          }
          valueClass="text-emerald-600"
        />
        <StatCard
          label={t_en ? `Worst (${periodLabel})` : `最弱 (${periodLabel})`}
          value={metrics.worstSymbol || '—'}
          sub={
            metrics.worstEff !== Infinity && isFinite(metrics.worstEff)
              ? `${metrics.worstEff.toFixed(2)}%`
              : undefined
          }
          valueClass="text-rose-600"
        />
      </div>

      {/* ── Treemap ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Header + period filter */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/60 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-800">
              {t_en ? 'Exposure Map' : '敞口热力图'}
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">
              {t_en
                ? 'Area = Notional · Color = P&L · (S) = Short'
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

        {/* Treemap body */}
        {treemapData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm gap-1">
            <span>{t_en ? 'No positions with exposure data' : '暂无敞口数据'}</span>
            <span className="text-xs text-slate-300">
              {t_en
                ? '(1-year price history required for performance coloring)'
                : '(需要1年历史价格数据才能显示颜色)'}
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

        {/* Legend */}
        <div className="flex items-center justify-center gap-3 px-5 pb-3 pt-1 flex-wrap">
          {[
            { color: '#059669', label: t_en ? '>+4% profit' : '>+4%盈利' },
            { color: '#34d399', label: '+2~4%' },
            { color: '#a7f3d0', label: '0~2%' },
            { color: '#e2e8f0', label: 'N/A' },
            { color: '#fecaca', label: '-2~0%' },
            { color: '#f87171', label: '-4~-2%' },
            { color: '#e11d48', label: t_en ? '<-4% loss' : '<-4%亏损' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
              <span className="text-[10px] text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── AI Insights ──────────────────────────────────────────────────── */}
      <AiInsightPanel />
    </div>
  )
}
