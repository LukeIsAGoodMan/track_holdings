/**
 * Sidebar — Three-State Action Drawer (+ two pinned-panel sub-states)
 *
 * State 1 — Collapsed    (64px):   icon-only column; toggle + "+" + bell + portfolio badge
 * State 2 — Expanded    (224px):  nav with "New Trade" card + "Price Alerts" + portfolio tree
 * State 3a — Trade       (520px):  TradeEntryForm, locked until Back pressed
 * State 3b — Price Alerts(520px):  PriceAlertsSidebar, locked until Back pressed
 *
 * Phase 16D: Drag & drop portfolio reorganization (@dnd-kit).
 *   - Sibling reorder via sort_order
 *   - Parent reassignment by dropping onto a folder
 *   - DragOverlay for visual feedback; cycle-safe (backend validates)
 *
 * Sticky below TopNav (top-14), fills remaining viewport height.
 */
import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS }                   from '@dnd-kit/utilities'
import { usePortfolio }          from '@/context/PortfolioContext'
import { useLanguage }           from '@/context/LanguageContext'
import { useSidebar }            from '@/context/SidebarContext'
import TradeEntryForm            from '@/components/TradeEntryForm'
import PriceAlertsSidebar        from '@/components/PriceAlertsSidebar'
import CreatePortfolioModal      from '@/components/CreatePortfolioModal'
import { fmtCompact }            from '@/utils/format'
import { movePortfolio }         from '@/api/holdings'
import type { Portfolio }        from '@/types'

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

const IconBell = ({ active }: { active?: boolean }) => (
  <svg
    className={`w-4 h-4 transition-colors ${active ? 'text-amber-500' : 'text-slate-500'}`}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" aria-hidden="true"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
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

const IconBriefcase = ({ active }: { active?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 transition-colors ${active ? 'text-sky-500' : 'text-slate-400'}`}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  </svg>
)

const IconGrip = () => (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="7" r="1.5" />
    <circle cx="15" cy="7" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="17" r="1.5" />
    <circle cx="15" cy="17" r="1.5" />
  </svg>
)

// ── Sortable portfolio tree node ───────────────────────────────────────────────

function SortablePortfolioNode({
  node,
  depth = 0,
  parentId = null,
  activeId,
}: {
  node:      Portfolio
  depth?:    number
  parentId?: number | null
  activeId:  number | null
}) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isActive     = selectedPortfolioId === node.id
  const hasChildren  = node.children.length > 0
  const isExpandable = hasChildren || node.is_folder
  const [expanded, setExpanded] = useState(true)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id:   node.id,
    data: { type: 'portfolio', node, parentId },
  })

  const style: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  }

  // Highlight when another item is dragged over this folder
  const isDropTarget = isOver && node.is_folder && activeId !== null && activeId !== node.id

  return (
    <li ref={setNodeRef} style={style} className="group">
      <div
        className={[
          'flex items-center gap-0.5 rounded-lg transition-all duration-150',
          isDragging    ? 'opacity-30'                            : '',
          isDropTarget  ? 'ring-2 ring-sky-400 ring-offset-1 bg-sky-50/60' : '',
        ].join(' ')}
        style={{ paddingLeft: depth * 12 }}
      >
        {/* Drag handle — appears on hover */}
        <button
          {...attributes}
          {...listeners}
          tabIndex={-1}
          title="Drag to reorder"
          className="flex items-center justify-center w-4 h-5 rounded shrink-0
                     text-slate-300 hover:text-slate-500
                     cursor-grab active:cursor-grabbing
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        >
          <IconGrip />
        </button>

        {/* Chevron — expandable nodes only */}
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          tabIndex={isExpandable ? 0 : -1}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className={`flex items-center justify-center w-5 h-5 rounded shrink-0 transition-colors ${
            isExpandable
              ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
              : 'invisible pointer-events-none'
          }`}
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Portfolio select button */}
        <button
          onClick={() => setSelectedPortfolioId(node.id)}
          title={node.name}
          className={[
            'flex-1 min-w-0 text-left flex items-center gap-2 rounded-lg px-2 py-1.5',
            'text-[12.5px] font-sans transition-all duration-150',
            'border-l-[3px]',
            isActive
              ? 'border-l-sky-400 bg-sky-50 text-sky-700 font-semibold'
              : 'border-l-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
          ].join(' ')}
        >
          {isExpandable
            ? <IconFolder active={isActive} />
            : <IconBriefcase active={isActive} />
          }
          <span className="flex-1 truncate leading-none">{node.name}</span>
          <span className={`text-[10.5px] tabular-nums shrink-0 ${isActive ? 'text-sky-500/70' : 'text-slate-400'}`}>
            {fmtCompact(node.aggregated_cash)}
          </span>
        </button>
      </div>

      {/* Children wrapped in their own SortableContext */}
      {isExpandable && expanded && hasChildren && (
        <SortableContext
          items={node.children.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="mt-0.5 space-y-0.5">
            {node.children.map(child => (
              <SortablePortfolioNode
                key={child.id}
                node={child}
                depth={depth + 1}
                parentId={node.id}
                activeId={activeId}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </li>
  )
}

// ── Collapsed: selected portfolio badge ───────────────────────────────────────

function PortfolioBadge() {
  const { portfolios, selectedPortfolioId } = usePortfolio()

  const flat = useMemo(() => {
    const acc: Portfolio[] = []
    const walk = (ps: Portfolio[]) => ps.forEach(p => { acc.push(p); walk(p.children) })
    walk(portfolios)
    return acc
  }, [portfolios])

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

// ── Reusable pinned-panel header ──────────────────────────────────────────────

function PanelHeader({
  label, sublabel, sublabelClass = '', onBack, backTitle,
}: {
  label:          string
  sublabel?:      string
  sublabelClass?: string
  onBack:         () => void
  backTitle:      string
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 shrink-0
                    border-b border-slate-200 bg-slate-50/80">
      <button
        onClick={onBack}
        title={backTitle}
        className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0
                   text-slate-500 hover:text-slate-800 hover:bg-slate-200/70
                   transition-colors"
      >
        <IconChevronLeft />
      </button>

      <div className="w-px h-4 bg-slate-200 shrink-0" />

      <div className="flex flex-col leading-none">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em]">
          {label}
        </span>
        {sublabel && (
          <span className={`text-[13px] font-bold text-slate-800 mt-0.5 ${sublabelClass}`}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { portfolios, loading, fetchError, triggerRefresh } = usePortfolio()
  const { lang }    = useLanguage()
  const {
    mode, isExpanded,
    pendingClose, alertPrefill,
    openTradeEntry, exitTradeEntry,
    openPriceAlerts, exitPriceAlerts,
    toggleExpand,
  } = useSidebar()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [activeId, setActiveId]               = useState<number | null>(null)
  const [moving, setMoving]                   = useState(false)

  // After a trade is recorded: close form + refresh portfolio cash values
  const handleTradeSuccess = () => {
    exitTradeEntry()
    triggerRefresh()
  }

  const isTradeMode  = mode === 'trade_entry'
  const isAlertsMode = mode === 'price_alerts'
  const isPinnedMode = isTradeMode || isAlertsMode

  const sidebarWidth = isPinnedMode ? 520 : isExpanded ? 224 : 64

  const L = {
    newTrade:    lang === 'zh' ? '新建交易'  : 'New Trade',
    priceAlerts: lang === 'zh' ? '价格警报'  : 'Price Alerts',
    portfolios:  lang === 'zh' ? '投资组合'  : 'Portfolios',
    noPf:        lang === 'zh' ? '暂无组合'  : 'No portfolios',
    back:        lang === 'zh' ? '返回'      : 'Back',
    close:       lang === 'zh' ? '平仓交易'  : 'Close Position',
    newTr2:      lang === 'zh' ? '新建交易'  : 'New Trade',
    alertsHdr:   lang === 'zh' ? '价格警报'  : 'Price Alerts',
    collapse:    lang === 'zh' ? '折叠'      : 'Collapse',
    expand:      lang === 'zh' ? '展开'      : 'Expand',
  }

  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // ── id → { node, parentId } flat index ──────────────────────────────────────
  const flatMap = useMemo(() => {
    const map = new Map<number, { node: Portfolio; parentId: number | null }>()
    const walk = (nodes: Portfolio[], pId: number | null) => {
      nodes.forEach(n => {
        map.set(n.id, { node: n, parentId: pId })
        walk(n.children, n.id)
      })
    }
    walk(portfolios, null)
    return map
  }, [portfolios])

  // ── parentId → ordered sibling list ─────────────────────────────────────────
  const siblingGroups = useMemo(() => {
    const groups = new Map<number | null, Portfolio[]>()
    const walk = (nodes: Portfolio[], pId: number | null) => {
      groups.set(pId, [...nodes])
      nodes.forEach(n => n.children.length > 0 && walk(n.children, n.id))
    }
    walk(portfolios, null)
    return groups
  }, [portfolios])

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as number)
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id || moving) return

    const activeEntry = flatMap.get(active.id as number)
    const overEntry   = flatMap.get(over.id as number)
    if (!activeEntry || !overEntry) return

    const overNode       = overEntry.node
    const activeParentId = activeEntry.parentId
    const overParentId   = overEntry.parentId

    setMoving(true)
    try {
      // Drop onto a folder that is not the active item's current parent → reassign parent
      if (overNode.is_folder && (over.id as number) !== activeParentId) {
        await movePortfolio(active.id as number, over.id as number, 0)
        triggerRefresh()
        return
      }

      // Same parent → sibling reorder
      if (activeParentId === overParentId) {
        const siblings = siblingGroups.get(activeParentId) ?? []
        const oldIdx   = siblings.findIndex(p => p.id === active.id)
        const newIdx   = siblings.findIndex(p => p.id === over.id)
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return
        const reordered = arrayMove(siblings, oldIdx, newIdx)
        await Promise.all(
          reordered.map((p, i) => movePortfolio(p.id, activeParentId, i))
        )
        triggerRefresh()
      }
    } catch (err) {
      console.error('Portfolio move failed:', err)
    } finally {
      setMoving(false)
    }
  }

  const activeNode = activeId ? (flatMap.get(activeId)?.node ?? null) : null

  return (
    <aside
      className="shrink-0 flex flex-col bg-white border-r border-slate-200
                 overflow-hidden font-sans
                 sticky top-14 h-[calc(100vh-3.5rem)]
                 transition-[width] duration-200 ease-in-out"
      style={{ width: sidebarWidth }}
    >

      {isTradeMode ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 3a — TRADE ENTRY  (520px)
         * ══════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <PanelHeader
            label={pendingClose ? L.close : L.newTr2}
            sublabel={pendingClose?.symbol}
            sublabelClass={pendingClose?.optionType === 'PUT' ? 'text-rose-500' : 'text-sky-500'}
            onBack={exitTradeEntry}
            backTitle={L.back}
          />
          <div className="overflow-visible">
            <TradeEntryForm closeState={pendingClose} onSuccess={handleTradeSuccess} />
          </div>
        </div>

      ) : isAlertsMode ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 3b — PRICE ALERTS  (520px)
         * ══════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col flex-1 min-h-0">
          <PanelHeader
            label={L.alertsHdr}
            sublabel={alertPrefill?.symbol}
            onBack={exitPriceAlerts}
            backTitle={L.back}
          />
          <PriceAlertsSidebar prefill={alertPrefill} />
        </div>

      ) : isExpanded ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 2 — EXPANDED NAV  (224px)
         * ══════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pt-8">

          {/* Header row: label + new portfolio + collapse toggle */}
          <div className="flex items-center gap-1 px-3 pb-2.5 shrink-0">
            <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 pl-0.5">
              {L.portfolios}
            </span>
            <button
              title={lang === 'zh' ? '新建组合' : 'New Portfolio'}
              onClick={() => setShowCreateModal(true)}
              className="flex items-center justify-center w-6 h-6 rounded-md
                         text-slate-400 hover:text-slate-700 hover:bg-slate-100
                         transition-colors"
            >
              <IconPlus />
            </button>
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

          {/* Action cards */}
          <div className="px-2.5 pb-2 shrink-0 space-y-1.5">

            {/* New Trade card */}
            <button
              onClick={() => openTradeEntry()}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl
                         bg-white border border-slate-200 shadow-sm
                         text-[13px] font-semibold text-slate-700
                         hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700
                         hover:shadow-md active:shadow-none
                         transition-all duration-150 group"
            >
              <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center
                               shrink-0 group-hover:bg-emerald-200 transition-colors">
                <IconPlus />
              </span>
              {L.newTrade}
            </button>

            {/* Price Alerts card */}
            <button
              onClick={() => openPriceAlerts()}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl
                         bg-white border border-slate-200 shadow-sm
                         text-[13px] font-semibold text-slate-700
                         hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700
                         hover:shadow-md active:shadow-none
                         transition-all duration-150 group"
            >
              <span className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center
                               shrink-0 group-hover:bg-amber-200 transition-colors">
                <IconBell />
              </span>
              {L.priceAlerts}
            </button>
          </div>

          {/* Thin rule */}
          <div className="mx-3 h-px bg-slate-100 mb-3 shrink-0" />

          {/* Portfolio list */}
          <div className="px-2 pb-4 space-y-0.5">
            {loading ? (
              <div className="space-y-1.5 px-1 pt-1">
                {[75, 60, 70].map(w => (
                  <div key={w} className="h-8 rounded-lg bg-slate-100 animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : fetchError ? (
              <div className="mx-1 mt-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-rose-600">
                  {lang === 'zh' ? '加载失败' : 'Load failed'}
                </p>
                <p className="mt-0.5 text-[10px] text-rose-400 break-all leading-snug">{fetchError}</p>
                <button
                  onClick={triggerRefresh}
                  className="mt-1.5 text-[10px] font-semibold text-rose-500 hover:text-rose-700 underline underline-offset-2"
                >
                  {lang === 'zh' ? '重试' : 'Retry'}
                </button>
              </div>
            ) : portfolios.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">{L.noPf}</div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={portfolios.map(p => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-0.5">
                    {portfolios.map(p => (
                      <SortablePortfolioNode
                        key={p.id}
                        node={p}
                        depth={0}
                        parentId={null}
                        activeId={activeId}
                      />
                    ))}
                  </ul>
                </SortableContext>

                <DragOverlay dropAnimation={null}>
                  {activeNode ? (
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                                 bg-white/95 border border-sky-300 shadow-xl backdrop-blur-sm
                                 text-[12.5px] font-semibold text-sky-700"
                      style={{ width: 180 }}
                    >
                      {activeNode.is_folder
                        ? <IconFolder active />
                        : <IconBriefcase active />
                      }
                      <span className="truncate">{activeNode.name}</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </div>

      ) : (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 1 — COLLAPSED  (64px)
         * ══════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col items-center flex-1 min-h-0 overflow-y-auto pt-8 pb-2 gap-1">

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

          <div className="w-6 h-px bg-slate-200 my-0.5" />

          {/* New Trade pill */}
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

          {/* Price Alerts pill */}
          <button
            onClick={() => openPriceAlerts()}
            title={L.priceAlerts}
            className="w-10 h-10 rounded-xl flex items-center justify-center
                       bg-amber-100 text-amber-600
                       hover:bg-amber-200 hover:text-amber-700
                       transition-colors shadow-sm"
          >
            <IconBell />
          </button>

          <div className="w-6 h-px bg-slate-200 my-0.5" />

          {/* Portfolio badge */}
          <PortfolioBadge />
        </div>
      )}

      {showCreateModal && (
        <CreatePortfolioModal onClose={() => setShowCreateModal(false)} />
      )}
    </aside>
  )
}
