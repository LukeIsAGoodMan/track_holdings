/**
 * ChartContainer — isolation wrapper for chart implementations.
 *
 * Purpose:
 *   - Consistent chrome around any chart (Recharts, D3, etc.)
 *   - Allows chart implementation swap without layout impact
 *   - Handles loading / empty states
 *   - Flexible height that respects parent constraints
 */
import type { ReactNode } from 'react'
import SkeletonLoader from './SkeletonLoader'

interface Props {
  children: ReactNode
  /** Optional title rendered above the chart */
  title?: string
  /** Right-aligned header action */
  action?: ReactNode
  /** Chart height (default: h-64) */
  height?: string
  /** Loading state */
  isLoading?: boolean
  /** Show when no data */
  isEmpty?: boolean
  /** Empty state message */
  emptyMessage?: string
  className?: string
}

export default function ChartContainer({
  children,
  title,
  action,
  height = 'h-64',
  isLoading = false,
  isEmpty = false,
  emptyMessage = 'No data available',
  className = '',
}: Props) {
  return (
    <div className={`bg-v2-surface-raised rounded-v2-lg shadow-v2-sm overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          {title && (
            <h3 className="text-ds-h3 text-v2-text-1">{title}</h3>
          )}
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={`${height} w-full px-2`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <SkeletonLoader variant="block" width="w-full" height="h-full" className="mx-3 mb-4" />
          </div>
        ) : isEmpty ? (
          <div className="flex items-center justify-center h-full text-ds-body-r text-v2-text-3">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
