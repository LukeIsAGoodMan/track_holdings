/**
 * MetricBlock (V3.5) — metric as text, not component.
 *
 * No box feel. No minHeight enforcement. Layout defines height.
 * Electronic-ink value transition: old fades out, new fades in.
 * Stable layout — no width jump, no baseline shift during transitions.
 *
 * Hierarchy:
 *   [label] — caption, muted
 *   [value] — size-dependent, tnum, electronic-ink refresh
 *   [delta] — small, semantic color, reduced opacity
 */
import { memo, useState, useEffect, useRef } from 'react'
import SkeletonLoader from './SkeletonLoader'

function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined
}

interface Props {
  label: string
  value: string
  delta?: string | null
  sentiment?: 'positive' | 'negative' | 'neutral'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  className?: string
}

const sizeClasses: Record<string, string> = {
  sm: 'text-ds-h2 tnum',
  md: 'text-ds-h1 tnum',
  lg: 'text-ds-display tnum',
}

const skeletonH: Record<string, string> = {
  sm: 'h-5',
  md: 'h-6',
  lg: 'h-8',
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
  // Electronic-ink: track previous value for cross-fade
  const [displayValue, setDisplayValue] = useState(value)
  const [opacity, setOpacity] = useState(1)
  const prevValue = useRef(value)

  useEffect(() => {
    if (value === prevValue.current) return
    prevValue.current = value
    // Fade out, swap, fade in
    setOpacity(0)
    const t = setTimeout(() => {
      setDisplayValue(value)
      setOpacity(1)
    }, 80)
    return () => clearTimeout(t)
  }, [value])

  // Sync on first render / loading transition
  useEffect(() => {
    if (!isLoading) {
      setDisplayValue(value)
      setOpacity(1)
    }
  }, [isLoading, value])

  if (isLoading) {
    return (
      <div className={className}>
        <SkeletonLoader width="w-16" height="h-2.5" />
        <div className="mt-1">
          <SkeletonLoader width="w-24" height={skeletonH[size]} />
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="text-ds-caption uppercase text-v2-text-2">
        {label}
      </div>
      <div
        className={`${sizeClasses[size]} ${sentimentClasses[sentiment]} leading-none mt-1`}
        style={{ opacity, transition: 'opacity 100ms ease-out' }}
      >
        {displayValue}
      </div>
      {isPresent(delta) && (
        <div className={`text-ds-sm tnum mt-1 ${sentimentClasses[sentiment]} opacity-70`}>
          {delta}
        </div>
      )}
    </div>
  )
})
