/**
 * SidebarV2 — Mercury-style navigation + portfolio context + workflow actions.
 *
 * Responsive hierarchy:
 *   xl+     → full expanded sidebar (240px)
 *   md–xl   → compact icon rail (64px)
 *   <md     → hidden (drawer overlay via mobile toggle)
 *
 * Sections:
 *   1. Primary Navigation (Holdings, Risk, Opportunities, Analysis)
 *   2. Portfolio Context Zone (selector, folder tree)
 *   3. Workflow Actions (New Trade, Alerts)
 *
 * Extensible: future sections (AI, automation, alerts) plug in as NavSection entries.
 *
 * Consumes existing SidebarContext for state (mode, expanded, action panels).
 * Does NOT modify business logic — visual layer only.
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useLanguage }   from '@/context/LanguageContext'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useSidebar }    from '@/context/SidebarContext'

// ── Inline SVG icons (Lucide-style, 20×20) ──────────────────────────────────

const icons = {
  holdings: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 6-6" />
    </svg>
  ),
  risk: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" /><path d="M12 17h.01" />
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
  opportunities: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 000 20 14.5 14.5 0 000-20" /><path d="M2 12h20" />
    </svg>
  ),
  analysis: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 21H4.6c-.6 0-.9 0-1.1-.1a1 1 0 01-.4-.4C3 20.3 3 20 3 19.4V3" />
      <path d="M7 14l4-4 4 4 6-6" />
    </svg>
  ),
  trade: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  alerts: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  folder: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
  portfolio: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
    </svg>
  ),
  chevronDown: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none">
      <path d="M2 4.5L6 8l4-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

// ── Nav items config ─────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { key: 'holdings',      to: '/holdings',      icon: icons.holdings,      en: 'Holdings',      zh: '持仓' },
  { key: 'risk',          to: '/risk',           icon: icons.risk,          en: 'Risk',          zh: '风险' },
  { key: 'opportunities', to: '/opportunities',  icon: icons.opportunities, en: 'Opportunities', zh: '机会' },
  { key: 'analysis',      to: '/analysis',       icon: icons.analysis,      en: 'Analysis',      zh: '分析' },
] as const

// ── Component ────────────────────────────────────────────────────────────────

export default function SidebarV2() {
  const { lang }     = useLanguage()
  const location     = useLocation()
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const { isExpanded, toggleExpand, openTradeEntry, openPriceAlerts } = useSidebar()

  // Responsive: on smaller screens show only icon rail
  // The parent shell handles md breakpoint via CSS

  const isEn = lang === 'en'

  return (
    <aside
      className={`
        shrink-0 bg-v2-surface h-[calc(100vh-3.5rem)] sticky top-14
        flex flex-col transition-all duration-200 ease-out
        border-r border-v2-border-sub overflow-hidden
        ${isExpanded ? 'w-v2-sidebar' : 'w-v2-sidebar-sm'}
      `}
    >
      {/* ── Section 1: Primary Navigation ──────────────────────────── */}
      <nav className="flex-1 pt-3 px-2 space-y-0.5">
        <div className="mb-3">
          {!isExpanded ? null : (
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-v2-text-3 px-3 mb-2">
              {isEn ? 'Navigation' : '导航'}
            </div>
          )}
          {NAV_ITEMS.map(({ key, to, icon, en, zh }) => {
            const isActive = location.pathname.startsWith(to)
            return (
              <NavLink
                key={key}
                to={to}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-v2-md
                  text-[13px] font-medium transition-all duration-150
                  group relative
                  ${isActive
                    ? 'bg-v2-accent-soft text-v2-accent'
                    : 'text-v2-text-2 hover:bg-v2-surface-alt hover:text-v2-text-1'
                  }
                `}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-v2-accent rounded-r-full" />
                )}
                <span className="shrink-0">{icon}</span>
                {isExpanded && (
                  <span className="truncate">{isEn ? en : zh}</span>
                )}
              </NavLink>
            )
          })}
        </div>

        {/* ── Section 2: Portfolio Context ────────────────────────────── */}
        {isExpanded && (
          <div className="pt-3 border-t border-v2-border-sub">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-v2-text-3 px-3 mb-2">
              {isEn ? 'Portfolios' : '投资组合'}
            </div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {portfolios.map((p) => (
                <PortfolioItem
                  key={p.id}
                  portfolio={p}
                  selectedId={selectedPortfolioId}
                  onSelect={setSelectedPortfolioId}
                  depth={0}
                />
              ))}
              {portfolios.length === 0 && (
                <div className="text-xs text-v2-text-3 px-3 py-2 italic">
                  {isEn ? 'No portfolios' : '暂无组合'}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ── Section 3: Workflow Actions ────────────────────────────── */}
      <div className={`border-t border-v2-border-sub ${isExpanded ? 'p-3' : 'p-2'} space-y-1`}>
        <button
          onClick={() => openTradeEntry()}
          className={`
            flex items-center gap-2.5 w-full rounded-v2-md transition-colors
            text-v2-accent hover:bg-v2-accent-soft
            ${isExpanded ? 'px-3 py-2 text-[13px] font-medium' : 'justify-center py-2.5'}
          `}
        >
          {icons.trade}
          {isExpanded && <span>{isEn ? 'New Trade' : '新建交易'}</span>}
        </button>
        <button
          onClick={() => openPriceAlerts()}
          className={`
            flex items-center gap-2.5 w-full rounded-v2-md transition-colors
            text-v2-text-2 hover:bg-v2-surface-alt hover:text-v2-text-1
            ${isExpanded ? 'px-3 py-2 text-[13px] font-medium' : 'justify-center py-2.5'}
          `}
        >
          {icons.alerts}
          {isExpanded && <span>{isEn ? 'Alerts' : '警报'}</span>}
        </button>
      </div>

      {/* ── Collapse toggle ───────────────────────────────────────── */}
      <div className="border-t border-v2-border-sub p-2">
        <button
          onClick={toggleExpand}
          className="flex items-center justify-center w-full py-2 rounded-v2-sm
                     text-v2-text-3 hover:bg-v2-surface-alt hover:text-v2-text-1 transition-colors"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? '' : 'rotate-180'}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
    </aside>
  )
}

// ── Portfolio tree item ──────────────────────────────────────────────────────

interface PortfolioItemProps {
  portfolio: { id: number; name: string; is_folder: boolean; children: PortfolioItemProps['portfolio'][] }
  selectedId: number | null
  onSelect: (id: number | null) => void
  depth: number
}

function PortfolioItem({ portfolio, selectedId, onSelect, depth }: PortfolioItemProps) {
  const isSelected = portfolio.id === selectedId
  const pl = depth * 12

  return (
    <>
      <button
        onClick={() => onSelect(portfolio.id)}
        className={`
          flex items-center gap-2 w-full rounded-v2-sm text-left text-[12px]
          py-1.5 transition-colors
          ${isSelected
            ? 'bg-v2-accent-soft text-v2-accent font-semibold'
            : 'text-v2-text-2 hover:bg-v2-surface-alt'
          }
        `}
        style={{ paddingLeft: `${12 + pl}px` }}
      >
        <span className="shrink-0 opacity-60">
          {portfolio.is_folder ? icons.folder : icons.portfolio}
        </span>
        <span className="truncate">{portfolio.name}</span>
      </button>
      {portfolio.children?.map((child) => (
        <PortfolioItem
          key={child.id}
          portfolio={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  )
}
