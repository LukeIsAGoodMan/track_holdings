/**
 * RiskAlertStack — Risk alerts with severity indicators and suggested actions.
 *
 * Displays backend gamma crash warnings + suggested mitigation actions.
 * Uses V2 design tokens. No new API calls — reads from RiskDashboard.risk_alerts.
 */
import { memo } from 'react'
import SectionCard from '../primitives/SectionCard'
import EmptyState from '../primitives/EmptyState'

interface Props {
  alerts: string[]
  isEn: boolean
}

// Simple heuristic: classify alerts by keywords
function alertSeverity(alert: string): 'critical' | 'warning' | 'info' {
  const lower = alert.toLowerCase()
  if (lower.includes('crash') || lower.includes('extreme') || lower.includes('critical')) return 'critical'
  if (lower.includes('warn') || lower.includes('elevated') || lower.includes('high')) return 'warning'
  return 'info'
}

const SEVERITY_STYLES = {
  critical: {
    dot: 'bg-v2-negative',
    text: 'text-v2-negative',
    bg: 'bg-v2-negative-bg',
    action: 'Reduce exposure immediately',
    actionZh: '立即减少敞口',
  },
  warning: {
    dot: 'bg-v2-caution',
    text: 'text-v2-caution',
    bg: 'bg-v2-caution-bg',
    action: 'Consider hedging or reducing size',
    actionZh: '考虑对冲或减仓',
  },
  info: {
    dot: 'bg-v2-accent',
    text: 'text-v2-accent',
    bg: 'bg-v2-accent-soft',
    action: 'Monitor closely',
    actionZh: '密切关注',
  },
}

export default memo(function RiskAlertStack({ alerts, isEn }: Props) {
  return (
    <SectionCard>
      <SectionCard.Header
        title={isEn ? 'Risk Alerts' : '风险警报'}
        action={
          alerts.length > 0 ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-v2-negative-bg text-v2-negative font-bold">
              {alerts.length}
            </span>
          ) : undefined
        }
      />
      <SectionCard.Body>
        {alerts.length === 0 ? (
          <EmptyState
            message={isEn ? 'No active risk alerts' : '无活跃风险警报'}
            hint={isEn ? 'Your portfolio risk levels are within normal parameters' : '投资组合风险水平在正常范围内'}
          />
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, i) => {
              const severity = alertSeverity(alert)
              const styles = SEVERITY_STYLES[severity]
              return (
                <div key={i} className={`rounded-v2-md ${styles.bg} p-3`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`w-2 h-2 rounded-full ${styles.dot} shrink-0 mt-1`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-v2-text-1 font-medium leading-relaxed">
                        {alert}
                      </p>
                      <p className={`text-[11px] ${styles.text} font-semibold mt-1`}>
                        → {isEn ? styles.action : styles.actionZh}
                      </p>
                    </div>
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
