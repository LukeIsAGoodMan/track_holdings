/**
 * RightPanel — shell-level sticky side panel.
 *
 * Formalized layout component for the right-side dashboard column.
 * Sticky positioning within the main content scroll container.
 *
 * In the V3 shell, main content is inside:
 *   main surface (border + radius) → inner scroll div (overflow-y-auto)
 * RightPanel sticks to top-0 of that inner scroll container.
 *
 * Height uses the same panel height calculation as the sidebar:
 *   viewport - topNav(3.5rem) - 2*shellGutter(2rem) = calc(100vh - 5.5rem)
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
        sticky top-0 max-h-[calc(100vh-5.5rem)]
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
