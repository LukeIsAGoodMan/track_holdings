/**
 * SidebarContext — lightweight state for the sidebar's dual mode.
 *
 * Any page can call openTradeEntry(closeState?) to switch the sidebar
 * into trade-entry mode.  This replaces the old navigate('/trade') pattern.
 */
import React, { createContext, useCallback, useContext, useState } from 'react'
import type { ClosePositionState } from '@/types'

export type SidebarMode = 'nav' | 'trade_entry'

interface SidebarContextValue {
  mode:           SidebarMode
  isExpanded:     boolean          // nav-mode collapse toggle
  pendingClose:   ClosePositionState | null
  openTradeEntry: (cs?: ClosePositionState) => void
  exitTradeEntry: () => void
  toggleExpand:   () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mode,         setMode]         = useState<SidebarMode>('nav')
  const [isExpanded,   setIsExpanded]   = useState(true)
  const [pendingClose, setPendingClose] = useState<ClosePositionState | null>(null)

  const openTradeEntry = useCallback((cs?: ClosePositionState) => {
    setPendingClose(cs ?? null)
    setMode('trade_entry')
    setIsExpanded(true)
  }, [])

  const exitTradeEntry = useCallback(() => {
    setMode('nav')
    setPendingClose(null)
  }, [])

  const toggleExpand = useCallback(() => setIsExpanded(v => !v), [])

  return (
    <SidebarContext.Provider
      value={{ mode, isExpanded, pendingClose, openTradeEntry, exitTradeEntry, toggleExpand }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>')
  return ctx
}
