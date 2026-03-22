/**
 * AppShellV2 — Single shell system.
 *
 * No TopNav. Sidebar is the only physical shell.
 * Main content is a full white canvas with margin-left.
 *
 * Architecture:
 *   <div class="flex min-h-screen">
 *     <SidebarSurface />  ← fixed, full height, metal shell
 *     <main />            ← flex-1, white canvas, independent
 *   </div>
 */
import { Outlet } from 'react-router-dom'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

import { useSidebar } from '@/context/SidebarContext'
import TradeEntryForm    from '@/components/TradeEntryForm'
import PriceAlertsSidebar from '@/components/PriceAlertsSidebar'
import { PortfolioCreatePanel, PortfolioEditPanel } from './PortfolioPanels'

export default function AppShellV2() {
  const { mode, isExpanded } = useSidebar()
  const showPanel = mode !== 'nav'

  return (
    <div className="flex min-h-screen bg-v2-bg">
      {/* ═══ Left: Sidebar shell (fixed, full height) ═══════════ */}
      {showPanel ? (
        <ActionPanelSurface />
      ) : (
        <SidebarSurface isExpanded={isExpanded} />
      )}

      {/* ═══ Right: Main content canvas ═════════════════════════ */}
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
  )
}

// ── Sidebar Surface — the only physical shell ───────────────────────────────

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
        position: 'fixed',
        left: 0,
        top: 0,
        height: '100vh',
        zIndex: 20,
        backgroundImage: [
          'radial-gradient(90% 50% at 20% 0%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.00) 60%)',
          'linear-gradient(180deg, #cfcbc7 0%, #c4bfba 42%, #b9b4af 100%)',
        ].join(', '),
        borderTopRightRadius: '14px',
        borderBottomRightRadius: '14px',
        boxShadow: '1px 0 0 rgba(0,0,0,0.02), 4px 0 16px -10px rgba(0,0,0,0.06), inset -1px 0 0 rgba(255,255,255,0.05)',
      }}
    >
      <SidebarV2 />
    </div>
  )
}

// ── Action Panel Surface ────────────────────────────────────────────────────

function ActionPanelSurface() {
  const {
    mode, pendingClose, alertPrefill, editTarget,
    exitTradeEntry, exitPriceAlerts,
    exitPortfolioCreate, exitPortfolioEdit,
    openPortfolioCreate,
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
        position: 'fixed',
        left: 0,
        top: 0,
        height: '100vh',
        zIndex: 20,
        backgroundImage: [
          'radial-gradient(90% 50% at 20% 0%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.00) 60%)',
          'linear-gradient(180deg, #cfcbc7 0%, #c4bfba 42%, #b9b4af 100%)',
        ].join(', '),
        borderTopRightRadius: '14px',
        borderBottomRightRadius: '14px',
        boxShadow: '1px 0 0 rgba(0,0,0,0.02), 4px 0 16px -10px rgba(0,0,0,0.06), inset -1px 0 0 rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Trade / Alerts modes — generic back + content */}
        {(mode === 'trade_entry' || mode === 'price_alerts') && (
          <div className="p-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 mb-4 ds-color"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
            {mode === 'trade_entry' && <TradeEntryForm closeState={pendingClose} onSuccess={exitTradeEntry} />}
            {mode === 'price_alerts' && <PriceAlertsSidebar prefill={alertPrefill} />}
          </div>
        )}

        {/* Portfolio panels — own header with back */}
        {mode === 'portfolio_create' && (
          <PortfolioCreatePanel onBack={exitPortfolioCreate} />
        )}
        {mode === 'portfolio_edit' && editTarget && (
          <PortfolioEditPanel
            target={editTarget}
            onBack={exitPortfolioEdit}
            onAddChild={() => {
              exitPortfolioEdit()
              setTimeout(() => openPortfolioCreate(), 50)
            }}
          />
        )}
      </div>
    </div>
  )
}
