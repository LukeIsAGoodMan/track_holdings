/**
 * HeroSection — Dominant portfolio value + inline sparkline.
 *
 * Visual identity:
 *   One dominant number + one subtle signal line + minimal supporting context.
 *
 * Responsive scaling:
 *   >= 1440px: ~42px (text-ds-hero)
 *   < 1440px:  ~28px (text-ds-display)
 *
 * Sparkline: 7-day NLV trend, inline right of value, ~24px height.
 */
import { memo } from 'react'
import MetricBlock from '../primitives/MetricBlock'
import SkeletonLoader from '../primitives/SkeletonLoader'
import HeroSparkline from './HeroSparkline'
import { formatMetric, isPresent } from '@/utils/formatMetric'

interface HeroMetrics {
  portfolioValue:       number
  dailyUnrealizedPnl:   number
  dailyUnrealizedPnlPct: number
  totalUnrealizedPnl:   number
  totalUnrealizedPnlPct: number
  netExposure:          number
  realizedPnl:          number
  realizedPnlPct:       number
  hasAnyHolding:        boolean
  hasTotalPnl:          boolean
}

interface Props {
  metrics: HeroMetrics
  portfolioId: number | null | undefined
  isEn: boolean
  isLoading?: boolean
}

function sentiment(value: number, hasData: boolean): 'positive' | 'negative' | 'neutral' {
  if (!hasData) return 'neutral'
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

function fmtSigned(v: number): string {
  return formatMetric(Math.round(v), { type: 'currency', showSign: true })
}

function fmtPct(v: number): string {
  return formatMetric(v, { type: 'percent', showSign: true })
}

export default memo(function HeroSection({ metrics, portfolioId, isEn, isLoading = false }: Props) {
  const m = metrics
  const daySentiment = sentiment(m.dailyUnrealizedPnl, m.hasAnyHolding)

  return (
    <div className="p-5 md:p-6">
      {/* ── Hero value + inline sparkline ──────────────────────── */}
      <div className="mb-6">
        <div className="text-ds-caption uppercase text-v2-text-2 mb-1">
          {isEn ? 'Portfolio Value' : '投资组合价值'}
        </div>

        {/* Value row: number + sparkline inline */}
        <div className="flex items-end gap-4 mt-1">
          <div className="text-ds-display xl:text-ds-hero text-v2-text-1 tnum leading-none">
            {isLoading ? (
              <SkeletonLoader variant="block" width="w-56" height="h-12" />
            ) : (
              isPresent(m.portfolioValue) && m.portfolioValue !== 0
                ? formatMetric(Math.round(m.portfolioValue), { type: 'currency' })
                : '—'
            )}
          </div>

          {/* Inline sparkline — hidden during loading, gracefully absent if no data */}
          {!isLoading && m.hasAnyHolding && (
            <HeroSparkline
              portfolioId={portfolioId}
              sentiment={daySentiment}
              className="mb-1 hidden sm:block"
            />
          )}
        </div>

        {/* Day P&L — subdued context below hero */}
        {!isLoading && m.hasAnyHolding && (
          <div className={`text-ds-sm tnum mt-2 ${
            m.dailyUnrealizedPnl > 0 ? 'text-v2-positive' : m.dailyUnrealizedPnl < 0 ? 'text-v2-negative' : 'text-v2-text-3'
          }`}>
            {fmtSigned(m.dailyUnrealizedPnl)} today
            {m.portfolioValue > 0 && ` (${fmtPct(m.dailyUnrealizedPnlPct)})`}
          </div>
        )}
      </div>

      {/* ── Secondary metrics — suppressed ────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-3">
        <MetricBlock
          label={isEn ? 'Total P&L' : '总盈亏'}
          value={isLoading ? '...' : m.hasTotalPnl ? fmtSigned(m.totalUnrealizedPnl) : '—'}
          delta={m.hasTotalPnl && m.portfolioValue > 0 ? fmtPct(m.totalUnrealizedPnlPct) : null}
          sentiment={sentiment(m.totalUnrealizedPnl, m.hasTotalPnl)}
          size="sm"
          isLoading={isLoading}
        />
        <MetricBlock
          label={isEn ? 'Net Exposure' : '净敞口'}
          value={isLoading ? '...' : isPresent(m.netExposure) && m.netExposure !== 0 ? formatMetric(Math.round(Math.abs(m.netExposure)), { type: 'currency' }) : '—'}
          delta={m.netExposure < 0 ? (isEn ? 'Net Short' : '净空头') : null}
          sentiment={m.netExposure < 0 ? 'negative' : 'neutral'}
          size="sm"
          isLoading={isLoading}
        />
        <MetricBlock
          label={isEn ? 'Realized' : '已实现'}
          value={isLoading ? '...' : m.realizedPnl !== 0 ? fmtSigned(m.realizedPnl) : '—'}
          delta={m.realizedPnl !== 0 && m.portfolioValue > 0 ? fmtPct(m.realizedPnlPct) : null}
          sentiment={sentiment(m.realizedPnl, m.realizedPnl !== 0)}
          size="sm"
          isLoading={isLoading}
        />
      </div>
    </div>
  )
})
