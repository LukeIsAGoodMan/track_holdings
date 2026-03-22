/**
 * AppShellV2 — Transformer Sidebar (Monolith Shell).
 *
 * ONE sidebar surface that morphs between two states:
 *   Nav mode:    240px (or 64px collapsed) — portfolio tree + actions
 *   Action mode: 520px — trade entry / alerts / portfolio management
 *
 * The sidebar IS the shell. No separate ActionPanel.
 * Main content margin-left adapts dynamically with ds-motion (220ms).
 * The warm silver gradient flows across the entire surface as one piece.
 */
import { Outlet } from 'react-router-dom'
import SidebarV2     from './SidebarV2'
import PageContainer from './PageContainer'

import { useSidebar }    from '@/context/SidebarContext'
import { useLanguage }   from '@/context/LanguageContext'
import TradeEntryForm    from '@/components/TradeEntryForm'
import PriceAlertsSidebar from '@/components/PriceAlertsSidebar'
import { PortfolioCreatePanel, PortfolioEditPanel } from './PortfolioPanels'

/** Shell surface — warm silver aluminum, single gradient */
const SHELL_BG = [
  'radial-gradient(90% 50% at 20% 0%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.00) 60%)',
  'linear-gradient(180deg, #cfcbc7 0%, #c4bfba 42%, #b9b4af 100%)',
].join(', ')

const SHELL_STYLE = {
  backgroundImage: SHELL_BG,
  borderTopRightRadius: '14px',
  borderBottomRightRadius: '14px',
  boxShadow: '1px 0 0 rgba(0,0,0,0.02), 4px 0 16px -10px rgba(0,0,0,0.06), inset -1px 0 0 rgba(255,255,255,0.05)',
} as const

export default function AppShellV2() {
  const { mode, isExpanded } = useSidebar()
  const isActionOpen = mode !== 'nav'

  // Transformer width: nav mode vs action mode
  const sidebarWidth = isActionOpen ? 520 : (isExpanded ? 240 : 64)

  return (
    <div className="min-h-screen bg-v2-bg">
      {/* ═══ THE SIDEBAR — one monolith shell ═══════════════════ */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          position: 'fixed', left: 0, top: 0, height: '100vh', zIndex: 20,
          width: `${sidebarWidth}px`,
          transition: 'width 220ms ease-out',
          ...SHELL_STYLE,
        }}
      >
        {isActionOpen ? (
          <ActionContent />
        ) : (
          <SidebarV2 />
        )}
      </div>

      {/* ═══ Main content — margin tracks sidebar width ════════ */}
      <div
        className="min-h-screen p-4"
        style={{
          marginLeft: `${sidebarWidth}px`,
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

// ── Action Content (rendered inside the expanded sidebar) ────────────────────

function ActionContent() {
  const {
    mode, pendingClose, alertPrefill, editTarget,
    exitTradeEntry, exitPriceAlerts,
    exitPortfolioCreate, exitPortfolioEdit,
    openPortfolioCreate,
  } = useSidebar()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const handleBack = () => {
    if (mode === 'trade_entry') exitTradeEntry()
    else if (mode === 'price_alerts') exitPriceAlerts()
    else if (mode === 'portfolio_create') exitPortfolioCreate()
    else if (mode === 'portfolio_edit') exitPortfolioEdit()
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Back button — always visible at top */}
      <div className="px-4 pt-4 pb-2">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 ds-color">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {isEn ? 'Back to Portfolio' : '返回组合'}
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'trade_entry' && (
          <div className="px-4 pb-4">
            <TradeEntryForm closeState={pendingClose} onSuccess={exitTradeEntry} />
          </div>
        )}
        {mode === 'price_alerts' && (
          <div className="px-4 pb-4">
            <PriceAlertsSidebar prefill={alertPrefill} />
          </div>
        )}
        {mode === 'portfolio_create' && (
          <PortfolioCreatePanel onBack={exitPortfolioCreate} />
        )}
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
