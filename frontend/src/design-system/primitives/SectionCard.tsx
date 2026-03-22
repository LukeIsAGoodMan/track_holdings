/**
 * SectionCard (V3.5) — structure without boxes.
 *
 * Cards define grouping via spacing and rhythm, not borders.
 * Borders are removed. Spacing creates hierarchy.
 * Interactive cards reveal themselves through ultra-subtle hover surfaces.
 *
 * Surface:
 *   NO border (structure via spacing)
 *   NO shadow
 *   bg-transparent (blends into parent)
 *   p-5 default padding (internal breathing room)
 *
 * Interactive mode:
 *   hover: rgba(0,0,0,0.02) — barely perceptible surface reveal
 *   NO glow, NO shadow, NO visible effect
 *
 * noPadding: for tables/charts that need edge-to-edge content
 */
import type { ReactNode, CSSProperties } from 'react'
import SkeletonLoader from './SkeletonLoader'

// ── Root ──────────────────────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  isLoading?: boolean
  minHeight?: string
  noPadding?: boolean
  interactive?: boolean
}

function SectionCardRoot({
  children,
  className = '',
  style,
  isLoading = false,
  minHeight,
  noPadding = false,
  interactive = false,
}: CardProps) {
  return (
    <div
      className={`
        rounded-v2-lg
        ${noPadding ? '' : 'p-5'}
        ${interactive ? 'transition-colors duration-150 hover:bg-black/[0.02] cursor-pointer' : ''}
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
  action?: ReactNode
  className?: string
}

function CardHeader({ title, subtitle, action, className = '' }: HeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-4 ${className}`}>
      <div>
        <h3 className="text-ds-h3 text-v2-text-1">{title}</h3>
        {subtitle && <p className="text-ds-sm text-v2-text-3 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

// ── Content ───────────────────────────────────────────────────────────────────

function CardContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}

// ── Footer ────────────────────────────────────────────────────────────────────

function CardFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mt-4 pt-4 ${className}`}>{children}</div>
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
  Header:  CardHeader,
  Body:    CardContent,
  Content: CardContent,
  Footer:  CardFooter,
})

export default SectionCard
