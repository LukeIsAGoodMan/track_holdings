/**
 * ConcentrationTable — Top risk contributors ranked by delta exposure.
 *
 * Shows symbol, strategy mix, delta, theta, margin for top N positions.
 * Reuses data from holdings + risk dashboard — no new API calls.
 */
import { memo, useMemo } from 'react'
import type { HoldingGroup } from '@/types'
import { fmtNum, fmtUSD } from '@/utils/format'
import SectionCard from '../primitives/SectionCard'
import EmptyState from '../primitives/EmptyState'

interface Props {
  holdings: HoldingGroup[]
  isEn: boolean
  limit?: number
}

export default memo(function ConcentrationTable({ holdings, isEn, limit = 10 }: Props) {
  const rows = useMemo(() => {
    return [...holdings]
      .sort((a, b) => Math.abs(parseFloat(b.total_delta_exposure)) - Math.abs(parseFloat(a.total_delta_exposure)))
      .slice(0, limit)
      .map((g) => {
        const delta = parseFloat(g.total_delta_exposure)
        const theta = g.option_legs.reduce((sum, l) => {
          const t = l.theta != null ? parseFloat(l.theta) * l.net_contracts * 100 : 0
          return sum + t
        }, 0)
        const margin = parseFloat(g.total_maintenance_margin ?? '0')
        const strategies = [...new Set(g.option_legs.map((l) => l.strategy_tag).filter(Boolean))]
        return { symbol: g.symbol, delta, theta, margin, strategies }
      })
  }, [holdings, limit])

  return (
    <SectionCard noPadding>
      <div className="px-5 py-3 border-b border-v2-border flex items-center gap-2">
        <h3 className="text-ds-h3 font-bold text-v2-text-1">
          {isEn ? 'Top Risk Contributors' : '主要风险来源'}
        </h3>
        {rows.length > 0 && (
          <span className="text-ds-caption px-1.5 py-0.5 rounded-full bg-v2-surface-alt text-v2-text-3 font-bold">
            {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          message={isEn ? 'No positions' : '暂无持仓'}
          hint={isEn ? 'Top risk contributors will appear when positions are opened' : '开仓后将显示主要风险来源'}
          className="py-10"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-v2-border">
                <th className="text-left text-ds-caption uppercase text-v2-text-3 font-bold pl-5 py-2">
                  {isEn ? 'Symbol' : '标的'}
                </th>
                <th className="text-left text-ds-caption uppercase text-v2-text-3 font-bold py-2">
                  {isEn ? 'Strategy' : '策略'}
                </th>
                <th className="text-right text-ds-caption uppercase text-v2-text-3 font-bold py-2">
                  {isEn ? 'Delta Exp' : 'Delta敞口'}
                </th>
                <th className="text-right text-ds-caption uppercase text-v2-text-3 font-bold py-2">
                  {isEn ? 'Theta/day' : 'Theta/日'}
                </th>
                <th className="text-right text-ds-caption uppercase text-v2-text-3 font-bold pr-5 py-2">
                  {isEn ? 'Margin' : '保证金'}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ symbol, delta, theta, margin, strategies }) => (
                <tr key={symbol} className="border-b border-v2-border hover:bg-v2-surface-hover transition-colors">
                  <td className="pl-5 py-2.5 font-bold text-v2-text-1">{symbol}</td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {strategies.length > 0 ? strategies.map((s) => (
                        <span key={s} className="text-ds-caption px-1.5 py-0.5 rounded-md bg-v2-surface-alt text-v2-text-3 font-bold">
                          {s}
                        </span>
                      )) : (
                        <span className="text-ds-caption text-v2-text-3">STOCK</span>
                      )}
                    </div>
                  </td>
                  <td className={`py-2.5 text-right tnum font-bold ${delta >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
                    {delta >= 0 ? '+' : ''}{fmtNum(String(delta.toFixed(2)))}
                  </td>
                  <td className={`py-2.5 text-right tnum font-bold ${theta >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
                    {theta >= 0 ? '+' : ''}{fmtNum(String(theta.toFixed(2)))}
                  </td>
                  <td className="py-2.5 pr-5 text-right tnum text-v2-text-1">
                    {fmtUSD(String(margin.toFixed(2)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
})
