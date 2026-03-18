/**
 * PageHeader — page-level title + subtitle + right action slot.
 *
 * Apple-minimal: generous vertical breathing room, tight typography.
 */
import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  /** Right-aligned action slot */
  action?: ReactNode
  className?: string
}

export default function PageHeader({
  title,
  subtitle,
  action,
  className = '',
}: Props) {
  return (
    <div className={`flex items-start justify-between mb-6 ${className}`}>
      <div>
        <h1 className="text-xl font-semibold text-v2-text-1 tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-v2-text-3 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  )
}
