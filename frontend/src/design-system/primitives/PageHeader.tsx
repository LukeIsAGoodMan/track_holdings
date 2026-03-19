/**
 * PageHeader — page-level title + subtitle + right action slot.
 *
 * Uses semantic typography: h2 for title, ds-sm for subtitle.
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
        <h1 className="text-ds-h2 text-v2-text-1">
          {title}
        </h1>
        {subtitle && (
          <p className="text-ds-sm text-v2-text-3 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  )
}
