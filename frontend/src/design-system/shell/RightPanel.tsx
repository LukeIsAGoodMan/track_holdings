/**
 * RightPanel — shell-level sticky side panel.
 *
 * Formalized layout component for the right-side dashboard column.
 * Sticky positioning within the main scroll container.
 *
 * Layout constraints:
 *   - flex-none (non-flexible fixed-width)
 *   - sticky top-0 within the main overflow-y-auto container
 *   - max-height fills viewport minus TopNav
 *   - internal overflow-y-auto for independently scrollable content
 *   - shell-level spacing rhythm
 *
 * Sticky safety: The parent <main> in AppShellV2 uses overflow-y-auto,
 * which is the scroll container. RightPanel sticks to top-0 of that container.
 * TopNav is outside the scroll container (sticky in the outer flex), so
 * we don't need to offset for it. We use max-h to limit panel height to
 * the visible viewport.
 *
 * Width: 380px — intentional product adaptation from Figma 393px.
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
        sticky top-0 max-h-[calc(100vh-3.5rem)]
        overflow-y-auto
        pl-5 pr-0 pt-0
        space-y-5
        hidden xl:block
        ${className}
      `}
    >
      {children}
    </aside>
  )
}
