/**
 * SectionGrid — responsive grid container for page sections.
 *
 * Adapts columns based on viewport:
 *   xl  → cols (default 3)
 *   md  → 2
 *   sm  → 1
 *
 * Supports dynamic children — no fixed child count assumption.
 */
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Max columns at xl breakpoint (default: 3) */
  cols?: 2 | 3 | 4 | 5
  /** Gap size (default: gap-5) */
  gap?: string
  className?: string
}

const colClasses: Record<number, string> = {
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
}

export default function SectionGrid({
  children,
  cols = 3,
  gap = 'gap-5',
  className = '',
}: Props) {
  return (
    <div className={`grid ${colClasses[cols]} ${gap} ${className}`}>
      {children}
    </div>
  )
}
