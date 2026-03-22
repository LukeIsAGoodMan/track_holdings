/**
 * AppShellV2 — Push-layout shell system.
 *
 * Architecture:
 *   Sidebar (fixed left) — always visible
 *   Action Panel (fixed, left of main) — pushes main content right when open
 *   Main Content — margin-left adapts dynamically
 *
 * When action panel opens, main canvas slides right so the portfolio view
 * remains visible alongside the entry form.
 */
import { Outlet } from 'react-router-dom'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

import { useSidebar } from '@/context/SidebarContext'
import TradeEntryForm    from '@/components/TradeEntryForm'
import PriceAlertsSidebar from '@/components/PriceAlertsSidebar'
import { PortfolioCreatePanel, PortfolioEditPanel } from './PortfolioPanels'

/** Shell surface — shared warm silver aluminum */
const SHELL_BG = [
  'radial-gradient(90% 50% at 20% 0%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.00) 60%)',
  'linear-gradient(180deg, #cfcbc7 0%, #c4bfba 42%, #b9b4af 100%)',
].join(', ')

/** Sidebar surface — no right radius (panel extends from it) */
const SIDEBAR_STYLE = {
  backgroundImage: SHELL_BG,
} as const

/** Action panel surface — no left radius (flush with sidebar), right edge has radius + occlusion */
const PANEL_STYLE = {
  backgroundImage: SHELL_BG,
  borderTopRightRadius: '14px',
  borderBottomRightRadius: '14px',
  boxShadow: '2px 0 12px -8px rgba(0,0,0,0.06)',
} as const

/** Sidebar-only surface — when panel is closed, sidebar gets right radius */
const SIDEBAR_SOLO_STYLE = {
  backgroundImage: SHELL_BG,
  borderTopRightRadius: '14px',
  borderBottomRightRadius: '14px',
  boxShadow: '1px 0 0 rgba(0,0,0,0.02), 4px 0 16px -10px rgba(0,0,0,0.06), inset -1px 0 0 rgba(255,255,255,0.05)',
} as const

export default function AppShellV2() {
  const { mode, isExpanded } = useSidebar()
  const showPanel = mode !== 'nav'

  // Dynamic sidebar width for margin calculation
  const sidebarWidth = isExpanded ? 240 : 64   // w-v2-sidebar / w-v2-sidebar-sm
  const panelWidth = 520                        // w-v2-panel
  const mainMargin = showPanel ? sidebarWidth + panelWidth : sidebarWidth

  return (
    <div className="min-h-screen bg-v2-bg">
      {/* ═══ Fixed sidebar (always visible) ═══════════════════════ */}
      <SidebarSurface isExpanded={isExpanded} panelOpen={showPanel} />

      {/* ═══ Fixed action panel (when open, beside sidebar) ══════ */}
      {showPanel && (
        <ActionPanelSurface sidebarWidth={sidebarWidth} />
      )}

      {/* ═══ Main content — pushes right when panel opens ════════ */}
      <div
        className="min-h-screen p-4 ds-bg"
        style={{
          marginLeft: `${mainMargin}px`,
          transition: 'margin-left 220ms ease-out',
        }}
      >
        <div className="bg-v2-surface border border-v2-border rounded-v2-lg flex flex-col min-h-[calc(100vh-2rem)]">
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

// ── Sidebar Surface ─────────────────────────────────────────────────────────

function SidebarSurface({ isExpanded, panelOpen }: { isExpanded: boolean; panelOpen: boolean }) {
  return (
    <div
      className={`
        shrink-0 flex flex-col overflow-hidden
        ${isExpanded ? 'w-v2-sidebar' : 'w-v2-sidebar-sm'}
      `}
      style={{
        position: 'fixed', left: 0, top: 0, height: '100vh', zIndex: 20,
        transition: 'width 220ms ease-out',
        ...(panelOpen ? SIDEBAR_STYLE : SIDEBAR_SOLO_STYLE),
      }}
    >
      <SidebarV2 />
    </div>
  )
}

// ── Action Panel Surface (fixed, positioned after sidebar) ──────────────────

function ActionPanelSurface({ sidebarWidth }: { sidebarWidth: number }) {
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
      className="w-v2-panel flex flex-col overflow-hidden"
      style={{
        position: 'fixed',
        left: `${sidebarWidth}px`,
        top: 0,
        height: '100vh',
        zIndex: 19,
        transition: 'left 220ms ease-out',
        ...PANEL_STYLE,
      }}
    >
      <div className="flex-1 overflow-y-auto flex flex-col">
        {(mode === 'trade_entry' || mode === 'price_alerts') && (
          <div className="p-4">
            <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 mb-4 ds-color">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
            {mode === 'trade_entry' && <TradeEntryForm closeState={pendingClose} onSuccess={exitTradeEntry} />}
            {mode === 'price_alerts' && <PriceAlertsSidebar prefill={alertPrefill} />}
          </div>
        )}
        {mode === 'portfolio_create' && <PortfolioCreatePanel onBack={exitPortfolioCreate} />}
        {mode === 'portfolio_edit' && editTarget && (
          <PortfolioEditPanel
            target={editTarget}
            onBack={exitPortfolioEdit}
            onAddChild={() => { exitPortfolioEdit(); setTimeout(() => openPortfolioCreate(), 50) }}
          />
        )}
      </div>
    </div>
  )
}
