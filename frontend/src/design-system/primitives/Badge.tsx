/**
 * Badge — semantic status indicator pill.
 *
 * Variants:
 *   blue    — action/info (azure tint bg, accent text)
 *   yellow  — warning/caution (yellow tint bg, warning text)
 *   neutral — default/muted (surface-alt bg, secondary text)
 *
 * Typography: caption scale (10px, bold, wide tracking)
 * Radius: full pill
 *
 * Usage:
 *   <Badge variant="blue">Live</Badge>
 *   <Badge variant="yellow">Expiring</Badge>
 */
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  variant?: 'blue' | 'yellow' | 'neutral'
  className?: string
}

const variantClasses: Record<string, string> = {
  blue:    'bg-v2-overlay-badge-blue text-v2-accent',
  yellow:  'bg-v2-overlay-badge-yellow text-v2-warning',
  neutral: 'bg-v2-surface-alt text-v2-text-2',
}

export default function Badge({
  children,
  variant = 'neutral',
  className = '',
}: Props) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full
        text-ds-caption
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  )
}
