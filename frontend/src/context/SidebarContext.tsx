/**
 * SidebarContext — state for the sidebar's five modes:
 *   'nav'               — collapsed/expanded portfolio + actions
 *   'trade_entry'       — 520px locked trade form
 *   'price_alerts'      — 520px locked price-alert panel
 *   'portfolio_create'  — 520px inline portfolio-creation form (Phase 16E)
 *   'portfolio_edit'    — 520px inline portfolio-edit panel (Phase 16U)
 */
import React, { createContext, useCallback, useContext, useState } from 'react'
import type { ClosePositionState, Portfolio } from '@/types'

export type SidebarMode = 'nav' | 'trade_entry' | 'price_alerts' | 'portfolio_create' | 'portfolio_edit'

export interface AlertPrefill {
  symbol: string
  price:  number
}

interface SidebarContextValue {
  mode:                 SidebarMode
  isExpanded:           boolean
  pendingClose:         ClosePositionState | null
  alertPrefill:         AlertPrefill | null
  editTarget:           Portfolio | null
  openTradeEntry:       (cs?: ClosePositionState) => void
  exitTradeEntry:       () => void
  openPriceAlerts:      (prefill?: AlertPrefill) => void
  exitPriceAlerts:      () => void
  openPortfolioCreate:  () => void
  exitPortfolioCreate:  () => void
  openPortfolioEdit:    (node: Portfolio) => void
  exitPortfolioEdit:    () => void
  toggleExpand:         () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mode,         setMode]         = useState<SidebarMode>('nav')
  const [isExpanded,   setIsExpanded]   = useState(true)
  const [pendingClose, setPendingClose] = useState<ClosePositionState | null>(null)
  const [alertPrefill, setAlertPrefill] = useState<AlertPrefill | null>(null)
  const [editTarget,   setEditTarget]   = useState<Portfolio | null>(null)

  const openTradeEntry = useCallback((cs?: ClosePositionState) => {
    setPendingClose(cs ?? null)
    setAlertPrefill(null)
    setMode('trade_entry')
    setIsExpanded(true)
  }, [])

  const exitTradeEntry = useCallback(() => {
    setMode('nav')
    setPendingClose(null)
  }, [])

  const openPriceAlerts = useCallback((prefill?: AlertPrefill) => {
    setAlertPrefill(prefill ?? null)
    setPendingClose(null)
    setMode('price_alerts')
    setIsExpanded(true)
  }, [])

  const exitPriceAlerts = useCallback(() => {
    setMode('nav')
    setAlertPrefill(null)
  }, [])

  const openPortfolioCreate = useCallback(() => {
    setPendingClose(null)
    setAlertPrefill(null)
    setMode('portfolio_create')
    setIsExpanded(true)
  }, [])

  const exitPortfolioCreate = useCallback(() => {
    setMode('nav')
  }, [])

  const openPortfolioEdit = useCallback((node: Portfolio) => {
    setPendingClose(null)
    setAlertPrefill(null)
    setEditTarget(node)
    setMode('portfolio_edit')
    setIsExpanded(true)
  }, [])

  const exitPortfolioEdit = useCallback(() => {
    setMode('nav')
    setEditTarget(null)
  }, [])

  const toggleExpand = useCallback(() => setIsExpanded(v => !v), [])

  return (
    <SidebarContext.Provider
      value={{
        mode, isExpanded, pendingClose, alertPrefill, editTarget,
        openTradeEntry,      exitTradeEntry,
        openPriceAlerts,     exitPriceAlerts,
        openPortfolioCreate, exitPortfolioCreate,
        openPortfolioEdit,   exitPortfolioEdit,
        toggleExpand,
      }}
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
