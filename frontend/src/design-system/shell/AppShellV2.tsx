/**
 * AppShellV2 — Flush sidebar + floating main content.
 *
 * Architecture:
 *   TopNavV2 (full-width, sticky top-0)
 *   ├─ SidebarSurface (flush left, flush to TopNav, no gap)
 *   └─ Main wrapper (p-4 gutter, contains floating main surface)
 *
 * Sidebar is physically connected to the left edge and TopNav.
 * Main content floats independently with its own padding.
 * The two are separated by the main wrapper's left padding.
 *
 * Sticky logic:
 *   Sidebar: top = 3.5rem (TopNav height), height = calc(100vh - 3.5rem)
 *   No gutter offset — sidebar starts exactly under TopNav.
 *
 * Metallic joint:
 *   Sidebar has borderTop: 1px solid rgba(255,255,255,0.04)
 *   This creates a subtle seam where sidebar meets TopNav bottom edge.
 */
import { Outlet } from 'react-router-dom'
import TopNavV2      from './TopNavV2'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

import { useSidebar } from '@/context/SidebarContext'
import TradeEntryForm    from '@/components/TradeEntryForm'
import PriceAlertsSidebar from '@/components/PriceAlertsSidebar'

const SIDEBAR_TOP = '3.5rem'
const SIDEBAR_HEIGHT = 'calc(100vh - 3.5rem)'

export default function AppShellV2() {
  const { mode, isExpanded } = useSidebar()
  const showPanel = mode !== 'nav'

  return (
    <div className="flex flex-col min-h-screen bg-v2-bg">
      <TopNavV2 />

      {/* ═══ Shell body — sidebar flush + main floating ═══════════ */}
      <div className="flex flex-1">

        {/* ── Left: Sidebar (flush to left edge + TopNav) ──────── */}
        {showPanel ? (
          <ActionPanelSurface />
        ) : (
          <SidebarSurface isExpanded={isExpanded} />
        )}

        {/* ── Right: Main content wrapper (owns the gutter) ────── */}
        <div className="flex-1 min-w-0 p-4">
          <div className="bg-v2-surface border border-v2-border rounded-v2-lg flex flex-col h-full">
            <div className="flex-1 overflow-y-auto rounded-v2-lg">
              <PageContainer>
                <Outlet />
              </PageContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar Surface (flush, no rounding on left) ────────────────────────────

function SidebarSurface({ isExpanded }: { isExpanded: boolean }) {
  return (
    <div
      className={`
        shrink-0
        flex flex-col overflow-hidden
        transition-[width] duration-200 ease-out
        ${isExpanded ? 'w-v2-sidebar' : 'w-v2-sidebar-sm'}
      `}
      style={{
        zIndex: 20,
        position: 'sticky',
        top: SIDEBAR_TOP,
        height: SIDEBAR_HEIGHT,
        background: 'linear-gradient(180deg, #d6d3d1 0%, #ccc9c6 40%, #c4c1be 100%)',
        borderTopRightRadius: '14px',
        borderBottomRightRadius: '14px',
        boxShadow: '2px 0 12px -8px rgba(0, 0, 0, 0.06), inset -1px 0 0 rgba(255, 255, 255, 0.06)',
      }}
    >
      <SidebarV2 />
    </div>
  )
}

// ── Action Panel Surface (same flush treatment) ─────────────────────────────

function ActionPanelSurface() {
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
    <div
      className="w-v2-panel shrink-0 flex flex-col overflow-hidden"
      style={{
        zIndex: 20,
        position: 'sticky',
        top: SIDEBAR_TOP,
        height: SIDEBAR_HEIGHT,
        background: 'linear-gradient(180deg, #d6d3d1 0%, #ccc9c6 40%, #c4c1be 100%)',
        borderTopRightRadius: '14px',
        borderBottomRightRadius: '14px',
        boxShadow: '2px 0 12px -8px rgba(0, 0, 0, 0.06), inset -1px 0 0 rgba(255, 255, 255, 0.06)',
      }}
    >
      <div className="flex-1 overflow-y-auto p-4">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-ds-sm text-stone-500
                     hover:text-stone-700 mb-4 transition-colors duration-150"
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
    </div>
  )
}
