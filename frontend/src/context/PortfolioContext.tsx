/**
 * PortfolioContext
 *
 * Provides the selected portfolio ID and the full portfolio tree to every
 * component in the app.  The Sidebar writes to this context; pages read from it
 * to filter their API calls.
 *
 * refreshKey increments whenever the user clicks "Refresh" — pages that
 * subscribe to it via useEffect will re-fetch automatically.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { fetchPortfolios } from '@/api/holdings'
import type { Portfolio } from '@/types'

interface PortfolioContextValue {
  portfolios:            Portfolio[]
  selectedPortfolioId:   number | null
  setSelectedPortfolioId:(id: number | null) => void
  refreshKey:            number
  triggerRefresh:        () => void
  loading:               boolean
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null)

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [portfolios,          setPortfolios]          = useState<Portfolio[]>([])
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null)
  const [refreshKey,          setRefreshKey]          = useState(0)
  const [loading,             setLoading]             = useState(true)

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  // Load portfolio tree on mount and on every refresh
  useEffect(() => {
    setLoading(true)
    fetchPortfolios()
      .then((data) => {
        setPortfolios(data)
        // Auto-select the first leaf (first child of root) on initial load
        if (selectedPortfolioId === null && data.length > 0) {
          const firstLeaf = data[0].children[0] ?? data[0]
          setSelectedPortfolioId(firstLeaf.id)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  return (
    <PortfolioContext.Provider
      value={{
        portfolios,
        selectedPortfolioId,
        setSelectedPortfolioId,
        refreshKey,
        triggerRefresh,
        loading,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  )
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio must be used inside <PortfolioProvider>')
  return ctx
}
