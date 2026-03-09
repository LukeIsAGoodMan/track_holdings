/**
 * Sidebar — Three-State Action Drawer
 *
 * State 1 — Collapsed  (64px,  default):   portfolio badge + "+" icon only.
 * State 2 — Hover      (224px, auto):       mouse-in → pushes content, shows portfolio list.
 * State 3 — Pinned     (304px, trade entry): locked open with full TradeEntryForm.
 *
 * Width change is handled by CSS `transition-[width]` on the flex `<aside>`,
 * so the sibling <main> is *pushed*, never overlaid.
 * `overflow-hidden` on the aside clips content during the transition (no bleed).
 */
import { useState } from 'react'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useSidebar }   from '@/context/SidebarContext'
import TradeEntryForm   from '@/components/TradeEntryForm'
import { fmtCompact }   from '@/utils/format'
import type { Portfolio } from '@/types'

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconFolder = ({ active }: { active?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 transition-colors ${active ? 'text-sky-400' : 'text-slate-600'}`}
    viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
  >
    <path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
  </svg>
)

const IconChevronLeft = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconPlus = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
)

// ── Portfolio tree ─────────────────────────────────────────────────────────────
function PortfolioNode({ node, depth = 0 }: { node: Portfolio; depth?: number }) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isActive = selectedPortfolioId === node.id

  return (
    <li>
      <button
        onClick={() => setSelectedPortfolioId(node.id)}
        title={node.name}
        className={[
          'w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-sans',
          'transition-all duration-150 whitespace-nowrap',
          depth > 0 ? 'ml-3.5' : '',
          isActive
            ? 'bg-sky-500/15 text-sky-400 font-semibold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70',
        ].join(' ')}
      >
        <IconFolder active={isActive} />
        <span className="flex-1 truncate leading-none">{node.name}</span>
        <span className={`text-[10.5px] tabular-nums shrink-0 ${isActive ? 'text-sky-400/50' : 'text-slate-700'}`}>
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

// ── Collapsed portfolio badge ──────────────────────────────────────────────────
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
      className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center
                 text-[11px] font-bold text-sky-400 uppercase select-none cursor-default"
    >
      {letters}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const { portfolios, loading } = usePortfolio()
  const { lang }                = useLanguage()
  const { mode, pendingClose, openTradeEntry, exitTradeEntry } = useSidebar()

  // Track hover state independently — let it stay true when mouse is over,
  // even in trade mode (so exiting trade mode with mouse still inside gives
  // the user a natural 224px nav view rather than a jarring collapse to 64px).
  const [isHovered, setIsHovered] = useState(false)

  const isTradeMode = mode === 'trade_entry'
  const isExpanded  = !isTradeMode && isHovered

  // Three-state width
  const sidebarWidth = isTradeMode ? 304 : isHovered ? 224 : 64

  return (
    <aside
      className="shrink-0 flex flex-col bg-slate-900 border-r border-slate-700/50
                 sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden
                 transition-[width] duration-200 ease-in-out z-20"
      style={{ width: sidebarWidth }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isTradeMode ? (
        /* ════════════════════════════════════════════════════════════════════
         * STATE 3 — PINNED (Trade Entry)
         * ════════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-3 py-3 shrink-0
                          bg-slate-950/60 border-b border-slate-700/50">
            <button
              onClick={exitTradeEntry}
              title={lang === 'zh' ? '返回' : 'Back'}
              className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0
                         text-slate-500 hover:text-slate-200 hover:bg-slate-800
                         transition-colors"
            >
              <IconChevronLeft />
            </button>
            <span className="text-[13px] font-semibold text-slate-200 truncate leading-none">
              {lang === 'zh'
                ? (pendingClose ? '平仓交易' : '新建交易')
                : (pendingClose ? 'Close Position' : 'New Trade')}
            </span>
          </div>

          {/* Form — full internal scroll, no overflow bleed */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TradeEntryForm closeState={pendingClose} onSuccess={exitTradeEntry} />
          </div>
        </div>

      ) : (
        /* ════════════════════════════════════════════════════════════════════
         * STATE 1 + 2 — NAV (Collapsed or Hover-Expanded)
         * ════════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col h-full">

          {/* ── Portfolio area ──────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col">
            {isExpanded ? (
              /* — Hover-Expanded: full portfolio list ─── */
              <>
                <div className="px-3 pt-4 pb-1.5 shrink-0">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-slate-600">
                    {lang === 'zh' ? '投资组合' : 'Portfolios'}
                  </span>
                </div>
                <div className="h-px bg-slate-700/40 mx-3 mb-2 shrink-0" />

                <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                  {loading ? (
                    <div className="space-y-1.5 px-1 pt-1">
                      {[75, 60, 70].map(w => (
                        <div
                          key={w}
                          className="h-8 rounded-lg bg-slate-800 animate-pulse"
                          style={{ width: `${w}%` }}
                        />
                      ))}
                    </div>
                  ) : portfolios.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-600">
                      {lang === 'zh' ? '暂无组合' : 'No portfolios'}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {portfolios.map(p => <PortfolioNode key={p.id} node={p} />)}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              /* — Collapsed: portfolio badge only ─── */
              <div className="flex flex-col items-center pt-4 gap-3">
                <PortfolioBadge />
                <div className="w-6 h-px bg-slate-700/50" />
              </div>
            )}
          </div>

          {/* ── New Trade footer button ─────────────────────────────────── */}
          <div className="shrink-0 p-2 border-t border-slate-700/50">
            <button
              onClick={() => openTradeEntry()}
              title={lang === 'zh' ? '新建交易' : 'New Trade'}
              className={`w-full flex items-center rounded-lg py-2.5 font-semibold
                          text-[13px] bg-emerald-700/80 text-emerald-100
                          hover:bg-emerald-600 hover:text-white
                          transition-all duration-150
                          ${isExpanded ? 'px-3 gap-2 justify-start' : 'justify-center px-0 gap-0'}`}
            >
              <IconPlus />
              {isExpanded && (lang === 'zh' ? '新建交易' : 'New Trade')}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
