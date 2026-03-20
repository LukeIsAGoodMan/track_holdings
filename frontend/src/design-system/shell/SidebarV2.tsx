/**
 * SidebarV2 — Workflow-driven navigation sidebar.
 *
 * Design language: Wealthsimple extraction
 * Container layering: NOT flat — nav groups in distinct sections
 * Active state: bg-accent-soft + left indicator bar + accent text
 * Bottom section: workflow actions + collapse toggle, separated from nav
 *
 * Structure:
 *   ┌─────────────────────┐
 *   │ Nav Section          │  ← flex-1, scrollable
 *   │   Group: Portfolio   │
 *   │     Holdings         │
 *   │     Risk             │
 *   │   ─── divider ───    │
 *   │   Group: Strategy    │
 *   │     Opportunities    │
 *   │     Analysis         │
 *   │   ─── divider ───    │
 *   │   Portfolios tree    │
 *   ├─────────────────────┤
 *   │ Actions (New Trade)  │  ← fixed bottom
 *   │ Collapse toggle      │
 *   └─────────────────────┘
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useLanguage }   from '@/context/LanguageContext'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useSidebar }    from '@/context/SidebarContext'
import { interactiveClasses } from '../interaction'

// ── Inline SVG icons (Lucide-style, 20×20, strokeWidth 1.75) ───────────────

const icons = {
  holdings: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  risk: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 8v4" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  ),
  opportunities: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  ),
  analysis: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12V2" /><path d="M12 12l7.07-7.07" />
      <path d="M16 8h6V2" />
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
}

// ── Nav group configs ───────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    key: 'portfolio',
    en: 'Portfolio',
    zh: '投资组合',
    items: [
      { key: 'holdings', to: '/holdings', icon: icons.holdings, en: 'Holdings', zh: '持仓' },
      { key: 'risk',     to: '/risk',     icon: icons.risk,     en: 'Risk',     zh: '风险' },
    ],
  },
  {
    key: 'strategy',
    en: 'Strategy',
    zh: '策略',
    items: [
      { key: 'opportunities', to: '/opportunities', icon: icons.opportunities, en: 'Opportunities', zh: '机会' },
      { key: 'analysis',      to: '/analysis',      icon: icons.analysis,      en: 'Analysis',      zh: '分析' },
    ],
  },
] as const

// ── Tooltip (collapsed mode) ────────────────────────────────────────────────

function Tooltip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null
  return (
    <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2
                     bg-v2-text-1 text-white text-ds-sm
                     px-2.5 py-1 rounded-v2-sm whitespace-nowrap
                     pointer-events-none shadow-v2-md
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          style={{ zIndex: 40 }}>
      {label}
    </span>
  )
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SidebarV2() {
  const { lang }     = useLanguage()
  const location     = useLocation()
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const { isExpanded, toggleExpand, openTradeEntry, openPriceAlerts } = useSidebar()

  const isEn = lang === 'en'

  return (
    <aside
      className={`
        shrink-0 bg-v2-surface h-[calc(100vh-3.5rem)] sticky top-14
        flex flex-col border-r border-v2-border overflow-hidden
        transition-[width] duration-200 ease-out
        ${isExpanded ? 'w-v2-sidebar' : 'w-v2-sidebar-sm'}
      `}
      style={{ zIndex: 20 }}
    >
      {/* ═══ Navigation Section (scrollable) ═══════════════════════════ */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.key} className={gi > 0 ? 'mt-4' : ''}>
            {/* Group divider */}
            {gi > 0 && <div className="mb-3 mx-2 border-t border-v2-border" />}

            {/* Group label — expanded only */}
            {isExpanded && (
              <div className="text-ds-caption uppercase text-v2-text-3 px-3 mb-2">
                {isEn ? group.en : group.zh}
              </div>
            )}

            {/* Nav items container */}
            <div className="space-y-0.5">
              {group.items.map(({ key, to, icon, en, zh }) => {
                const isActive = location.pathname.startsWith(to)
                const label = isEn ? en : zh
                const navClasses = interactiveClasses({
                  variant: 'nav-item',
                  selected: isActive,
                })

                return (
                  <NavLink
                    key={key}
                    to={to}
                    className={`
                      flex items-center gap-3 rounded-v2-md
                      text-ds-body-r group relative
                      ${navClasses}
                      ${isExpanded ? 'px-3 py-2.5' : 'justify-center py-2.5 px-0'}
                    `}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-v2-accent rounded-r-full" />
                    )}
                    <span className="shrink-0">{icon}</span>
                    {isExpanded ? (
                      <span className="truncate">{label}</span>
                    ) : (
                      <Tooltip label={label} show />
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}

        {/* ═══ Portfolio Context ═══════════════════════════════════════ */}
        {isExpanded && (
          <div className="mt-4 pt-3 border-t border-v2-border">
            <div className="text-ds-caption uppercase text-v2-text-3 px-3 mb-2">
              {isEn ? 'Portfolios' : '投资组合'}
            </div>
            <div className="space-y-0.5 max-h-44 overflow-y-auto">
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
                <div className="text-ds-sm text-v2-text-3 px-3 py-2 italic">
                  {isEn ? 'No portfolios' : '暂无组合'}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ═══ Bottom Actions Section (fixed) ═════════════════════════ */}
      <div className={`border-t border-v2-border ${isExpanded ? 'p-3' : 'p-2'} space-y-1`}>
        <button
          onClick={() => openTradeEntry()}
          className={`
            flex items-center gap-2.5 w-full rounded-v2-md
            text-v2-accent group relative
            ${interactiveClasses({ variant: 'button-ghost' })}
            ${isExpanded ? 'px-3 py-2 text-ds-body-r' : 'justify-center py-2.5'}
          `}
        >
          {icons.trade}
          {isExpanded ? (
            <span>{isEn ? 'New Trade' : '新建交易'}</span>
          ) : (
            <Tooltip label={isEn ? 'New Trade' : '新建交易'} show />
          )}
        </button>
        <button
          onClick={() => openPriceAlerts()}
          className={`
            flex items-center gap-2.5 w-full rounded-v2-md
            text-v2-text-2 group relative
            ${interactiveClasses({ variant: 'button-ghost' })}
            ${isExpanded ? 'px-3 py-2 text-ds-body-r' : 'justify-center py-2.5'}
          `}
        >
          {icons.alerts}
          {isExpanded ? (
            <span>{isEn ? 'Alerts' : '警报'}</span>
          ) : (
            <Tooltip label={isEn ? 'Alerts' : '警报'} show />
          )}
        </button>
      </div>

      {/* ═══ Collapse Toggle ═══════════════════════════════════════════ */}
      <div className="border-t border-v2-border p-2">
        <button
          onClick={toggleExpand}
          className={`flex items-center justify-center w-full py-2 rounded-v2-sm
                     text-v2-text-3 ${interactiveClasses({ variant: 'button-ghost' })}`}
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

// ── Portfolio tree item ─────────────────────────────────────────────────────

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
          flex items-center gap-2 w-full rounded-v2-sm text-left text-ds-sm
          py-1.5 transition-colors duration-150
          ${isSelected
            ? 'bg-v2-accent-soft text-v2-accent'
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
