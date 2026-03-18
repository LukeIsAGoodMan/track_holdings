/**
 * Toolbar — horizontal action bar for workspace pages.
 *
 * Slot-driven: left (primary actions), center (optional), right (secondary).
 * Consistent height and spacing across all workspaces.
 */
import type { ReactNode } from 'react'

interface Props {
  /** Primary actions (left-aligned) */
  left?: ReactNode
  /** Optional center content (search, filters, etc.) */
  center?: ReactNode
  /** Secondary actions (right-aligned) */
  right?: ReactNode
  className?: string
}

export default function Toolbar({ left, center, right, className = '' }: Props) {
  return (
    <div className={`flex items-center justify-between gap-3 px-1 py-2 ${className}`}>
      <div className="flex items-center gap-2 shrink-0">
        {left}
      </div>
      {center && (
        <div className="flex-1 min-w-0 flex items-center justify-center">
          {center}
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0">
        {right}
      </div>
    </div>
  )
}
