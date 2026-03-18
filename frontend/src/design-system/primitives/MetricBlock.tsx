/**
 * MetricBlock — single financial metric display.
 *
 * Typography hierarchy: value (largest) > label (small, muted) > delta (contextual)
 * All numeric values use tabular-nums for alignment stability.
 *
 * Usage:
 *   <MetricBlock label="Daily P&L" value="+$1,234" delta="+2.3%" sentiment="positive" />
 */
import SkeletonLoader from './SkeletonLoader'

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

const valueClasses: Record<string, string> = {
  sm: 'text-lg font-semibold tracking-tight',
  md: 'text-2xl font-semibold tracking-tight',
  lg: 'text-3xl font-semibold tracking-tighter',
}

const sentimentClasses: Record<string, string> = {
  positive: 'text-v2-positive',
  negative: 'text-v2-negative',
  neutral:  'text-v2-text-1',
}

export default function MetricBlock({
  label,
  value,
  delta,
  sentiment = 'neutral',
  size = 'md',
  isLoading = false,
  className = '',
}: Props) {
  if (isLoading) {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <SkeletonLoader width="w-16" height="h-2.5" />
        <SkeletonLoader width="w-24" height={size === 'lg' ? 'h-8' : size === 'md' ? 'h-6' : 'h-5'} />
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-widest text-v2-text-3 mb-1">
        {label}
      </div>
      <div className={`${valueClasses[size]} ${sentimentClasses[sentiment]} tabular-nums leading-none`}>
        {value}
      </div>
      {delta && (
        <div className={`text-xs font-medium tabular-nums mt-1 ${sentimentClasses[sentiment]} opacity-70`}>
          {delta}
        </div>
      )}
    </div>
  )
}
