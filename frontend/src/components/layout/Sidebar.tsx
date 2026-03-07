/**
 * Sidebar — light chrome panel showing portfolio tree.
 * Navigation has moved to TopNav; this panel is now portfolio-context only.
 *
 * ┌──────────────────┐
 * │  PORTFOLIOS      │  ← section header
 * │  Main Account    │
 * │    └ NVDA Wheel◀ │  ← selected
 * │    └ TSLA Puts   │
 * │──────────────────│
 * │  [↻ Refresh all] │
 * └──────────────────┘
 */
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage } from '@/context/LanguageContext'
import type { Portfolio } from '@/types'
import { fmtCompact } from '@/utils/format'

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconFolder = ({ selected }: { selected?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-primary' : 'text-chrome-muted/60'}`}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
  </svg>
)

const IconRefresh = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
)

// ── Portfolio tree node ───────────────────────────────────────────────────────
function PortfolioNode({ node, depth = 0 }: { node: Portfolio; depth?: number }) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isSelected = selectedPortfolioId === node.id

  return (
    <li>
      <button
        onClick={() => setSelectedPortfolioId(node.id)}
        className={[
          'w-full text-left flex items-center gap-2 rounded-lg text-[13px]',
          'transition-all duration-150 font-sans',
          'px-2.5 py-2',
          depth > 0 ? 'ml-4' : '',
          isSelected
            ? 'bg-primary/10 text-primary font-semibold'
            : 'text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle',
        ].join(' ')}
      >
        <IconFolder selected={isSelected} />
        <span className="flex-1 truncate leading-none">{node.name}</span>
        <span
          className={`text-[11px] tabular-nums font-medium ${
            isSelected ? 'text-primary/60' : 'text-chrome-muted/50'
          }`}
        >
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
  const { lang } = useLanguage()

  return (
    <aside
      className="w-60 shrink-0 flex flex-col bg-chrome border-r border-chrome-border
                 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto font-sans"
    >
      {/* Portfolio section header */}
      <div className="px-4 pt-5 pb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-chrome-muted/60">
          {lang === 'zh' ? '投资组合' : 'Portfolios'}
        </span>
        <span className="text-[10px] text-chrome-muted/40 tabular-nums">
          {portfolios.length}
        </span>
      </div>

      {/* Thin accent line under header */}
      <div className="mx-4 h-px bg-chrome-border mb-2" />

      {/* Portfolio tree */}
      <div className="flex-1 px-2 overflow-y-auto">
        {loading ? (
          <div className="space-y-1.5 px-2 pt-1">
            {[80, 65, 72].map((w) => (
              <div
                key={w}
                className="h-8 rounded-lg bg-chrome-subtle animate-pulse"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : portfolios.length === 0 ? (
          <div className="px-3 py-4 text-xs text-chrome-muted/50 text-center">
            {lang === 'zh' ? '暂无组合' : 'No portfolios'}
          </div>
        ) : (
          <ul className="space-y-0.5 pb-2">
            {portfolios.map((p) => (
              <PortfolioNode key={p.id} node={p} />
            ))}
          </ul>
        )}
      </div>

      {/* Refresh footer */}
      <div className="px-3 py-3 border-t border-chrome-border">
        <button
          onClick={triggerRefresh}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                     text-xs font-medium text-chrome-muted
                     hover:text-primary hover:bg-primary/8
                     transition-all duration-150 border border-transparent
                     hover:border-primary/20"
        >
          <IconRefresh />
          {lang === 'zh' ? '刷新全部' : 'Refresh all'}
        </button>
      </div>
    </aside>
  )
}
