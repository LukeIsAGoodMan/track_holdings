/**
 * EmptyState — placeholder for sections with no data.
 *
 * Wealthsimple-minimal: clean icon + message, no heavy graphics.
 */
import type { ReactNode } from 'react'

interface Props {
  /** Primary message */
  message: string
  /** Optional secondary hint */
  hint?: string
  /** Optional icon (renders above message) */
  icon?: ReactNode
  /** Optional action button */
  action?: ReactNode
  className?: string
}

export default function EmptyState({
  message,
  hint,
  icon,
  action,
  className = '',
}: Props) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      {icon && (
        <div className="text-v2-text-3 mb-4">{icon}</div>
      )}
      <p className="text-base font-medium text-v2-text-2">{message}</p>
      {hint && (
        <p className="text-sm text-v2-text-3 mt-1 max-w-sm">{hint}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
