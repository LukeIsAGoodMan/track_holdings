/**
 * PageContainer — consistent max-width + horizontal rhythm for all pages.
 *
 * Ensures premium spacing regardless of viewport width.
 */
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export default function PageContainer({ children, className = '' }: Props) {
  return (
    <div className={`max-w-v2-content mx-auto px-6 md:px-8 py-6 ${className}`}>
      {children}
    </div>
  )
}
