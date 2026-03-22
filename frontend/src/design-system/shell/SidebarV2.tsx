/**
 * SidebarV2 — Dark metallic command center.
 *
 * Typography system:
 *   Section labels: text-xs, uppercase, opacity ~0.5
 *   Nav items: ~14px, font-medium (NOT bold)
 *   Active: color + bg emphasis (NO font weight change)
 *   User: text-sm name, text-xs logout
 *   Icons: 18px (w-[18px] h-[18px])
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useLanguage }   from '@/context/LanguageContext'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useSidebar }    from '@/context/SidebarContext'
import { useAuth }       from '@/context/AuthContext'

// ── Icons (18px) ────────────────────────────────────────────────────────────

const IC = 'w-[18px] h-[18px]'

const icons = {
  holdings: (
    <svg className={IC} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  risk: (
    <svg className={IC} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 8v4" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  ),
  opportunities: (
    <svg className={IC} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  ),
  analysis: (
    <svg className={IC} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12V2" /><path d="M12 12l7.07-7.07" />
      <path d="M16 8h6V2" />
    </svg>
  ),
  plus: (
    <svg className={IC} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  bell: (
    <svg className={IC} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  folderPlus: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  ),
  folder: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
  briefcase: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
    </svg>
  ),
  bolt: (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
}

const NAV_ITEMS = [
  { key: 'holdings',      to: '/holdings',      icon: icons.holdings,      en: 'Holdings',      zh: '持仓' },
  { key: 'risk',          to: '/risk',          icon: icons.risk,          en: 'Risk',          zh: '风险' },
  { key: 'opportunities', to: '/opportunities', icon: icons.opportunities, en: 'Opportunities', zh: '机会' },
  { key: 'analysis',      to: '/analysis',      icon: icons.analysis,      en: 'Analysis',      zh: '分析' },
] as const

function Tooltip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null
  return (
    <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2
                     bg-gray-800 text-white text-xs
                     px-2.5 py-1 rounded-v2-sm whitespace-nowrap
                     pointer-events-none
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          style={{ zIndex: 40 }}>
      {label}
    </span>
  )
}

export default function SidebarV2() {
  const { lang }     = useLanguage()
  const location     = useLocation()
  const { user, logout } = useAuth()
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const { isExpanded, toggleExpand, openTradeEntry, openPriceAlerts, openPortfolioCreate } = useSidebar()

  const isEn = lang === 'en'

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ═══ PRIMARY ACTIONS ════════════════════════════════════ */}
      <div className={`${isExpanded ? 'px-3 pt-4 pb-2' : 'px-2 pt-3 pb-2'} space-y-1`}>
        <button
          onClick={() => openTradeEntry()}
          className={`flex items-center gap-2.5 w-full rounded-v2-md text-sm font-medium
            text-gray-500 hover:text-gray-700 hover:bg-gray-500/8 transition-colors duration-150 group relative
            ${isExpanded ? 'px-3 py-2' : 'justify-center py-2'}`}
        >
          {icons.plus}
          {isExpanded ? <span>{isEn ? 'New Trade' : '新建交易'}</span> : <Tooltip label={isEn ? 'New Trade' : '新建交易'} show />}
        </button>
        <button
          onClick={() => openPortfolioCreate()}
          className={`flex items-center gap-2.5 w-full rounded-v2-md text-sm font-medium
            text-gray-500 hover:text-gray-700 hover:bg-gray-500/8 transition-colors duration-150 group relative
            ${isExpanded ? 'px-3 py-2' : 'justify-center py-2'}`}
        >
          {icons.folderPlus}
          {isExpanded ? <span>{isEn ? 'New Portfolio' : '新建组合'}</span> : <Tooltip label={isEn ? 'New Portfolio' : '新建组合'} show />}
        </button>
        <button
          onClick={() => openPriceAlerts()}
          className={`flex items-center gap-2.5 w-full rounded-v2-md text-sm font-medium
            text-gray-500 hover:text-gray-700 hover:bg-gray-500/8 transition-colors duration-150 group relative
            ${isExpanded ? 'px-3 py-2' : 'justify-center py-2'}`}
        >
          {icons.bell}
          {isExpanded ? <span>{isEn ? 'Alerts' : '警报'}</span> : <Tooltip label={isEn ? 'Alerts' : '警报'} show />}
        </button>
      </div>

      {/* ═══ NAVIGATION ══════════════════════════════════════════ */}
      <nav className="flex-1 px-2 py-1 overflow-y-auto">
        <div className="border-t border-gray-400/15 mb-4" />

        {isExpanded && (
          <div className="text-xs uppercase text-gray-400 px-3 mb-3 tracking-wider">
            {isEn ? 'Navigate' : '导航'}
          </div>
        )}

        <div className="space-y-1">
          {NAV_ITEMS.map(({ key, to, icon, en, zh }) => {
            const isActive = location.pathname.startsWith(to)
            const label = isEn ? en : zh
            return (
              <NavLink
                key={key}
                to={to}
                className={`
                  flex items-center gap-3 rounded-v2-md group relative
                  text-sm font-medium transition-colors duration-150
                  ${isExpanded ? 'px-3 py-2.5' : 'justify-center py-2.5 px-0'}
                  ${isActive
                    ? 'bg-gray-500/12 text-gray-800'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-500/8'
                  }
                `}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-gray-700 rounded-r-full" />
                )}
                <span className="shrink-0">{icon}</span>
                {isExpanded ? <span className="truncate">{label}</span> : <Tooltip label={label} show />}
              </NavLink>
            )
          })}
        </div>

        {/* ═══ PORTFOLIOS ════════════════════════════════════════ */}
        {isExpanded && (
          <div className="mt-5 pt-3 border-t border-gray-400/15">
            <div className="text-xs uppercase text-gray-400 px-3 mb-3 tracking-wider">
              {isEn ? 'Portfolios' : '投资组合'}
            </div>
            <div className="space-y-0.5 max-h-44 overflow-y-auto">
              {portfolios.map((p) => (
                <PortfolioItem key={p.id} portfolio={p} selectedId={selectedPortfolioId} onSelect={setSelectedPortfolioId} depth={0} />
              ))}
              {portfolios.length === 0 && (
                <div className="text-xs text-gray-400 px-3 py-2 italic">
                  {isEn ? 'No portfolios' : '暂无组合'}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ═══ USER — refined, compact ═════════════════════════════ */}
      <div className={`border-t border-gray-400/15 ${isExpanded ? 'px-3 py-3' : 'px-2 py-2'}`}>
        {user ? (
          <div className={`flex ${isExpanded ? 'items-center gap-3' : 'flex-col items-center gap-2'}`}>
            <div className="w-7 h-7 rounded-full bg-gray-500/10 flex items-center justify-center
                            text-xs text-gray-600 uppercase shrink-0">
              {user.username.charAt(0)}
            </div>
            {isExpanded && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-600 truncate">{user.username}</div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-500 transition-colors duration-150 mt-0.5"
                >
                  {icons.bolt}
                  <span>{isEn ? 'Logout' : '退出'}</span>
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* Collapse */}
        <button
          onClick={toggleExpand}
          className={`flex items-center justify-center w-full py-1.5 rounded-v2-sm
                     text-gray-400 hover:text-gray-500 hover:bg-gray-500/8
                     transition-colors duration-150 ${user ? 'mt-2' : ''}`}
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? '' : 'rotate-180'}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
    </div>
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
          flex items-center gap-2 w-full rounded-v2-sm text-left text-xs font-medium
          py-1.5 transition-colors duration-150
          ${isSelected
            ? 'bg-gray-500/12 text-gray-800'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-500/8'
          }
        `}
        style={{ paddingLeft: `${12 + pl}px` }}
      >
        <span className="shrink-0 opacity-50">
          {portfolio.is_folder ? icons.folder : icons.briefcase}
        </span>
        <span className="truncate">{portfolio.name}</span>
      </button>
      {portfolio.children?.map((child) => (
        <PortfolioItem key={child.id} portfolio={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </>
  )
}
