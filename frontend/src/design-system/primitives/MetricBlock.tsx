/**
 * MetricBlock — single financial metric display.
 *
 * Typography hierarchy: value (largest) > label (small, muted) > delta (contextual)
 * All numeric values use tabular-nums for alignment stability.
 * Wrapped with React.memo to prevent re-renders under frequent WS updates.
 *
 * Zero-value guard: uses isPresent() — treats 0 as valid, null/undefined as missing.
 *
 * Usage:
 *   <MetricBlock label="Daily P&L" value="+$1,234" delta="+2.3%" sentiment="positive" />
 */
import { memo } from 'react'
import SkeletonLoader from './SkeletonLoader'

/** Zero-safe presence check: 0 is valid, null/undefined are not */
function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined
}

interface Props {
  /** Small muted label above the value */
  label: string
  /** Primary display value — typically formatted currency */
  value: string
  /** Optional secondary context (percentage, change, etc.) */
  delta?: string | null
  /** Color coding for the value */
  sentiment?: 'positive' | 'negative' | 'neutral'
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Loading state */
  isLoading?: boolean
  className?: string
}

/* Semantic typography + min-height per size for CLS stability */
const sizeConfig: Record<string, { classes: string; minHeight: string; skeletonH: string }> = {
  sm: { classes: 'text-ds-h2 tnum',      minHeight: '2.75rem',  skeletonH: 'h-5' },
  md: { classes: 'text-ds-h1 tnum',      minHeight: '3.25rem',  skeletonH: 'h-6' },
  lg: { classes: 'text-ds-display tnum',  minHeight: '3.75rem',  skeletonH: 'h-8' },
}

const sentimentClasses: Record<string, string> = {
  positive: 'text-v2-positive',
  negative: 'text-v2-negative',
  neutral:  'text-v2-text-1',
}

export default memo(function MetricBlock({
  label,
  value,
  delta,
  sentiment = 'neutral',
  size = 'md',
  isLoading = false,
  className = '',
}: Props) {
  const cfg = sizeConfig[size]

  if (isLoading) {
    return (
      <div className={`space-y-1.5 ${className}`} style={{ minHeight: cfg.minHeight }}>
        <SkeletonLoader width="w-16" height="h-2.5" />
        <SkeletonLoader width="w-24" height={cfg.skeletonH} />
      </div>
    )
  }

  return (
    <div className={className} style={{ minHeight: cfg.minHeight }}>
      <div className="text-ds-caption uppercase tracking-widest text-v2-text-3 mb-1">
        {label}
      </div>
      <div className={`${cfg.classes} ${sentimentClasses[sentiment]} leading-none`}>
        {value}
      </div>
      {isPresent(delta) && (
        <div className={`text-ds-sm tnum mt-1 ${sentimentClasses[sentiment]} opacity-70`}>
          {delta}
        </div>
      )}
    </div>
  )
})
