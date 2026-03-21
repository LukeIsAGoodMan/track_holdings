/**
 * SectionCard (V3) — surface subdivision, not a boxed widget.
 *
 * Cards are subdivisions of an existing surface, not components
 * sitting on top of the UI. They define structure through spacing
 * and subtle borders, not shadows or elevation.
 *
 * Surface rules:
 *   bg-v2-surface (same as parent — blends, doesn't float)
 *   border border-v2-border (very subtle, defines edges)
 *   rounded-v2-lg (consistent radius)
 *   p-5 default (breathable internal padding)
 *   NO shadow (cards are surface divisions, not elevated panels)
 *
 * Compound API:
 *   <SectionCard>
 *     <SectionCard.Header title="Holdings" action={<button>...</button>} />
 *     <SectionCard.Content>{children}</SectionCard.Content>
 *     <SectionCard.Footer>{footer}</SectionCard.Footer>
 *   </SectionCard>
 *
 * Spacing > borders: sections separated by spacing (gap/mt), not dividers.
 * Header → Content spacing: mb-4
 * Content → Footer spacing: mt-4
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
  /** Interactive card — subtle hover response */
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
        bg-v2-surface border border-v2-border rounded-v2-lg
        ${noPadding ? '' : 'p-5'}
        ${interactive ? 'transition-colors duration-150 hover:bg-v2-surface-hover cursor-pointer' : ''}
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
        <h3 className="text-ds-h3 text-v2-text-1">
          {title}
        </h3>
        {subtitle && (
          <p className="text-ds-sm text-v2-text-3 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

// ── Content ───────────────────────────────────────────────────────────────────

interface ContentProps {
  children: ReactNode
  className?: string
}

function CardContent({ children, className = '' }: ContentProps) {
  return <div className={className}>{children}</div>
}

// ── Footer ────────────────────────────────────────────────────────────────────

interface FooterProps {
  children: ReactNode
  className?: string
}

function CardFooter({ children, className = '' }: FooterProps) {
  return <div className={`mt-4 pt-4 border-t border-v2-border ${className}`}>{children}</div>
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
  Body:    CardContent,   // backward compat alias
  Content: CardContent,
  Footer:  CardFooter,
})

export default SectionCard
