/**
 * SkeletonLoader — pulse placeholder for async content.
 *
 * Variants:
 *   line   — single horizontal bar (default)
 *   block  — rectangular area
 *   circle — avatar / icon placeholder
 *
 * Uses surface-alt for skeleton bg (frozen token).
 * Skeleton radius matches target component radius (sm by default).
 */
import type { CSSProperties } from 'react'

interface Props {
  variant?: 'line' | 'block' | 'circle'
  /** Tailwind width class, e.g. "w-24" */
  width?: string
  /** Tailwind height class, e.g. "h-4" */
  height?: string
  /** Additional class names */
  className?: string
  style?: CSSProperties
}

export default function SkeletonLoader({
  variant = 'line',
  width,
  height,
  className = '',
  style,
}: Props) {
  const base = 'animate-pulse bg-v2-surface-alt rounded-v2-sm'

  const defaults: Record<string, string> = {
    line:   `${width ?? 'w-full'} ${height ?? 'h-3'}`,
    block:  `${width ?? 'w-full'} ${height ?? 'h-20'}`,
    circle: `${width ?? 'w-8'} ${height ?? 'h-8'} !rounded-full`,
  }

  return <div className={`${base} ${defaults[variant]} ${className}`} style={style} />
}
