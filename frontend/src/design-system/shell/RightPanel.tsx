/**
 * RightPanel — shell-level sticky side panel.
 *
 * Formalized layout component for the right-side dashboard column.
 * Sticky positioning, fixed width, viewport-height aware.
 *
 * Layout constraints (from Architect's Refinement):
 *   - flex-none (non-flexible fixed-width)
 *   - sticky, top aligned to TopNav height
 *   - height: calc(100vh - topNavHeight)
 *   - internal overflow-y-auto for scrollable content
 *   - shell-level spacing rhythm
 *
 * Figma reference: 393px right panel.
 * Adaptation decision: we use 380px — slightly narrower to give main content
 * priority at 1440px viewports while maintaining card readability.
 * This is an intentional product adaptation, documented in layout-delta-audit.md.
 *
 * Usage:
 *   <RightPanel>
 *     <QuickRiskCard ... />
 *     <AllocationCard ... />
 *     <CashCard ... />
 *   </RightPanel>
 */
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export default function RightPanel({ children, className = '' }: Props) {
  return (
    <aside
      className={`
        flex-none w-[380px] shrink-0
        sticky top-14 h-[calc(100vh-3.5rem)]
        overflow-y-auto
        pl-5 pr-0
        space-y-5
        hidden xl:block
        ${className}
      `}
    >
      {children}
    </aside>
  )
}
