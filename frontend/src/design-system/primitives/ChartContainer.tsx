/**
 * ChartContainer — isolation wrapper for chart implementations.
 *
 * Purpose:
 *   - Consistent chrome around any chart (Recharts, D3, etc.)
 *   - Allows chart implementation swap without layout impact
 *   - Handles loading / empty states
 *
 * Layout rule: NEVER clips chart content.
 *   - Uses min-height (not fixed height) to allow chart to own its space
 *   - No overflow-hidden — chart content (tooltips, labels) may extend beyond bounds
 */
import type { ReactNode } from 'react'
import SkeletonLoader from './SkeletonLoader'

interface Props {
  children: ReactNode
  /** Optional title rendered above the chart */
  title?: string
  /** Right-aligned header action */
  action?: ReactNode
  /** Minimum chart area height (default: min-h-[256px]). Used for loading/empty states. */
  minHeight?: string
  /** @deprecated Use minHeight instead. Kept for backward compat. */
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
  minHeight,
  height,
  isLoading = false,
  isEmpty = false,
  emptyMessage = 'No data available',
  className = '',
}: Props) {
  // Resolve min-height: prefer explicit minHeight, fall back to height for compat, else default
  const resolvedMinH = minHeight ?? (height ? `min-${height}` : 'min-h-[256px]')

  return (
    <div className={`bg-v2-surface border border-v2-border rounded-v2-lg ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          {title && (
            <h3 className="text-ds-h3 text-v2-text-1">{title}</h3>
          )}
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={`${resolvedMinH} w-full px-2`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <SkeletonLoader variant="block" width="w-full" height="h-full" className="mx-3 mb-4" />
          </div>
        ) : isEmpty ? (
          <div className="flex items-center justify-center h-64 text-ds-body-r text-v2-text-3">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
