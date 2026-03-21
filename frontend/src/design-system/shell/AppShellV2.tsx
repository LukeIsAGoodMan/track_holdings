/**
 * AppShellV2 — Dual-surface production app shell.
 *
 * Architecture:
 *   TopNavV2 (full-width, sticky)
 *   Shell frame (bg-v2-bg, outer gutter p-4)
 *     ├─ Sidebar surface (bg-v2-surface, border, rounded, sticky)
 *     │  gap-4 (spatial separation — no double-border seam)
 *     └─ Main surface (bg-v2-surface, border, rounded)
 *        └─ overflow container (scroll)
 *           └─ PageContainer → Outlet
 *
 * Design intent:
 *   - Sidebar reads as a contained panel, not edge-attached chrome
 *   - Main content is a canvas inside a container
 *   - Shell breathes through outer gutters and spatial separation
 *   - No content bleeds outside rounded frames
 *
 * Scroll/clipping strategy:
 *   - Outer surface = border + radius (NO overflow control)
 *   - Inner scroll layer = overflow-y-auto (handles scroll)
 *   - This prevents rounded-corner bleed while preserving scrolling
 *
 * Sticky logic:
 *   - Sidebar surface: sticky, top offset = topNavHeight + shellGutter
 *   - Height = viewport - topNav - 2 * shellGutter (top + bottom)
 *   - Sticky works because the flex container is NOT overflow-clipped
 */
import { Outlet } from 'react-router-dom'
import TopNavV2      from './TopNavV2'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

import { useSidebar } from '@/context/SidebarContext'
import TradeEntryForm    from '@/components/TradeEntryForm'
import PriceAlertsSidebar from '@/components/PriceAlertsSidebar'

/**
 * Semantic layout constants derived from tokens.
 * topNav = 3.5rem (56px), shellGutter = 1rem (16px)
 * stickyTop = topNav + shellGutter = 4.5rem
 * panelHeight = 100vh - topNav - 2 * shellGutter = calc(100vh - 5.5rem)
 */
const STICKY_TOP = '4.5rem'       // 3.5rem topNav + 1rem gutter
const PANEL_HEIGHT = 'calc(100vh - 5.5rem)'  // viewport - topNav - top gutter - bottom gutter

export default function AppShellV2() {
  const { mode, isExpanded } = useSidebar()
  const showPanel = mode !== 'nav'

  return (
    <div className="flex flex-col min-h-screen bg-v2-bg">
      <TopNavV2 />

      {/* ═══ Shell frame — outer gutters + dual-surface layout ════════ */}
      <div className="flex flex-1 gap-4 p-4">

        {/* ── Left surface: Sidebar or Action Panel ────────────────── */}
        {showPanel ? (
          <ActionPanelSurface />
        ) : (
          <SidebarSurface isExpanded={isExpanded} />
        )}

        {/* ── Right surface: Main content ──────────────────────────── */}
        <div className="flex-1 min-w-0 bg-v2-surface border border-v2-border rounded-v2-lg flex flex-col">
          {/* Inner scroll layer — separate from border/radius container */}
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

function SidebarSurface({ isExpanded }: { isExpanded: boolean }) {
  return (
    <div
      className={`
        shrink-0 rounded-v2-lg
        flex flex-col overflow-hidden
        transition-[width] duration-200 ease-out
        ${isExpanded ? 'w-v2-sidebar' : 'w-v2-sidebar-sm'}
      `}
      style={{
        zIndex: 20,
        position: 'sticky',
        top: STICKY_TOP,
        height: PANEL_HEIGHT,
        background: 'linear-gradient(180deg, #27272a 0%, #18181b 100%)',
        borderRight: '1px solid rgba(255, 255, 255, 0.06)',
        boxShadow: 'inset -1px 0 0 rgba(255, 255, 255, 0.04)',
      }}
    >
      <SidebarV2 />
    </div>
  )
}

// ── Action Panel Surface ────────────────────────────────────────────────────

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
      className="w-v2-panel shrink-0 rounded-v2-lg flex flex-col overflow-hidden"
      style={{
        zIndex: 20,
        position: 'sticky',
        top: STICKY_TOP,
        height: PANEL_HEIGHT,
        background: 'linear-gradient(180deg, #27272a 0%, #18181b 100%)',
        borderRight: '1px solid rgba(255, 255, 255, 0.06)',
        boxShadow: 'inset -1px 0 0 rgba(255, 255, 255, 0.04)',
      }}
    >
      {/* Inner scroll layer */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Panel header with back button — shell text hierarchy */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-ds-sm text-v2-shell-text
                     hover:text-white mb-4 transition-colors duration-150"
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
