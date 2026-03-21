/**
 * MetricBlock (V3) — single financial metric display.
 *
 * Strict hierarchy:
 *   [label]   — text-ds-caption, text-v2-text-2, uppercase
 *   [value]   — text-ds-* (size-dependent), font-semibold, tnum
 *   [delta]   — text-ds-sm, semantic color, opacity-70
 *
 * Spacing contract:
 *   label → value: mt-1 (tight)
 *   value → delta: mt-1
 *
 * All numeric values use tabular-nums for alignment stability.
 * Wrapped with React.memo to prevent re-renders under frequent WS updates.
 * Zero-value guard: uses isPresent() — treats 0 as valid, null/undefined as missing.
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

/**
 * Size config — enforced typography + min-height for CLS.
 * font-semibold (600) is the ONLY weight for metric values.
 * This provides emphasis without the heaviness of font-bold (700).
 */
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
      <div className={`${className}`} style={{ minHeight: cfg.minHeight }}>
        <SkeletonLoader width="w-16" height="h-2.5" />
        <div className="mt-1">
          <SkeletonLoader width="w-24" height={cfg.skeletonH} />
        </div>
      </div>
    )
  }

  return (
    <div className={className} style={{ minHeight: cfg.minHeight }}>
      {/* Label — always muted, caption scale */}
      <div className="text-ds-caption uppercase text-v2-text-2">
        {label}
      </div>
      {/* Value — primary emphasis, tnum for stability */}
      <div className={`${cfg.classes} ${sentimentClasses[sentiment]} leading-none mt-1`}>
        {value}
      </div>
      {/* Delta — secondary, reduced opacity */}
      {isPresent(delta) && (
        <div className={`text-ds-sm tnum mt-1 ${sentimentClasses[sentiment]} opacity-70`}>
          {delta}
        </div>
      )}
    </div>
  )
})
