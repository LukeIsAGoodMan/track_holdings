/**
 * Sidebar
 *
 * ┌───────────────────┐
 * │  Track Holdings   │  ← brand
 * │───────────────────│
 * │  ○ Holdings       │  ← nav links
 * │  ○ Trade Entry    │
 * │  ○ Risk           │
 * │───────────────────│
 * │  PORTFOLIOS       │  ← portfolio tree
 * │  Main Account     │
 * │    └ NVDA Wheel ◀ │  ← selected highlight
 * │───────────────────│
 * │  [↻ Refresh]      │
 * └───────────────────┘
 */
import { NavLink } from 'react-router-dom'
import { usePortfolio } from '@/context/PortfolioContext'
import type { Portfolio } from '@/types'
import { fmtCompact } from '@/utils/format'

// ── Icons (inline SVG, zero dependencies) ─────────────────────────────────────
const IconTable   = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
const IconPlus    = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14"/></svg>
const IconShield  = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
const IconRefresh = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
const IconFolder  = () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>

// ── Nav link style helper ─────────────────────────────────────────────────────
const navBase = 'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors'
const navActive = 'bg-info/10 text-info'
const navIdle   = 'text-slate-400 hover:text-slate-200 hover:bg-white/5'

// ── Portfolio tree node ───────────────────────────────────────────────────────
function PortfolioNode({
  node,
  depth = 0,
}: {
  node: Portfolio
  depth?: number
}) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isSelected = selectedPortfolioId === node.id

  return (
    <li>
      <button
        onClick={() => setSelectedPortfolioId(node.id)}
        className={[
          'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
          depth > 0 ? 'ml-3' : '',
          isSelected
            ? 'bg-info/15 text-info font-semibold'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
        ].join(' ')}
      >
        <IconFolder />
        <span className="flex-1 truncate">{node.name}</span>
        {/* Cash balance teaser */}
        <span className="text-slate-600 text-xs tabular-nums">
          {fmtCompact(node.total_cash)}
        </span>
      </button>

      {node.children.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {node.children.map((child) => (
            <PortfolioNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const { portfolios, triggerRefresh, loading } = usePortfolio()

  return (
    <aside className="w-56 shrink-0 flex flex-col h-screen bg-card border-r border-line sticky top-0 overflow-y-auto">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 border-b border-line">
        <div className="text-info font-bold text-base tracking-tight leading-none">
          Track Holdings
        </div>
        <div className="text-slate-600 text-xs mt-1">Options Portfolio</div>
      </div>

      {/* Navigation */}
      <nav className="px-2 py-3 border-b border-line space-y-0.5">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `${navBase} ${isActive ? navActive : navIdle}`
          }
        >
          <IconTable />
          Holdings
        </NavLink>
        <NavLink
          to="/trade"
          className={({ isActive }) =>
            `${navBase} ${isActive ? navActive : navIdle}`
          }
        >
          <IconPlus />
          Trade Entry
        </NavLink>
        <NavLink
          to="/risk"
          className={({ isActive }) =>
            `${navBase} ${isActive ? navActive : navIdle}`
          }
        >
          <IconShield />
          Risk
        </NavLink>
      </nav>

      {/* Portfolio tree */}
      <div className="flex-1 px-2 py-3">
        <div className="px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
          Portfolios
        </div>
        {loading ? (
          <div className="px-2 text-xs text-slate-600 animate-pulse">Loading…</div>
        ) : (
          <ul className="space-y-0.5">
            {portfolios.map((p) => (
              <PortfolioNode key={p.id} node={p} />
            ))}
          </ul>
        )}
      </div>

      {/* Refresh button */}
      <div className="px-3 py-3 border-t border-line">
        <button
          onClick={triggerRefresh}
          className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
        >
          <IconRefresh />
          Refresh all
        </button>
      </div>
    </aside>
  )
}
