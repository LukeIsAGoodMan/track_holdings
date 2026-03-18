/**
 * SectionCard — primary container for page sections.
 *
 * Mercury-clean: white surface, minimal shadow, generous internal spacing.
 * Supports loading state with stable min-height to prevent layout shift.
 *
 * Usage:
 *   <SectionCard>
 *     <SectionCard.Header title="Holdings" action={<button>...</button>} />
 *     <SectionCard.Body>{children}</SectionCard.Body>
 *   </SectionCard>
 */
import type { ReactNode, CSSProperties } from 'react'
import SkeletonLoader from './SkeletonLoader'

// ── Root ──────────────────────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Show skeleton loading state */
  isLoading?: boolean
  /** Minimum height to prevent layout shift during async hydration */
  minHeight?: string
  /** Remove default padding (for tables/charts that need edge-to-edge) */
  noPadding?: boolean
}

function SectionCardRoot({
  children,
  className = '',
  style,
  isLoading = false,
  minHeight,
  noPadding = false,
}: CardProps) {
  return (
    <div
      className={`
        bg-v2-surface rounded-v2-xl shadow-v2-sm
        ${noPadding ? '' : 'p-5'}
        ${className}
      `}
      style={{ minHeight, ...style }}
    >
      {isLoading ? <CardSkeleton /> : children}
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  title: string
  subtitle?: string
  /** Right-aligned action slot (button, toggle, etc.) */
  action?: ReactNode
  className?: string
}

function CardHeader({ title, subtitle, action, className = '' }: HeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-4 ${className}`}>
      <div>
        <h3 className="text-[15px] font-semibold text-v2-text-1 tracking-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="text-[11px] text-v2-text-3 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

// ── Body ──────────────────────────────────────────────────────────────────────

interface BodyProps {
  children: ReactNode
  className?: string
}

function CardBody({ children, className = '' }: BodyProps) {
  return <div className={className}>{children}</div>
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="space-y-3">
      <SkeletonLoader width="w-32" height="h-4" />
      <SkeletonLoader width="w-full" height="h-3" />
      <SkeletonLoader width="w-3/4" height="h-3" />
      <SkeletonLoader variant="block" height="h-16" />
    </div>
  )
}

// ── Compound export ───────────────────────────────────────────────────────────

const SectionCard = Object.assign(SectionCardRoot, {
  Header: CardHeader,
  Body:   CardBody,
})

export default SectionCard
