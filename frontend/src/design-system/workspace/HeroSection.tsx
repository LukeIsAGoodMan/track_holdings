/**
 * HeroSection — Bloomberg-style portfolio summary bar.
 *
 * Large typography, whitespace-driven, zero decoration.
 * Portfolio value as the hero number, with P&L metrics alongside.
 * All numbers use tabular-nums for zero layout shift.
 *
 * Layout:
 *   Left:  Portfolio value (hero size) + subtitle
 *   Right: 4 metric blocks (Daily P&L, Total P&L, Net Exposure, Realized)
 */
import { memo, useMemo } from 'react'
import MetricBlock from '../primitives/MetricBlock'
import { fmtUSD } from '@/utils/format'

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
  return (v >= 0 ? '+' : '') + fmtUSD(String(Math.round(v)))
}

function fmtPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

export default memo(function HeroSection({ metrics, isEn, isLoading = false }: Props) {
  const m = metrics

  return (
    <div className="bg-v2-surface rounded-v2-xl shadow-v2-sm p-6 md:p-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
        {/* ── Left: Hero value ───────────────────────────────── */}
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-widest text-v2-text-3 mb-1.5">
            {isEn ? 'Portfolio Value' : '投资组合价值'}
          </div>
          <div className="text-[2rem] md:text-[2.5rem] font-semibold tracking-tighter text-v2-text-1 tnum leading-none">
            {isLoading ? (
              <span className="inline-block w-48 h-10 bg-v2-surface-alt rounded-v2-sm animate-pulse" />
            ) : (
              m.portfolioValue !== 0 ? fmtUSD(String(Math.round(m.portfolioValue))) : '—'
            )}
          </div>
          <div className="text-[12px] text-v2-text-3 mt-1.5">
            {isEn ? 'Stocks MtM + Options cost basis' : '股票市值 + 期权持仓成本'}
          </div>
        </div>

        {/* ── Right: Metric blocks ──────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4 shrink-0">
          <MetricBlock
            label={isEn ? 'Day P&L' : '日盈亏'}
            value={
              isLoading ? '...'
              : m.hasAnyHolding ? fmtSigned(m.dailyUnrealizedPnl) : '—'
            }
            delta={
              m.hasAnyHolding && m.portfolioValue > 0
                ? fmtPct(m.dailyUnrealizedPnlPct) : null
            }
            sentiment={sentiment(m.dailyUnrealizedPnl, m.hasAnyHolding)}
            size="sm"
            isLoading={isLoading}
          />
          <MetricBlock
            label={isEn ? 'Total P&L' : '总盈亏'}
            value={
              isLoading ? '...'
              : m.hasTotalPnl ? fmtSigned(m.totalUnrealizedPnl) : '—'
            }
            delta={
              m.hasTotalPnl && m.portfolioValue > 0
                ? fmtPct(m.totalUnrealizedPnlPct) : null
            }
            sentiment={sentiment(m.totalUnrealizedPnl, m.hasTotalPnl)}
            size="sm"
            isLoading={isLoading}
          />
          <MetricBlock
            label={isEn ? 'Net Exposure' : '净敞口'}
            value={
              isLoading ? '...'
              : m.netExposure !== 0
                ? fmtUSD(String(Math.round(Math.abs(m.netExposure))))
                : '—'
            }
            delta={m.netExposure < 0 ? (isEn ? 'Net Short' : '净空头') : null}
            sentiment={m.netExposure < 0 ? 'negative' : 'neutral'}
            size="sm"
            isLoading={isLoading}
          />
          <MetricBlock
            label={isEn ? 'Realized' : '已实现'}
            value={
              isLoading ? '...'
              : m.realizedPnl !== 0 ? fmtSigned(m.realizedPnl) : '—'
            }
            delta={
              m.realizedPnl !== 0 && m.portfolioValue > 0
                ? fmtPct(m.realizedPnlPct) : (isEn ? 'Closed trades' : '已平仓')
            }
            sentiment={sentiment(m.realizedPnl, m.realizedPnl !== 0)}
            size="sm"
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  )
})
