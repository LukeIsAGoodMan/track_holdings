/**
 * RightPanelStack — compact sidebar widgets for the Holdings workspace.
 *
 * Widgets:
 *   1. QuickRiskCard — Greeks summary + VaR (from RiskDashboard)
 *   2. AllocationCard — Top holdings by notional exposure
 *   3. CashCard — Cash balance + realized P&L
 *
 * These are purely presentational — no data fetching, no business logic.
 * Uses formatMetric for all numeric display (zero-safe, consistent).
 */
import { memo } from 'react'
import SectionCard from '../primitives/SectionCard'
import type { RiskDashboard, HoldingGroup, CashSummary } from '@/types'
import { formatMetric, isPresent } from '@/utils/formatMetric'

// ── Quick Risk Card ──────────────────────────────────────────────────────────

interface QuickRiskProps {
  riskDash: RiskDashboard | null
  isEn: boolean
}

export const QuickRiskCard = memo(function QuickRiskCard({ riskDash, isEn }: QuickRiskProps) {
  if (!riskDash) return null

  const rows = [
    { label: isEn ? 'Net Delta' : '净Delta', value: formatMetric(riskDash.total_net_delta, { type: 'number' }), color: parseFloat(riskDash.total_net_delta) >= 0 ? 'text-v2-positive' : 'text-v2-negative' },
    { label: isEn ? 'Gamma' : 'Gamma', value: formatMetric(riskDash.total_gamma, { type: 'greek' }), color: 'text-v2-text-1' },
    { label: 'Theta/day', value: formatMetric(riskDash.total_theta_daily, { type: 'number' }), color: parseFloat(riskDash.total_theta_daily) >= 0 ? 'text-v2-positive' : 'text-v2-negative' },
    { label: 'Vega', value: formatMetric(riskDash.total_vega, { type: 'greek' }), color: 'text-v2-text-1' },
    { label: isEn ? '1d VaR 95%' : '日VaR', value: isPresent(riskDash.var_1d_95) ? `-${formatMetric(riskDash.var_1d_95, { type: 'currency' })}` : '—', color: 'text-v2-negative' },
    { label: isEn ? 'Margin' : '保证金', value: formatMetric(riskDash.maintenance_margin_total, { type: 'currency' }), color: 'text-v2-text-2' },
  ]

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Risk Summary' : '风险概览'} />
      <SectionCard.Body>
        <div className="space-y-2">
          {rows.map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-ds-sm text-v2-text-3">{label}</span>
              <span className={`text-ds-body-r tnum ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
})

// ── Allocation Card ──────────────────────────────────────────────────────────

interface AllocationProps {
  holdings: HoldingGroup[]
  isEn: boolean
}

export const AllocationCard = memo(function AllocationCard({ holdings, isEn }: AllocationProps) {
  if (holdings.length === 0) return null

  const sorted = [...holdings]
    .filter(h => h.delta_adjusted_exposure != null)
    .sort((a, b) => Math.abs(parseFloat(b.delta_adjusted_exposure ?? '0')) - Math.abs(parseFloat(a.delta_adjusted_exposure ?? '0')))
    .slice(0, 5)

  const totalExp = sorted.reduce((s, h) => s + Math.abs(parseFloat(h.delta_adjusted_exposure ?? '0')), 0)

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Top Exposure' : '头寸集中度'} />
      <SectionCard.Body>
        <div className="space-y-2.5">
          {sorted.map(h => {
            const exp = Math.abs(parseFloat(h.delta_adjusted_exposure ?? '0'))
            const pct = totalExp > 0 ? (exp / totalExp) * 100 : 0
            return (
              <div key={h.symbol}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-ds-sm text-v2-text-1">{h.symbol}</span>
                  <span className="text-ds-sm tnum text-v2-text-3">{formatMetric(pct, { type: 'number', precision: 0 })}%</span>
                </div>
                <div className="h-1 bg-v2-surface-alt rounded-full overflow-hidden">
                  <div
                    className="h-full bg-v2-accent rounded-full transition-[width] duration-200"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
})

// ── Cash Card ────────────────────────────────────────────────────────────────

interface CashProps {
  cash: CashSummary | null
  isEn: boolean
}

export const CashCard = memo(function CashCard({ cash, isEn }: CashProps) {
  if (!cash) return null

  const balance = parseFloat(cash.balance) || 0
  const realized = parseFloat(cash.realized_pnl) || 0

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Cash' : '现金'} />
      <SectionCard.Body>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-ds-sm text-v2-text-3">{isEn ? 'Balance' : '余额'}</span>
            <span className="text-ds-body-r tnum text-v2-text-1">{formatMetric(balance, { type: 'currency' })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ds-sm text-v2-text-3">{isEn ? 'Realized P&L' : '已实现'}</span>
            <span className={`text-ds-body-r tnum ${realized > 0 ? 'text-v2-positive' : realized < 0 ? 'text-v2-negative' : 'text-v2-text-2'}`}>
              {realized !== 0 ? formatMetric(realized, { type: 'currency', showSign: true }) : '—'}
            </span>
          </div>
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
})
