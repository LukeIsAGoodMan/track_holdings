/**
 * Sidebar — dual-mode panel.
 *
 * Mode: 'nav'
 *   collapsed  (w-16 / 64px)  — icon-only nav + portfolio initials
 *   expanded   (w-56 / 224px) — nav links + portfolio tree + "New Trade"
 *
 * Mode: 'trade_entry'
 *   always     (w-72 / 288px) — compact trade form with back button
 *
 * Width animates via transition-[width] duration-200.
 */
import { NavLink } from 'react-router-dom'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useSidebar }   from '@/context/SidebarContext'
import TradeEntryForm   from '@/components/TradeEntryForm'
import { fmtCompact }   from '@/utils/format'
import type { Portfolio } from '@/types'

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconHoldings = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

const IconRisk = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
    <path d="M12 3l8 4v5c0 4.5-3.5 8.5-8 9.5C7.5 20.5 4 16.5 4 12V7l8-4z" />
    <path d="M12 9v4M12 16h.01" strokeLinecap="round" />
  </svg>
)

const IconScan = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    <path d="M12 6a6 6 0 0 1 6 6"    strokeLinecap="round" />
    <path d="M12 10a2 2 0 0 1 2 2"   strokeLinecap="round" />
    <path d="M2 12a10 10 0 0 0 10 10" strokeLinecap="round" />
  </svg>
)

const IconFolder = ({ selected }: { selected?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-primary' : 'text-chrome-muted/60'}`}
    viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
  >
    <path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
  </svg>
)

const IconChevronLeft = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconChevronRight = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconPlus = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
)

// ── Nav items config ───────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/',              end: true,  Icon: IconHoldings, en: 'Holdings',      zh: '持仓' },
  { to: '/risk',          end: false, Icon: IconRisk,     en: 'Risk',          zh: '风险' },
  { to: '/opportunities', end: false, Icon: IconScan,     en: 'Opportunities', zh: '机会' },
]

// ── Portfolio tree node ───────────────────────────────────────────────────────
function PortfolioNode({ node, depth = 0 }: { node: Portfolio; depth?: number }) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isSelected = selectedPortfolioId === node.id

  return (
    <li>
      <button
        onClick={() => setSelectedPortfolioId(node.id)}
        className={[
          'w-full text-left flex items-center gap-2 rounded-lg text-[12.5px]',
          'transition-all duration-150 font-sans px-2.5 py-1.5',
          depth > 0 ? 'ml-3.5' : '',
          isSelected
            ? 'bg-primary/10 text-primary font-semibold'
            : 'text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle',
        ].join(' ')}
        title={node.name}
      >
        <IconFolder selected={isSelected} />
        <span className="flex-1 truncate leading-none">{node.name}</span>
        <span className={`text-[11px] tabular-nums font-medium ${isSelected ? 'text-primary/60' : 'text-chrome-muted/50'}`}>
          {fmtCompact(node.total_cash)}
        </span>
      </button>
      {node.children.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {node.children.map(child => (
            <PortfolioNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ── Collapsed portfolio initials badge ────────────────────────────────────────
function PortfolioBadge() {
  const { portfolios, selectedPortfolioId } = usePortfolio()
  const flat: Portfolio[] = []
  const flatten = (ps: Portfolio[]) => ps.forEach(p => { flat.push(p); flatten(p.children) })
  flatten(portfolios)
  const sel = flat.find(p => p.id === selectedPortfolioId)
  const initials = sel?.name.slice(0, 2).toUpperCase() ?? '—'

  return (
    <div
      title={sel?.name ?? 'No portfolio selected'}
      className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center
                 text-[10px] font-bold text-primary uppercase mx-auto cursor-default"
    >
      {initials}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const { portfolios, loading } = usePortfolio()
  const { lang }               = useLanguage()
  const { mode, isExpanded, pendingClose, openTradeEntry, exitTradeEntry, toggleExpand } = useSidebar()

  const isTradeMode = mode === 'trade_entry'
  const sidebarWidth = isTradeMode ? 288 : isExpanded ? 224 : 64

  return (
    <aside
      className="shrink-0 flex flex-col bg-chrome border-r border-chrome-border
                 sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden
                 transition-[width] duration-200 ease-in-out z-20"
      style={{ width: sidebarWidth }}
    >
      {isTradeMode ? (
        /* ══ TRADE ENTRY MODE ══════════════════════════════════════════════ */
        <>
          {/* Header bar */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-chrome-border shrink-0">
            <button
              onClick={exitTradeEntry}
              title={lang === 'zh' ? '返回导航' : 'Back to nav'}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle
                         transition-colors shrink-0"
            >
              <IconChevronLeft />
            </button>
            <span className="text-[13px] font-semibold text-chrome-text truncate flex-1">
              {lang === 'zh' ? (pendingClose ? '平仓交易' : '新建交易') : (pendingClose ? 'Close Position' : 'New Trade')}
            </span>
          </div>

          {/* Form (scrollable) */}
          <div className="flex-1 overflow-y-auto">
            <TradeEntryForm
              closeState={pendingClose}
              onSuccess={exitTradeEntry}
            />
          </div>
        </>
      ) : (
        /* ══ NAV MODE ═══════════════════════════════════════════════════════ */
        <>
          {/* ── Collapse toggle ─────────────────────────────────────────── */}
          <div className={`flex items-center py-3 border-b border-chrome-border shrink-0
                           ${isExpanded ? 'px-3 justify-between' : 'px-0 justify-center'}`}>
            {isExpanded && (
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-chrome-muted/50 pl-1">
                {lang === 'zh' ? '导航' : 'Navigate'}
              </span>
            )}
            <button
              onClick={toggleExpand}
              title={isExpanded ? (lang === 'zh' ? '折叠' : 'Collapse') : (lang === 'zh' ? '展开' : 'Expand')}
              className="flex items-center justify-center w-7 h-7 rounded-lg
                         text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle
                         transition-colors"
            >
              {isExpanded ? <IconChevronLeft /> : <IconChevronRight />}
            </button>
          </div>

          {/* ── Navigation links ─────────────────────────────────────────── */}
          <nav className="px-2 pt-2 pb-1 space-y-0.5 shrink-0" aria-label="Main navigation">
            {NAV_ITEMS.map(({ to, end, Icon, en, zh }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={!isExpanded ? (lang === 'zh' ? zh : en) : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg transition-all duration-150 font-sans
                   ${isExpanded ? 'px-2.5 py-2' : 'px-0 py-2 justify-center'}
                   ${isActive
                     ? 'bg-primary/10 text-primary'
                     : 'text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle'
                   }`
                }
              >
                <Icon />
                {isExpanded && (
                  <span className="text-[13px] font-medium leading-none">
                    {lang === 'zh' ? zh : en}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* ── Portfolio tree (expanded only) ────────────────────────────── */}
          {isExpanded ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Section label */}
              <div className="px-4 pt-3 pb-1.5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-chrome-muted/50">
                  {lang === 'zh' ? '投资组合' : 'Portfolios'}
                </span>
                <span className="text-[10px] text-chrome-muted/40 tabular-nums">
                  {portfolios.length}
                </span>
              </div>
              <div className="mx-3.5 h-px bg-chrome-border mb-1.5 shrink-0" />

              {/* Tree */}
              <div className="flex-1 px-2 overflow-y-auto">
                {loading ? (
                  <div className="space-y-1.5 px-2 pt-1">
                    {[80, 65, 72].map(w => (
                      <div key={w} className="h-7 rounded-lg bg-chrome-subtle animate-pulse" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : portfolios.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-chrome-muted/50 text-center">
                    {lang === 'zh' ? '暂无组合' : 'No portfolios'}
                  </div>
                ) : (
                  <ul className="space-y-0.5 pb-2">
                    {portfolios.map(p => <PortfolioNode key={p.id} node={p} />)}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            /* Collapsed: show selected portfolio badge */
            <div className="flex-1 flex flex-col items-center py-3 gap-2">
              <div className="w-px flex-1 max-h-4 bg-chrome-border" />
              <PortfolioBadge />
              <div className="w-px flex-1 bg-chrome-border" />
            </div>
          )}

          {/* ── "New Trade" footer button ─────────────────────────────────── */}
          <div className="px-2 py-2 border-t border-chrome-border shrink-0">
            <button
              onClick={() => openTradeEntry()}
              title={lang === 'zh' ? '新建交易' : 'New Trade'}
              className={`w-full flex items-center gap-2 rounded-lg py-2
                          text-[13px] font-semibold text-white bg-primary
                          hover:bg-primary/90 transition-all duration-150
                          ${isExpanded ? 'px-3 justify-start' : 'px-0 justify-center'}`}
            >
              <IconPlus />
              {isExpanded && (lang === 'zh' ? '新建交易' : 'New Trade')}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
