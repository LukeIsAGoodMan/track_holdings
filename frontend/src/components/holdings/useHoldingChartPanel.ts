/**
 * useHoldingChartPanel — shared state + fetch lifecycle for the holding chart slide-over.
 *
 * Responsibilities:
 *  - openPanel(symbol) / closePanel() / setChartView()
 *  - single fetch on open (returns intraday + eod in one call)
 *  - 5-minute auto-refresh while panel is open
 *  - strict interval cleanup on unmount / symbol switch / close
 *  - stale-response guard: ignores responses for previously selected symbols
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchHoldingChart } from '@/api/holdings'
import type { IntradayBar, EodLightBar } from '@/types'

export type ChartView = '1D' | '5D' | '1M'
export type ChartStatus = 'idle' | 'loading' | 'ready' | 'error'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export interface HoldingChartState {
  isOpen: boolean
  symbol: string | null
  view: ChartView
  status: ChartStatus
  intraday5min: IntradayBar[]
  eodLight: EodLightBar[]
  openPanel: (symbol: string) => void
  closePanel: () => void
  setView: (v: ChartView) => void
}

export function useHoldingChartPanel(): HoldingChartState {
  const [isOpen, setIsOpen]     = useState(false)
  const [symbol, setSymbol]     = useState<string | null>(null)
  const [view,   setView]       = useState<ChartView>('1D')
  const [status, setStatus]     = useState<ChartStatus>('idle')
  const [intraday5min, setIntraday] = useState<IntradayBar[]>([])
  const [eodLight,     setEod]      = useState<EodLightBar[]>([])

  // Guard against stale async responses
  const activeSymbolRef = useRef<string | null>(null)
  const intervalRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const doFetch = useCallback(async (sym: string) => {
    setStatus('loading')
    try {
      const data = await fetchHoldingChart(sym)
      // Only apply if this symbol is still the active one
      if (activeSymbolRef.current !== sym) return
      setIntraday(data.intraday_5min ?? [])
      setEod(data.eod_light ?? [])
      setStatus('ready')
    } catch {
      if (activeSymbolRef.current !== sym) return
      setStatus('error')
    }
  }, [])

  const openPanel = useCallback((sym: string) => {
    const normalized = sym.toUpperCase().trim()
    activeSymbolRef.current = normalized
    setSymbol(normalized)
    setIsOpen(true)
    setView('1D')
    doFetch(normalized)

    // Start 5-minute polling
    clearTimer()
    intervalRef.current = setInterval(() => {
      if (activeSymbolRef.current === normalized) {
        doFetch(normalized)
      }
    }, REFRESH_INTERVAL_MS)
  }, [doFetch, clearTimer])

  const closePanel = useCallback(() => {
    clearTimer()
    activeSymbolRef.current = null
    setIsOpen(false)
    setSymbol(null)
    setStatus('idle')
    setIntraday([])
    setEod([])
  }, [clearTimer])

  // Cleanup on unmount
  useEffect(() => clearTimer, [clearTimer])

  return {
    isOpen, symbol, view, status,
    intraday5min, eodLight,
    openPanel, closePanel, setView,
  }
}
