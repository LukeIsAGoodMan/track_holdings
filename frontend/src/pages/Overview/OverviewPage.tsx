/**
 * OverviewPage — Portfolio panoramic view
 * Route: /  (index)
 *
 * Layout:
 *  1. Hero Banner    — 5 KPIs incl. Net Delta Exposure
 *  2. Period filter  — [1D | 5D | 1M | 3M]
 *  3. Treemap        — area = delta_adjusted_exposure (absolute notional)
 *                      color = effective_perf (direction-adjusted)
 *                      label shows (S) for short/bearish positions
 *  4. AI Insights
 *
 * Color logic: effective_perf = underlying_change% × sign(net_delta)
 *   Long stock up   →  green   (you profit)
 *   Short stock up  →  red     (you lose)
 *   Long put down   →  green   (put gains when stock falls)
 *   Short put up    →  green   (short put gains when stock rises)
 */
import { useState, useEffect, useMemo } from 'react'
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchHoldings, fetchCash } from '@/api/holdings'
import { fmtUSD, fmtNum } from '@/utils/format'
import AiInsightPanel from '@/components/AiInsightPanel'
import type { HoldingGroup, CashSummary } from '@/types'

// ── Period types ──────────────────────────────────────────────────────────────
type Period = '1d' | '5d' | '1m' | '3m'

const PERIOD_LABELS: Record<Period, { en: string; zh: string }> = {
  '1d': { en: '1D', zh: '1日' },
  '5d': { en: '5D', zh: '5日' },
  '1m': { en: '1M', zh: '1月' },
  '3m': { en: '3M', zh: '3月' },
}

// ── Color scale: effective_perf% → fill color ─────────────────────────────────
// Green = position is profitable for the period; Red = losing
function perfColor(pct: number | null): string {
  if (pct == null) return '#e2e8f0'   // slate-200 — no data
  if (pct >=  4)   return '#059669'   // emerald-600
  if (pct >=  2)   return '#34d399'   // emerald-400
  if (pct >=  0)   return '#a7f3d0'   // emerald-200
  if (pct >= -2)   return '#fecaca'   // rose-200
  if (pct >= -4)   return '#f87171'   // rose-400
  return '#e11d48'                     // rose-600
}

function perfTextColor(pct: number | null): string {
  if (pct == null) return '#94a3b8'
  return pct >= 0 ? '#065f46' : '#9f1239'
}

// ── Treemap custom cell ───────────────────────────────────────────────────────
interface CellProps {
  x?: number; y?: number; width?: number; height?: number
  name?: string; perf?: number | null; exposure?: number; isShort?: boolean
}

function CustomCell({
  x = 0, y = 0, width = 0, height = 0,
  name = '', perf = null, exposure = 0, isShort = false,
}: CellProps) {
  const fill = perfColor(perf)
  const textColor = perfTextColor(perf)
  const MIN_LABEL_W = 36
  const MIN_LABEL_H = 22
  const label = isShort ? `${name} (S)` : name

  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(0, width - 2)} height={Math.max(0, height - 2)}
        fill={fill} rx={6} stroke="#ffffff" strokeWidth={2}
      />
      {width > MIN_LABEL_W && height > MIN_LABEL_H && (
        <>
          <text
            x={x + width / 2} y={y + height / 2 - (height > 40 ? 9 : 0)}
            textAnchor="middle" dominantBaseline="middle"
            fill={textColor}
            fontSize={Math.min(13, Math.max(8, width / 6))}
            fontWeight="700"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            {label}
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

// ── Hero stat card ────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, valueClass = 'text-slate-900',
}: {
  label: string; value: string; sub?: string; valueClass?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-4 py-4 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums leading-tight ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Treemap tooltip ───────────────────────────────────────────────────────────
interface TooltipItem {
  root: {
    name: string; perf: number | null; exposure: number
    isShort: boolean; rawPerf: number | null
  }
}

function TreemapTooltip({ active, payload }: { active?: boolean; payload?: TooltipItem[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].root
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-xs font-sans min-w-[160px]">
      <div className="font-bold text-slate-900 text-sm mb-1.5">
        {d.name}
        {d.isShort && <span className="ml-1 text-[10px] font-semibold text-rose-500 bg-rose-50 border border-rose-200 px-1 py-0.5 rounded">(S)</span>}
      </div>
      <div className="space-y-0.5 text-slate-500">
        <div>
          Notional: <span className="font-semibold text-slate-800">{fmtUSD(String(d.exposure))}</span>
        </div>
        {d.rawPerf != null && (
          <div>
            Underlying: <span className={`font-semibold ${d.rawPerf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {d.rawPerf >= 0 ? '+' : ''}{d.rawPerf.toFixed(2)}%
            </span>
          </div>
        )}
        {d.perf != null && (
          <div className="border-t border-slate-100 pt-0.5 mt-0.5">
            P&L contribution: <span className={`font-bold ${d.perf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {d.perf >= 0 ? '+' : ''}{d.perf.toFixed(2)}%
            </span>
          </div>
        )}
        <div className="text-[10px] text-slate-400 italic mt-1">
          {d.isShort ? 'Bearish position (S)' : 'Bullish position (L)'}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const { selectedPortfolioId, refreshKey } = usePortfolio()
  const { lang } = useLanguage()
  const { lastSpotChangePct } = useWebSocket()

  const [holdings, setHoldings] = useState<HoldingGroup[]>([])
  const [cash, setCash] = useState<CashSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('1d')

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchHoldings(selectedPortfolioId), fetchCash(selectedPortfolioId)])
      .then(([h, c]) => { setHoldings(h); setCash(c) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedPortfolioId, refreshKey])

  // ── Derived metrics ───────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    let totalStockValue = 0
    let dayPnl = 0
    let netDeltaNotional = 0
    let bestSymbol = ''
    let bestEff = -Infinity
    let worstSymbol = ''
    let worstEff = Infinity

    for (const g of holdings) {
      // Stock market value
      for (const sl of g.stock_legs) {
        if (sl.market_value) totalStockValue += parseFloat(sl.market_value)
      }

      // Signed net delta notional (for Hero Banner)
      if (g.signed_delta_notional != null) {
        netDeltaNotional += parseFloat(g.signed_delta_notional)
      }

      // Day P&L: use effective_perf (direction-adjusted) × exposure
      const effPerf = getEffectivePerf(g, '1d')
      // Use live WS changePct for the underlying, then apply direction sign
      const livePct = lastSpotChangePct?.[g.symbol] != null
        ? parseFloat(lastSpotChangePct![g.symbol]) * (g.is_short ? -1 : 1)
        : effPerf

      if (livePct != null && g.delta_adjusted_exposure) {
        dayPnl += parseFloat(g.delta_adjusted_exposure) * livePct / 100
      }

      // Best/worst effective performer for selected period
      const eff = getEffectivePerf(g, period)
      if (eff != null) {
        if (eff > bestEff) { bestEff = eff; bestSymbol = g.symbol }
        if (eff < worstEff) { worstEff = eff; worstSymbol = g.symbol }
      }
    }

    const cashBalance = cash ? parseFloat(cash.balance) : 0
    const totalValue = totalStockValue + cashBalance

    return { totalValue, dayPnl, netDeltaNotional, bestSymbol, bestEff, worstSymbol, worstEff }
  }, [holdings, cash, period, lastSpotChangePct])

  // ── Treemap data ──────────────────────────────────────────────────────────
  const treemapData = useMemo(() => {
    return holdings
      .filter((g) => g.delta_adjusted_exposure != null && parseFloat(g.delta_adjusted_exposure) > 0)
      .map((g) => ({
        name: g.symbol,
        size: parseFloat(g.delta_adjusted_exposure!),       // area = absolute notional
        perf: getEffectivePerf(g, period),                   // color = direction-adjusted perf
        rawPerf: getRawPerf(g, period),                      // for tooltip
        exposure: parseFloat(g.delta_adjusted_exposure!),
        isShort: g.is_short,
      }))
      .sort((a, b) => b.size - a.size)
  }, [holdings, period])

  const t_en = lang !== 'zh'
  const periodLabel = PERIOD_LABELS[period][lang === 'zh' ? 'zh' : 'en']

  return (
    <div className="max-w-7xl mx-auto space-y-5 font-sans">
      {/* ── Title ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t_en ? 'Portfolio Overview' : '持仓总览'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {t_en ? 'Direction-adjusted exposure treemap · Green = position profits, Red = position loses' : '方向敞口热力图 · 绿=盈利 红=亏损'}
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Hero Banner — 5 stats ────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              label={t_en ? 'Portfolio Value' : '总资产'}
              value={metrics.totalValue !== 0 ? fmtUSD(String(metrics.totalValue)) : '—'}
            />
            <StatCard
              label={t_en ? 'Est. Day P&L' : '当日盈亏'}
              value={metrics.dayPnl !== 0 ? (metrics.dayPnl >= 0 ? '+' : '') + fmtUSD(String(metrics.dayPnl)) : '—'}
              valueClass={metrics.dayPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}
              sub={t_en ? 'direction-adjusted' : '方向加权'}
            />
            <StatCard
              label={t_en ? 'Net Delta Exposure' : '净Delta敞口'}
              value={metrics.netDeltaNotional !== 0
                ? (metrics.netDeltaNotional >= 0 ? '+' : '') + fmtUSD(String(Math.round(metrics.netDeltaNotional)))
                : '—'}
              valueClass={metrics.netDeltaNotional >= 0 ? 'text-emerald-600' : 'text-rose-600'}
              sub={t_en ? (metrics.netDeltaNotional >= 0 ? 'Net long bias' : 'Net short bias') : (metrics.netDeltaNotional >= 0 ? '净多头' : '净空头')}
            />
            <StatCard
              label={t_en ? `Best (${periodLabel})` : `最强 (${periodLabel})`}
              value={metrics.bestSymbol || '—'}
              sub={metrics.bestEff !== -Infinity ? `${metrics.bestEff >= 0 ? '+' : ''}${metrics.bestEff.toFixed(2)}%` : undefined}
              valueClass="text-emerald-600"
            />
            <StatCard
              label={t_en ? `Worst (${periodLabel})` : `最弱 (${periodLabel})`}
              value={metrics.worstSymbol || '—'}
              sub={metrics.worstEff !== Infinity ? `${metrics.worstEff.toFixed(2)}%` : undefined}
              valueClass="text-rose-600"
            />
          </div>

          {/* ── Treemap ─────────────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Header + period filter */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-slate-800">{t_en ? 'Exposure Map' : '敞口热力图'}</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  {t_en ? 'Area = Notional · Color = Position P&L · (S) = Short/Bearish' : '面积=名义敞口 · 颜色=持仓盈亏 · (S)=空头/看空'}
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
                    {PERIOD_LABELS[p][lang === 'zh' ? 'zh' : 'en']}
                  </button>
                ))}
              </div>
            </div>

            {/* Treemap */}
            {treemapData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm">
                <span>{t_en ? 'No positions with exposure data' : '暂无敞口数据'}</span>
                <span className="text-xs mt-1 text-slate-300">
                  {t_en ? '(1-year price history required for perf data)' : '(需要1年历史数据)'}
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
                    content={(props: Record<string, unknown>) => (
                      <CustomCell
                        x={props.x as number}
                        y={props.y as number}
                        width={props.width as number}
                        height={props.height as number}
                        name={(props.name as string) ?? ''}
                        perf={(props.perf as number | null) ?? null}
                        exposure={(props.exposure as number) ?? 0}
                        isShort={(props.isShort as boolean) ?? false}
                      />
                    )}
                  >
                    <Tooltip content={<TreemapTooltip />} />
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

          {/* ── AI Insights ─────────────────────────────────────────────── */}
          <AiInsightPanel />
        </>
      )}
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Effective P&L-adjusted perf for a period (direction-corrected). */
function getEffectivePerf(g: HoldingGroup, period: Period): number | null {
  const raw = period === '1d' ? g.effective_perf_1d
    : period === '5d' ? g.effective_perf_5d
    : period === '1m' ? g.effective_perf_1m
    : g.effective_perf_3m
  if (raw == null) return null
  const v = parseFloat(raw)
  return isFinite(v) ? v : null
}

/** Raw underlying price change for tooltip context. */
function getRawPerf(g: HoldingGroup, period: Period): number | null {
  const raw = period === '1d' ? g.perf_1d
    : period === '5d' ? g.perf_5d
    : period === '1m' ? g.perf_1m
    : g.perf_3m
  if (raw == null) return null
  const v = parseFloat(raw)
  return isFinite(v) ? v : null
}
