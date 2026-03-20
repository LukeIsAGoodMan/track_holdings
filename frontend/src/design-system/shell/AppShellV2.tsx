/**
 * AppShellV2 — Production app shell with synced transitions.
 *
 * Structure:
 *   <TopNavV2 />
 *   <div class="flex">
 *     <SidebarV2 />  ← width transitions 200ms ease-out
 *     <main />       ← flex-1 naturally absorbs width change in sync
 *   </div>
 *
 * Key behavior:
 *   - Sidebar and main content breathe as one system
 *   - No "sidebar moves first, content snaps later" — flex layout auto-syncs
 *   - Action panels (trade, alerts) replace sidebar with fixed-width panel
 *   - Page transitions feel calm: content area is always present
 */
import { Outlet } from 'react-router-dom'
import TopNavV2      from './TopNavV2'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

import { useSidebar } from '@/context/SidebarContext'
import TradeEntryForm    from '@/components/TradeEntryForm'
import PriceAlertsSidebar from '@/components/PriceAlertsSidebar'

export default function AppShellV2() {
  const { mode, isExpanded } = useSidebar()
  const showPanel = mode !== 'nav'

  return (
    <div className="flex flex-col min-h-screen bg-v2-bg">
      <TopNavV2 />

      <div className="flex flex-1">
        {/* Sidebar: nav or action panel */}
        {showPanel ? (
          <ActionPanel />
        ) : (
          <SidebarV2 />
        )}

        {/* Main content — flex-1 absorbs sidebar width changes in sync.
            The transition on the sidebar's width causes the main area
            to reflow smoothly because flexbox distributes space each frame. */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <PageContainer>
            <Outlet />
          </PageContainer>
        </main>
      </div>
    </div>
  )
}

// ── Action Panel (trade entry, alerts, etc.) ─────────────────────────────────

function ActionPanel() {
  const {
    mode, pendingClose, alertPrefill,
    exitTradeEntry, exitPriceAlerts,
    exitPortfolioCreate, exitPortfolioEdit,
  } = useSidebar()

  const handleBack = () => {
    if (mode === 'trade_entry') exitTradeEntry()
    else if (mode === 'price_alerts') exitPriceAlerts()
    else if (mode === 'portfolio_create') exitPortfolioCreate()
    else if (mode === 'portfolio_edit') exitPortfolioEdit()
  }

  return (
    <aside className="w-v2-panel shrink-0 bg-v2-surface border-r border-v2-border
                      h-[calc(100vh-3.5rem)] sticky top-14 overflow-y-auto"
           style={{ zIndex: 20 }}>
      <div className="p-4">
        {/* Panel header with back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-ds-sm font-bold text-v2-text-3
                     hover:text-v2-text-1 mb-4 transition-colors duration-150"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to navigation
        </button>

        {mode === 'trade_entry' && (
          <TradeEntryForm
            closeState={pendingClose}
            onSuccess={exitTradeEntry}
          />
        )}
        {mode === 'price_alerts' && (
          <PriceAlertsSidebar prefill={alertPrefill} />
        )}
      </div>
    </aside>
  )
}
