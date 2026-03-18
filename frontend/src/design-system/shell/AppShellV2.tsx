/**
 * AppShellV2 — next-generation app shell.
 *
 * Structure:
 *   <TopNavV2 />
 *   <div class="flex">
 *     <SidebarV2 />
 *     <main>
 *       <PageContainer>{children}</PageContainer>
 *     </main>
 *   </div>
 *
 * Supports:
 *   - Future sidebar collapse (via SidebarContext)
 *   - Future multi-layout pages
 *   - Responsive: sidebar collapses to icon rail on md, hidden on sm
 *   - Existing action panels (trade entry, alerts) via SidebarContext mode
 *
 * Does NOT modify business logic. Same context providers, same routes.
 */
import { Outlet } from 'react-router-dom'
import TopNavV2      from './TopNavV2'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

// Import existing action panels — they plug into the sidebar panel slot
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

        {/* Main content */}
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

  return (
    <aside className="w-v2-panel shrink-0 bg-v2-surface border-r border-v2-border-sub
                      h-[calc(100vh-3.5rem)] sticky top-14 overflow-y-auto">
      <div className="p-4">
        {/* Panel header with back button */}
        <button
          onClick={() => {
            if (mode === 'trade_entry') exitTradeEntry()
            else if (mode === 'price_alerts') exitPriceAlerts()
            else if (mode === 'portfolio_create') exitPortfolioCreate()
            else if (mode === 'portfolio_edit') exitPortfolioEdit()
          }}
          className="flex items-center gap-1.5 text-xs font-medium text-v2-text-3
                     hover:text-v2-text-1 mb-4 transition-colors"
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
        {/* portfolio_create and portfolio_edit use existing sidebar panels
            which we delegate to the V1 Sidebar for now */}
      </div>
    </aside>
  )
}
