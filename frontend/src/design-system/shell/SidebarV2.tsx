/**
 * SidebarV2 — Single shell control panel.
 *
 * Structure (top → bottom, spacing-only separation):
 *   Brand (BibiFin)
 *   ···
 *   Primary Actions (New Trade / Portfolio / Alerts)
 *   ···
 *   Navigation (Holdings / Risk / Opportunities / Analysis)
 *   ···
 *   Portfolio Tree
 *   ···
 *   User (avatar + name + logout)
 *   Status (Live ●)
 *   Language (EN / 中)
 *   Collapse toggle
 *
 * No divider lines between major zones.
 * Generous vertical rhythm creates separation.
 * Text: warm stone engraved into metal.
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useLanguage }   from '@/context/LanguageContext'
import { usePortfolio }  from '@/context/PortfolioContext'
import { useSidebar }    from '@/context/SidebarContext'
import { useAuth }       from '@/context/AuthContext'
import { useWebSocket }  from '@/context/WebSocketContext'

// ── Icons ───────────────────────────────────────────────────────────────────

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

/** Engraved text styles */
const eng = { color: '#44403c', textShadow: '0 0.5px 0 rgba(255,255,255,0.12)' } as const

function Tooltip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null
  return (
    <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2
                     bg-stone-800 text-white text-xs
                     px-2.5 py-1 rounded-v2-sm whitespace-nowrap pointer-events-none
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          style={{ zIndex: 40 }}>
      {label}
    </span>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SidebarV2() {
  const { lang, toggle: toggleLang } = useLanguage()
  const location     = useLocation()
  const { user, logout } = useAuth()
  const { socketState, connected } = useWebSocket()
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const { isExpanded, toggleExpand, openTradeEntry, openPriceAlerts, openPortfolioCreate, openPortfolioEdit } = useSidebar()

  const isEn = lang === 'en'
  const isLive = socketState === 'ready'
  const isReconnecting = socketState === 'reconnecting' || socketState === 'connecting'
  const statusColor = isLive ? 'bg-v2-positive' : isReconnecting ? 'bg-v2-caution' : 'bg-v2-negative'

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ═══ BRAND ════════════════════════════════════════════════ */}
      <div className={`${isExpanded ? 'px-4 pt-5 pb-6' : 'px-2 pt-4 pb-5'} flex items-center ${isExpanded ? 'gap-2' : 'justify-center'}`}>
        <div className="flex items-center justify-center shrink-0" style={{ width: '20px', height: '28px', color: 'rgba(68,64,60,0.7)' }}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.65" />
            <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
          </svg>
        </div>
        {isExpanded && (
          <span className="font-semibold hidden sm:inline" style={{ fontSize: '20px', letterSpacing: '-0.02em', lineHeight: '1', ...eng }}>
            BibiFin
          </span>
        )}
      </div>

      {/* ═══ PRIMARY ACTIONS ══════════════════════════════════════ */}
      <div className={`${isExpanded ? 'px-3 pb-2' : 'px-2 pb-2'} space-y-1`}>
        {[
          { onClick: () => openTradeEntry(), icon: icons.plus, en: 'New Trade', zh: '新建交易' },
          { onClick: () => openPortfolioCreate(), icon: icons.folderPlus, en: 'New Portfolio', zh: '新建组合' },
          { onClick: () => openPriceAlerts(), icon: icons.bell, en: 'Alerts', zh: '警报' },
        ].map(({ onClick, icon, en, zh }) => (
          <button
            key={en}
            onClick={onClick}
            className={`flex items-center gap-2.5 w-full rounded-v2-md text-sm font-medium
              text-stone-500 hover:text-stone-700 hover:bg-stone-500/8 ds-interact group relative
              ${isExpanded ? 'px-3 py-2' : 'justify-center py-2'}`}
          >
            {icon}
            {isExpanded ? <span>{isEn ? en : zh}</span> : <Tooltip label={isEn ? en : zh} show />}
          </button>
        ))}
      </div>

      {/* ═══ NAVIGATION ══════════════════════════════════════════ */}
      <nav className="flex-1 px-2 pt-4 overflow-y-auto">
        {isExpanded && (
          <div className="text-xs uppercase text-stone-400 px-3 mb-3 tracking-wider">
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
                  text-sm font-medium ds-interact
                  ${isExpanded ? 'px-3 py-2.5' : 'justify-center py-2.5 px-0'}
                  ${isActive
                    ? 'bg-stone-500/12 text-stone-800'
                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-500/8'
                  }
                `}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-stone-700 rounded-r-full" />
                )}
                <span className="shrink-0">{icon}</span>
                {isExpanded ? <span className="truncate">{label}</span> : <Tooltip label={label} show />}
              </NavLink>
            )
          })}
        </div>

        {/* ═══ PORTFOLIOS ═══════════════════════════════════════ */}
        {isExpanded && (
          <div className="mt-6">
            <div className="text-xs uppercase text-stone-400 px-3 mb-3 tracking-wider">
              {isEn ? 'Portfolios' : '投资组合'}
            </div>
            <div className="space-y-0.5 max-h-44 overflow-y-auto">
              {portfolios.map((p) => (
                <PortfolioItem key={p.id} portfolio={p} selectedId={selectedPortfolioId} onSelect={setSelectedPortfolioId} onEdit={openPortfolioEdit} depth={0} />
              ))}
              {portfolios.length === 0 && (
                <div className="text-xs text-stone-400 px-3 py-2 italic">
                  {isEn ? 'No portfolios' : '暂无组合'}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* ═══ BOTTOM — anchored, anti-aliased, two-layer ══════════ */}
      <div
        className={`mt-auto ${isExpanded ? 'px-3 pb-3 pt-4' : 'px-2 pb-2 pt-3'} space-y-3`}
        style={{
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          background: 'inherit',
          position: 'relative',
          zIndex: 2,
        } as React.CSSProperties}
      >
        {/* Occlusion fade — subtle top edge so scrolling nav doesn't bleed */}
        <div
          className="absolute top-0 left-0 right-0 pointer-events-none"
          style={{
            height: '16px',
            marginTop: '-16px',
            background: 'linear-gradient(to top, inherit, transparent)',
          }}
        />

        {/* ── Identity layer: user + live ─────────────────────── */}
        {isExpanded ? (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {user && <span className="text-stone-600 font-medium truncate max-w-[120px]">{user.username}</span>}
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} style={{ opacity: 0.8 }} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {user && (
              <div className="w-7 h-7 rounded-full bg-stone-500/10 flex items-center justify-center
                              text-xs text-stone-600 uppercase shrink-0">
                {user.username.charAt(0)}
              </div>
            )}
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} style={{ opacity: 0.8 }} />
          </div>
        )}

        {/* ── Control layer: language + logout + collapse ─────── */}
        {isExpanded ? (
          <div className="flex items-center justify-between text-sm text-stone-500">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleLang}
                className="ds-color hover:text-stone-700 cursor-pointer"
                style={{ fontSize: '12px' }}
              >
                <span className={lang === 'en' ? 'text-stone-600' : ''}>EN</span>
                <span className="text-stone-300 mx-0.5">/</span>
                <span className={lang === 'zh' ? 'text-stone-600' : ''}>中</span>
              </button>
              {user && (
                <button
                  onClick={logout}
                  className="ds-color hover:text-stone-700 cursor-pointer"
                  style={{ fontSize: '12px' }}
                >
                  {isEn ? 'Logout' : '退出'}
                </button>
              )}
            </div>

            {/* Collapse — 32px hit area, mechanical */}
            <button
              onClick={toggleExpand}
              className="w-8 h-8 flex items-center justify-center rounded-md
                         ds-bg hover:bg-black/5"
              aria-label="Collapse sidebar"
            >
              <svg
                className={`w-[18px] h-[18px] text-stone-500 ds-rotate ${isExpanded ? '' : 'rotate-180'}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        ) : (
          /* Collapsed: just the arrow */
          <button
            onClick={toggleExpand}
            className="w-8 h-8 mx-auto flex items-center justify-center rounded-md
                       ds-bg hover:bg-black/5"
            aria-label="Expand sidebar"
          >
            <svg
              className={`w-[18px] h-[18px] text-stone-500 ds-rotate rotate-180`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Portfolio tree item ─────────────────────────────────────────────────────

interface PortfolioItemProps {
  portfolio: { id: number; name: string; is_folder: boolean; children: PortfolioItemProps['portfolio'][] }
  selectedId: number | null
  onSelect: (id: number | null) => void
  onEdit: (node: any) => void
  depth: number
}

function PortfolioItem({ portfolio, selectedId, onSelect, onEdit, depth }: PortfolioItemProps) {
  const isSelected = portfolio.id === selectedId
  const pl = depth * 12

  return (
    <>
      <div className="group relative">
        <button
          onClick={() => onSelect(portfolio.id)}
          className={`
            flex items-center gap-2 w-full rounded-v2-sm text-left text-xs font-medium
            py-1.5 ds-interact pr-7
            ${isSelected
              ? 'bg-stone-500/12 text-stone-800'
              : 'text-stone-400 hover:text-stone-600 hover:bg-stone-500/8'
            }
          `}
          style={{ paddingLeft: `${12 + pl}px` }}
        >
          <span className="shrink-0 opacity-50">
            {portfolio.is_folder ? icons.folder : icons.briefcase}
          </span>
          <span className="truncate">{portfolio.name}</span>
        </button>
        {/* Action button — always subtly visible, elevates on row hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(portfolio) }}
          className="absolute right-1 top-1/2 -translate-y-1/2
                     w-6 h-6 flex items-center justify-center rounded
                     text-stone-400 hover:text-stone-700 hover:bg-stone-500/10
                     opacity-35 group-hover:opacity-100 ds-fade"
          title="Edit"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
      </div>
      {portfolio.children?.map((child) => (
        <PortfolioItem key={child.id} portfolio={child} selectedId={selectedId} onSelect={onSelect} onEdit={onEdit} depth={depth + 1} />
      ))}
    </>
  )
}
