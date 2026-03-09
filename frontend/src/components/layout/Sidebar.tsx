/**
 * Sidebar — Three-State Action Drawer
 *
 * State 1 — Collapsed  (64px):   icon-only column; badge + "+" + toggle
 * State 2 — Expanded   (224px):  nav list with "New Trade" card + portfolio tree
 * State 3 — Trade      (520px):  full TradeEntryForm, page scrolls naturally
 *
 * Expands via explicit toggle button only (no hover-expand).
 * Trade mode triggered by openTradeEntry() → forces 520 px.
 * Flex sibling <main> naturally narrows — sidebar never overlays content.
 * No sticky / fixed height — sidebar is in document flow, page scrolls.
 */
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useSidebar }   from '@/context/SidebarContext'
import TradeEntryForm   from '@/components/TradeEntryForm'
import { fmtCompact }   from '@/utils/format'
import type { Portfolio } from '@/types'

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconChevronLeft = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

const IconChevronRight = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18l6-6-6-6" />
  </svg>
)

const IconPlus = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const IconFolder = ({ active }: { active?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 transition-colors ${active ? 'text-sky-500' : 'text-slate-400'}`}
    viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
  >
    <path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
  </svg>
)

// ── Portfolio tree node ───────────────────────────────────────────────────────
function PortfolioNode({ node, depth = 0 }: { node: Portfolio; depth?: number }) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isActive = selectedPortfolioId === node.id

  return (
    <li>
      <button
        onClick={() => setSelectedPortfolioId(node.id)}
        title={node.name}
        className={[
          'w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-1.5',
          'text-[12.5px] font-sans transition-all duration-150',
          'border-l-2',
          depth > 0 ? 'ml-3' : '',
          isActive
            ? 'border-l-sky-400 bg-sky-50 text-sky-700 font-semibold'
            : 'border-l-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        ].join(' ')}
      >
        <IconFolder active={isActive} />
        <span className="flex-1 truncate leading-none">{node.name}</span>
        <span className={`text-[10.5px] tabular-nums shrink-0 ${isActive ? 'text-sky-500/70' : 'text-slate-400'}`}>
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

// ── Selected portfolio badge (collapsed state) ────────────────────────────────
function PortfolioBadge() {
  const { portfolios, selectedPortfolioId } = usePortfolio()

  const flat: Portfolio[] = []
  const flatten = (ps: Portfolio[]) => ps.forEach(p => { flat.push(p); flatten(p.children) })
  flatten(portfolios)

  const sel     = flat.find(p => p.id === selectedPortfolioId)
  const letters = sel?.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() ?? '—'

  return (
    <div
      title={sel?.name ?? 'No portfolio selected'}
      className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center
                 text-[11px] font-bold text-sky-700 uppercase select-none"
    >
      {letters}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const { portfolios, loading } = usePortfolio()
  const { lang }                = useLanguage()
  const {
    mode, isExpanded, pendingClose,
    openTradeEntry, exitTradeEntry, toggleExpand,
  } = useSidebar()

  const isTradeMode = mode === 'trade_entry'

  // Three-state widths
  const sidebarWidth = isTradeMode ? 520 : isExpanded ? 224 : 64

  const L = {
    newTrade:   lang === 'zh' ? '新建交易'  : 'New Trade',
    portfolios: lang === 'zh' ? '投资组合'  : 'Portfolios',
    noPf:       lang === 'zh' ? '暂无组合'  : 'No portfolios',
    back:       lang === 'zh' ? '返回'      : 'Back',
    close:      lang === 'zh' ? '平仓交易'  : 'Close Position',
    newTr2:     lang === 'zh' ? '新建交易'  : 'New Trade',
    collapse:   lang === 'zh' ? '折叠'      : 'Collapse',
    expand:     lang === 'zh' ? '展开'      : 'Expand',
  }

  return (
    <aside
      className="shrink-0 flex flex-col bg-white border-r border-slate-200
                 overflow-hidden font-sans self-start
                 transition-[width] duration-200 ease-in-out"
      style={{ width: sidebarWidth }}
    >
      {isTradeMode ? (

        /* ════════════════════════════════════════════════════════════════════
         * STATE 3 — PINNED TRADE ENTRY  (520px)
         * Full-width trade form. Back button returns to nav mode.
         * Page scrolls naturally — no internal overflow-y-auto.
         * ════════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col">

          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 shrink-0
                          border-b border-slate-200 bg-slate-50/80">
            <button
              onClick={exitTradeEntry}
              title={L.back}
              className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0
                         text-slate-500 hover:text-slate-800 hover:bg-slate-200/70
                         transition-colors"
            >
              <IconChevronLeft />
            </button>

            {/* Vertical divider */}
            <div className="w-px h-4 bg-slate-200 shrink-0" />

            <div className="flex flex-col leading-none">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em]">
                {pendingClose ? L.close : L.newTr2}
              </span>
              {pendingClose && (
                <span className="text-[13px] font-bold text-slate-800 mt-0.5">
                  {pendingClose.symbol}
                  {pendingClose.optionType && (
                    <span className={`ml-1.5 text-[11px] font-semibold ${pendingClose.optionType === 'PUT' ? 'text-rose-500' : 'text-sky-500'}`}>
                      {pendingClose.optionType}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Form — no internal scroll, page scrolls */}
          <div className="overflow-visible">
            <TradeEntryForm closeState={pendingClose} onSuccess={exitTradeEntry} />
          </div>
        </div>

      ) : isExpanded ? (

        /* ════════════════════════════════════════════════════════════════════
         * STATE 2 — EXPANDED NAV  (224px)
         * New Trade card + Portfolio tree + collapse button
         * ════════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col pt-8">

          {/* Header row: label + collapse toggle */}
          <div className="flex items-center justify-between px-3 pb-2.5 shrink-0">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 pl-0.5">
              {L.portfolios}
            </span>
            <button
              onClick={toggleExpand}
              title={L.collapse}
              className="flex items-center justify-center w-6 h-6 rounded-md
                         text-slate-400 hover:text-slate-700 hover:bg-slate-100
                         transition-colors"
            >
              <IconChevronLeft />
            </button>
          </div>

          {/* ── Action card: New Trade ──────────────────────────────────── */}
          <div className="px-2.5 pb-3 shrink-0">
            <button
              onClick={() => openTradeEntry()}
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl
                         bg-white border border-slate-200 shadow-sm
                         text-[13px] font-semibold text-slate-700
                         hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700
                         hover:shadow-md active:shadow-none
                         transition-all duration-150 group"
            >
              {/* Icon container */}
              <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center
                               shrink-0 group-hover:bg-emerald-200 transition-colors">
                <IconPlus />
              </span>
              {L.newTrade}
            </button>
          </div>

          {/* Thin rule */}
          <div className="mx-3 h-px bg-slate-100 mb-3 shrink-0" />

          {/* ── Portfolio list ────────────────────────────────────────── */}
          <div className="px-2 pb-4 space-y-0.5">
            {loading ? (
              <div className="space-y-1.5 px-1 pt-1">
                {[75, 60, 70].map(w => (
                  <div key={w} className="h-8 rounded-lg bg-slate-100 animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : portfolios.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                {L.noPf}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {portfolios.map(p => <PortfolioNode key={p.id} node={p} />)}
              </ul>
            )}
          </div>
        </div>

      ) : (

        /* ════════════════════════════════════════════════════════════════════
         * STATE 1 — COLLAPSED  (64px)
         * Icon-only vertical stack: toggle › · + New Trade · portfolio badge
         * ════════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col items-center pt-8 pb-2 gap-1">

          {/* Expand toggle */}
          <button
            onClick={toggleExpand}
            title={L.expand}
            className="w-10 h-10 rounded-xl flex items-center justify-center
                       text-slate-400 hover:text-slate-700 hover:bg-slate-100
                       transition-colors"
          >
            <IconChevronRight />
          </button>

          {/* Thin divider */}
          <div className="w-6 h-px bg-slate-200 my-0.5" />

          {/* New Trade — icon pill */}
          <button
            onClick={() => openTradeEntry()}
            title={L.newTrade}
            className="w-10 h-10 rounded-xl flex items-center justify-center
                       bg-emerald-100 text-emerald-600
                       hover:bg-emerald-200 hover:text-emerald-700
                       transition-colors shadow-sm"
          >
            <IconPlus />
          </button>

          {/* Thin divider */}
          <div className="w-6 h-px bg-slate-200 my-0.5" />

          {/* Portfolio badge */}
          <PortfolioBadge />
        </div>
      )}
    </aside>
  )
}
