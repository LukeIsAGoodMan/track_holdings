/**
 * RiskHero — Portfolio risk summary hero for RiskPageV2.
 *
 * Bloomberg-style: VaR headline left, 4 greek MetricBlocks right.
 * Weather icon indicates overall risk posture.
 */
import { memo, useMemo } from 'react'
import type { RiskDashboard } from '@/types'
import { fmtNum, fmtGreek, fmtUSD, signClass } from '@/utils/format'
import MetricBlock from '../primitives/MetricBlock'

interface Props {
  dashboard: RiskDashboard | null
  isEn: boolean
  isLoading?: boolean
}

function varWeather(varVal: number | null, margin: number) {
  const ratio = varVal != null && margin > 0 ? varVal / margin : null
  if (ratio == null) return { icon: '—', label: 'N/A', color: 'text-v2-text-3' }
  if (ratio > 0.05) return { icon: 'CRITICAL', label: 'Critical', color: 'text-v2-negative' }
  if (ratio > 0.03) return { icon: 'ELEVATED', label: 'Elevated', color: 'text-v2-caution' }
  if (ratio > 0.01) return { icon: 'MODERATE', label: 'Moderate', color: 'text-v2-accent' }
  return { icon: 'LOW', label: 'Low', color: 'text-v2-positive' }
}

export default memo(function RiskHero({ dashboard, isEn, isLoading = false }: Props) {
  const varVal = dashboard?.var_1d_95 != null ? parseFloat(dashboard.var_1d_95) : null
  const margin = dashboard ? parseFloat(dashboard.maintenance_margin_total) : 0
  const weather = varWeather(varVal, margin)
  const varRatio = varVal != null && margin > 0 ? (varVal / margin * 100).toFixed(1) + '%' : null

  const metrics = useMemo(() => {
    if (!dashboard) return []
    return [
      { label: isEn ? 'Net Delta' : '净Delta', value: fmtNum(dashboard.total_net_delta), sentiment: (parseFloat(dashboard.total_net_delta) >= 0 ? 'positive' : 'negative') as 'positive' | 'negative' },
      { label: isEn ? 'Gamma' : 'Gamma', value: fmtGreek(dashboard.total_gamma), sentiment: 'neutral' as const },
      { label: isEn ? 'Theta/day' : 'Theta/日', value: fmtNum(dashboard.total_theta_daily), sentiment: (parseFloat(dashboard.total_theta_daily) >= 0 ? 'positive' : 'negative') as 'positive' | 'negative' },
      { label: isEn ? 'Margin' : '保证金', value: fmtUSD(dashboard.maintenance_margin_total), sentiment: 'neutral' as const },
    ]
  }, [dashboard, isEn])

  if (isLoading) {
    return (
      <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm p-6 animate-pulse">
        <div className="h-16 bg-v2-surface-alt rounded-v2-md" />
      </div>
    )
  }

  return (
    <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm p-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        {/* Left — VaR headline */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-ds-sm uppercase text-v2-text-3">
              {isEn ? 'Value at Risk (1d 95%)' : '风险价值 (1日 95%)'}
            </span>
            <span className={`text-ds-caption uppercase px-1.5 py-0.5 rounded-md ${weather.color} bg-v2-surface-alt`}>
              {weather.icon}
            </span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className={`text-ds-display tnum leading-none ${varVal != null ? 'text-v2-text-1' : 'text-v2-text-3'}`}>
              {varVal != null ? `$${varVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
            </span>
            {varRatio && (
              <span className="text-ds-body-r tnum text-v2-text-3">
                {varRatio} {isEn ? 'of margin' : '占保证金'}
              </span>
            )}
          </div>
          <div className="text-ds-sm text-v2-text-3">
            {dashboard?.positions_count ?? 0} {isEn ? 'positions' : '持仓'}
            {dashboard?.top_efficient_symbol && (
              <span className="ml-2 text-v2-accent font-bold">
                {isEn ? 'Best:' : '最优:'} {dashboard.top_efficient_symbol}
              </span>
            )}
          </div>
        </div>

        {/* Right — Greek metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((m) => (
            <MetricBlock key={m.label} label={m.label} value={m.value} sentiment={m.sentiment} size="sm" />
          ))}
        </div>
      </div>
    </div>
  )
})
