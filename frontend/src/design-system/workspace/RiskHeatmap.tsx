/**
 * RiskHeatmap — Delta exposure concentration by symbol.
 *
 * Horizontal bar chart showing each symbol's delta exposure.
 * Sorted by absolute magnitude. Green = long, red = short.
 * Top 1-2 items get stronger color for visual hierarchy emphasis.
 *
 * NEVER returns null — always preserves container height for layout stability.
 */
import { memo, useMemo } from 'react'
import type { HoldingGroup } from '@/types'
import { formatMetric } from '@/utils/formatMetric'
import SectionCard from '../primitives/SectionCard'
import EmptyState from '../primitives/EmptyState'

interface Props {
  holdings: HoldingGroup[]
  isEn: boolean
  isLoading?: boolean
}

export default memo(function RiskHeatmap({ holdings, isEn, isLoading = false }: Props) {
  const data = useMemo(() => {
    const items = holdings.map((g) => ({
      symbol: g.symbol,
      delta: parseFloat(g.total_delta_exposure),
    }))
    items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    return items
  }, [holdings])

  const maxAbs = useMemo(() => Math.max(...data.map((d) => Math.abs(d.delta)), 1), [data])

  return (
    <SectionCard isLoading={isLoading} minHeight="180px">
      <SectionCard.Header title={isEn ? 'Delta Concentration' : 'Delta集中度'} />
      <SectionCard.Body>
        {data.length === 0 ? (
          <EmptyState
            message={isEn ? 'No exposure data available' : '暂无敞口数据'}
            hint={isEn ? 'Delta concentration will appear when positions are opened' : '开仓后将显示Delta集中度'}
            className="py-6"
          />
        ) : (
          <div className="space-y-2.5">
            {data.map(({ symbol, delta }, idx) => {
              const pct = (Math.abs(delta) / maxAbs) * 100
              const isLong = delta >= 0
              const barOpacity = idx < 2 ? '80' : '50'
              return (
                <div key={symbol}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-ds-sm ${idx < 2 ? 'text-v2-text-1' : 'text-v2-text-2'}`}>{symbol}</span>
                    <span className={`text-ds-sm tnum ${isLong ? 'text-v2-positive' : 'text-v2-negative'}`}>
                      {formatMetric(delta, { type: 'number', showSign: true })}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-v2-surface-alt overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-200 ${isLong ? `bg-v2-positive/${barOpacity}` : `bg-v2-negative/${barOpacity}`}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard.Body>
    </SectionCard>
  )
})
