/**
 * PanelContainer — generic wrapper for pluggable feature modules.
 *
 * Future-ready zones: AI insights, automation, strategy panels, etc.
 * Wraps any module with consistent spacing and optional header.
 */
import type { ReactNode } from 'react'
import SkeletonLoader from './SkeletonLoader'

interface Props {
  children: ReactNode
  /** Optional panel title */
  title?: string
  /** Optional subtitle */
  subtitle?: string
  /** Right-aligned action slot */
  action?: ReactNode
  /** Loading state */
  isLoading?: boolean
  /** Visual variant */
  variant?: 'default' | 'outlined' | 'subtle'
  /** Minimum height for layout stability */
  minHeight?: string
  className?: string
}

const variantClasses: Record<string, string> = {
  default:  'bg-v2-surface-raised rounded-v2-lg shadow-v2-sm',
  outlined: 'bg-v2-surface-raised rounded-v2-lg border border-v2-border',
  subtle:   'bg-v2-surface-alt rounded-v2-lg',
}

export default function PanelContainer({
  children,
  title,
  subtitle,
  action,
  isLoading = false,
  variant = 'default',
  minHeight,
  className = '',
}: Props) {
  return (
    <div
      className={`p-6 ${variantClasses[variant]} ${className}`}
      style={{ minHeight }}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <div>
            {title && (
              <h3 className="text-ds-h3 text-v2-text-1">{title}</h3>
            )}
            {subtitle && (
              <p className="text-ds-sm text-v2-text-3 mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      {isLoading ? (
        <div className="space-y-3">
          <SkeletonLoader width="w-full" height="h-3" />
          <SkeletonLoader width="w-3/4" height="h-3" />
          <SkeletonLoader variant="block" height="h-12" />
        </div>
      ) : (
        children
      )}
    </div>
  )
}
