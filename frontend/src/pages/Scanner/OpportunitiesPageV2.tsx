/**
 * OpportunitiesPageV2 — Actionable Idea Funnel.
 *
 * Layout:
 *   Header → Filters → Flex layout (OpportunityList flex-1 + DetailPanel 420px)
 *
 * Scan → Compare → Act. Not a research report — an execution surface.
 * All V1 data hooks preserved. UI-only rebuild.
 */
import { useEffect, useState, useMemo, memo, useCallback } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { useSidebar }   from '@/context/SidebarContext'
import { fetchOpportunities } from '@/api/holdings'
import type { MarketOpportunity } from '@/types'
import { fmtNum } from '@/utils/format'
import SectionCard from '@/design-system/primitives/SectionCard'
import EmptyState  from '@/design-system/primitives/EmptyState'

// ── Signal styles (V2 tokens) ───────────────────────────────────────────────
const SIGNAL_STYLES: Record<MarketOpportunity['signal'], { bg: string; text: string; label: string; labelZh: string }> = {
  HIGH_IV:     { bg: 'bg-v2-negative-bg', text: 'text-v2-negative', label: 'High IV',     labelZh: '高IV' },
  ELEVATED_IV: { bg: 'bg-v2-caution-bg',  text: 'text-v2-caution',  label: 'Elevated IV', labelZh: '偏高IV' },
  LOW_IV:      { bg: 'bg-v2-positive-bg',  text: 'text-v2-positive', label: 'Low IV',      labelZh: '低IV' },
  NEUTRAL:     { bg: 'bg-v2-surface-alt',  text: 'text-v2-text-3',  label: 'Neutral',     labelZh: '中性' },
}

// ── Strategy suggestion heuristics ──────────────────────────────────────────
function inferSetupType(opp: MarketOpportunity): { type: string; typeZh: string; risk: 'low' | 'medium' | 'high' } {
  const rank = parseFloat(opp.iv_rank)
  if (rank > 0.8) return { type: 'Premium Selling', typeZh: '卖权策略', risk: 'medium' }
  if (rank > 0.6) return { type: 'Iron Condor', typeZh: '铁鹰策略', risk: 'medium' }
  if (rank < 0.2) return { type: 'Long Options', typeZh: '买权策略', risk: 'low' }
  return { type: 'Neutral Setup', typeZh: '中性策略', risk: 'low' }
}

const RISK_COLORS = {
  low: 'text-v2-positive',
  medium: 'text-v2-caution',
  high: 'text-v2-negative',
}

type FilterSignal = MarketOpportunity['signal'] | 'ALL'

// ── Opportunity Card ────────────────────────────────────────────────────────
const OpportunityCard = memo(function OpportunityCard({
  opp, isEn, isSelected, onClick,
}: {
  opp: MarketOpportunity; isEn: boolean; isSelected: boolean; onClick: () => void
}) {
  const signal = SIGNAL_STYLES[opp.signal]
  const setup = inferSetupType(opp)
  const rank = Math.round(parseFloat(opp.iv_rank) * 100)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-v2-lg border p-4 transition-colors duration-150
        ${isSelected
          ? 'border-v2-accent bg-v2-accent-soft/30 shadow-v2-sm'
          : 'border-v2-border bg-v2-surface hover:bg-v2-surface-hover hover:border-v2-border/80'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-ds-h3 text-v2-text-1">{opp.symbol}</span>
            <span className={`text-ds-caption px-1.5 py-0.5 rounded-md ${signal.bg} ${signal.text}`}>
              {isEn ? signal.label : signal.labelZh}
            </span>
          </div>
          <div className="text-ds-sm text-v2-text-2 font-bold">
            {isEn ? setup.type : setup.typeZh}
          </div>
        </div>
        <div className="text-right shrink-0">
          {opp.spot_price && (
            <div className="text-ds-body-r tnum text-v2-text-1">
              ${fmtNum(opp.spot_price)}
            </div>
          )}
          <div className="text-ds-sm tnum text-v2-text-3">
            IV Rank: {rank}%
          </div>
        </div>
      </div>

      {/* IV bar */}
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-v2-surface-alt overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${
              rank > 80 ? 'bg-v2-negative/60' : rank > 60 ? 'bg-v2-caution/60' : rank > 40 ? 'bg-v2-accent/60' : 'bg-v2-positive/60'
            }`}
            style={{ width: `${rank}%` }}
          />
        </div>
        <span className={`text-ds-caption ${RISK_COLORS[setup.risk]}`}>
          {isEn ? setup.risk : setup.risk === 'low' ? '低' : setup.risk === 'medium' ? '中' : '高'}
        </span>
      </div>
    </button>
  )
})

// ── Card Stream Skeleton ────────────────────────────────────────────────────
function OpportunityListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="rounded-v2-lg border border-v2-border bg-v2-surface p-4 ds-shimmer">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <div className="h-4 w-14 bg-v2-surface-alt rounded-v2-sm" />
                <div className="h-3.5 w-16 bg-v2-surface-alt rounded-md" />
              </div>
              <div className="h-3 w-24 bg-v2-surface-alt rounded-v2-sm" />
            </div>
            <div className="space-y-1.5 text-right">
              <div className="h-4 w-16 bg-v2-surface-alt rounded-v2-sm ml-auto" />
              <div className="h-3 w-20 bg-v2-surface-alt rounded-v2-sm ml-auto" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-v2-surface-alt rounded-full" />
            <div className="h-3 w-8 bg-v2-surface-alt rounded-v2-sm" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Detail Panel ────────────────────────────────────────────────────────────
const DetailPanel = memo(function DetailPanel({
  opp, isEn,
}: {
  opp: MarketOpportunity | null; isEn: boolean
}) {
  const { openTradeEntry, openPriceAlerts } = useSidebar()

  if (!opp) {
    return (
      <SectionCard minHeight="400px">
        <EmptyState
          message={isEn ? 'Select an opportunity' : '选择一个机会'}
          hint={isEn ? 'Click a card to see details and take action' : '点击卡片查看详情并操作'}
          className="py-16"
        />
      </SectionCard>
    )
  }

  const rank = parseFloat(opp.iv_rank)
  const pctl = parseFloat(opp.iv_percentile)
  const hv = parseFloat(opp.current_hv)
  const hvHigh = parseFloat(opp.hv_52w_high)
  const hvLow = parseFloat(opp.hv_52w_low)
  const setup = inferSetupType(opp)
  const signal = SIGNAL_STYLES[opp.signal]

  return (
    <SectionCard>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-ds-h2 text-v2-text-1">{opp.symbol}</span>
          <span className={`text-ds-caption px-1.5 py-0.5 rounded-md ${signal.bg} ${signal.text}`}>
            {isEn ? signal.label : signal.labelZh}
          </span>
        </div>
        {opp.spot_price && (
          <span className="text-ds-h2 tnum text-v2-text-1">${fmtNum(opp.spot_price)}</span>
        )}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-v2-surface-alt rounded-v2-md p-3">
          <div className="text-ds-caption text-v2-text-3 uppercaser mb-1">IV Rank</div>
          <div className="text-ds-h2 tnum text-v2-text-1">{Math.round(rank * 100)}%</div>
        </div>
        <div className="bg-v2-surface-alt rounded-v2-md p-3">
          <div className="text-ds-caption text-v2-text-3 uppercaser mb-1">IV Percentile</div>
          <div className="text-ds-h2 tnum text-v2-text-1">{Math.round(pctl * 100)}%</div>
        </div>
        <div className="bg-v2-surface-alt rounded-v2-md p-3">
          <div className="text-ds-caption text-v2-text-3 uppercaser mb-1">{isEn ? 'Current HV' : '当前HV'}</div>
          <div className="text-ds-body-r tnum text-v2-text-1">{(hv * 100).toFixed(1)}%</div>
        </div>
        <div className="bg-v2-surface-alt rounded-v2-md p-3">
          <div className="text-ds-caption text-v2-text-3 uppercaser mb-1">{isEn ? '52w Range' : '52周范围'}</div>
          <div className="text-ds-sm tnum text-v2-text-2">
            {(hvLow * 100).toFixed(1)}% — {(hvHigh * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* HV Range visualization */}
      <div className="mb-5">
        <div className="text-ds-caption text-v2-text-3 uppercaser mb-2">
          {isEn ? 'HV Position in 52-Week Range' : 'HV在52周范围内位置'}
        </div>
        <div className="relative h-2 rounded-full bg-v2-surface-alt overflow-hidden">
          <div
            className="absolute h-full bg-v2-accent/60 rounded-full"
            style={{
              left: '0%',
              width: `${hvHigh > hvLow ? ((hv - hvLow) / (hvHigh - hvLow)) * 100 : 50}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-ds-caption text-v2-text-3 mt-1 tnum">
          <span>{(hvLow * 100).toFixed(1)}%</span>
          <span>{(hvHigh * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Setup suggestion */}
      <div className="bg-v2-surface-alt rounded-v2-md p-4 mb-5">
        <div className="text-ds-sm uppercaser text-v2-text-3 mb-2">
          {isEn ? 'Suggested Setup' : '建议策略'}
        </div>
        <div className="text-ds-body-r text-v2-text-1 mb-1">
          {isEn ? setup.type : setup.typeZh}
        </div>
        <p className="text-ds-sm text-v2-text-2 leading-relaxed">
          {opp.suggestion}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => openTradeEntry()}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-v2-sm
                     bg-v2-accent text-white text-ds-body-r
                     hover:bg-v2-accent/90 transition-colors"
        >
          {isEn ? 'Trade' : '交易'}
        </button>
        <button
          onClick={() => openPriceAlerts({ symbol: opp.symbol, price: parseFloat(opp.spot_price ?? '0') })}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-v2-sm
                     text-v2-text-2 text-ds-body-r border border-v2-border
                     hover:bg-v2-surface-alt transition-colors"
        >
          {isEn ? 'Alert' : '警报'}
        </button>
      </div>
    </SectionCard>
  )
})

// ── Page ────────────────────────────────────────────────────────────────────
export default function OpportunitiesPageV2() {
  const { lang } = useLanguage()
  const { lastOpportunitiesUpdate } = useWebSocket()
  const isEn = lang !== 'zh'

  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [filterSignal, setFilterSignal] = useState<FilterSignal>('ALL')

  useEffect(() => {
    setError(null)
    fetchOpportunities()
      .then(setOpportunities)
      .catch((e: Error) => setError(e.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (lastOpportunitiesUpdate) setOpportunities(lastOpportunitiesUpdate)
  }, [lastOpportunitiesUpdate])

  const filtered = useMemo(() => {
    if (filterSignal === 'ALL') return opportunities
    return opportunities.filter((o) => o.signal === filterSignal)
  }, [opportunities, filterSignal])

  const selectedOpp = useMemo(
    () => opportunities.find((o) => o.symbol === selectedSymbol) ?? null,
    [opportunities, selectedSymbol],
  )

  const handleSelect = useCallback((symbol: string) => {
    setSelectedSymbol((prev) => prev === symbol ? null : symbol)
  }, [])

  // Summary metrics
  const avgRank = useMemo(() => {
    if (opportunities.length === 0) return null
    const sum = opportunities.reduce((s, o) => s + parseFloat(o.iv_rank), 0)
    return Math.round((sum / opportunities.length) * 100)
  }, [opportunities])

  const FILTER_OPTIONS: { key: FilterSignal; label: string; labelZh: string }[] = [
    { key: 'ALL',         label: 'All',      labelZh: '全部' },
    { key: 'HIGH_IV',     label: 'High IV',  labelZh: '高IV' },
    { key: 'ELEVATED_IV', label: 'Elevated', labelZh: '偏高' },
    { key: 'LOW_IV',      label: 'Low IV',   labelZh: '低IV' },
    { key: 'NEUTRAL',     label: 'Neutral',  labelZh: '中性' },
  ]

  return (
    <div className="space-y-5">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-ds-h2 text-v2-text-1">
            {isEn ? 'Opportunities' : '交易机会'}
          </h2>
          <p className="text-ds-sm text-v2-text-3 mt-0.5">
            {isEn ? 'Scan, compare, and act on volatility setups' : '扫描、比较并执行波动率策略'}
          </p>
        </div>
        {!loading && opportunities.length > 0 && (
          <div className="flex items-center gap-4 text-xs tnum">
            <div className="text-right">
              <div className="text-ds-caption text-v2-text-3 uppercaser">{isEn ? 'Setups' : '机会'}</div>
              <span className="text-ds-body-r text-v2-text-1">{opportunities.length}</span>
            </div>
            {avgRank != null && (
              <div className="text-right">
                <div className="text-ds-caption text-v2-text-3 uppercaser">{isEn ? 'Avg IV Rank' : '平均IV'}</div>
                <span className="text-ds-body-r text-v2-text-1">{avgRank}%</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 bg-v2-negative-bg border border-v2-negative/20 rounded-v2-md px-4 py-3">
          <span className="text-v2-negative text-sm flex-1">{error}</span>
          <button
            onClick={() => { setError(null); setLoading(true); fetchOpportunities().then(setOpportunities).catch((e: Error) => setError(e.message ?? 'Failed to load')).finally(() => setLoading(false)) }}
            className="text-ds-sm text-v2-accent hover:text-v2-text-1 transition-colors"
          >
            {isEn ? 'Retry' : '重试'}
          </button>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTER_OPTIONS.map(({ key, label, labelZh }) => (
          <button
            key={key}
            onClick={() => setFilterSignal(key)}
            className={`px-3 py-1.5 rounded-v2-sm text-ds-sm transition-colors
              ${filterSignal === key
                ? 'bg-v2-accent text-white'
                : 'bg-v2-surface-alt text-v2-text-2 hover:bg-v2-surface-hover border border-v2-border'
              }`}
          >
            {isEn ? label : labelZh}
          </button>
        ))}
      </div>

      {/* ── Main layout ───────────────────────────────────────── */}
      {loading ? (
        <div className="flex gap-5">
          <div className="flex-1 min-w-0">
            <OpportunityListSkeleton />
          </div>
          <div className="hidden xl:block w-[420px] shrink-0 sticky top-20 self-start">
            <SectionCard minHeight="400px" isLoading />
          </div>
        </div>
      ) : opportunities.length === 0 ? (
        <SectionCard minHeight="300px">
          <EmptyState
            message={isEn ? 'No opportunities detected' : '未检测到交易机会'}
            hint={isEn ? 'The scanner is running — opportunities will appear as volatility setups emerge' : '扫描器运行中 — 波动率机会出现时将显示'}
          />
        </SectionCard>
      ) : (
        <div className="flex gap-5">
          {/* Opportunity list */}
          <div className="flex-1 min-w-0 space-y-3">
            {filtered.length === 0 ? (
              <SectionCard minHeight="200px">
                <EmptyState
                  message={isEn ? 'No matches for this filter' : '没有匹配的机会'}
                  hint={isEn ? 'Try a different signal filter' : '尝试不同的信号过滤器'}
                  className="py-8"
                />
              </SectionCard>
            ) : (
              filtered.map((opp) => (
                <OpportunityCard
                  key={opp.symbol}
                  opp={opp}
                  isEn={isEn}
                  isSelected={selectedSymbol === opp.symbol}
                  onClick={() => handleSelect(opp.symbol)}
                />
              ))
            )}
          </div>

          {/* Detail panel — wider than standard RightPanel (detail view, not widget stack) */}
          <div className="hidden xl:block w-[420px] shrink-0">
            <div className="sticky top-20">
              <DetailPanel opp={selectedOpp} isEn={isEn} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
