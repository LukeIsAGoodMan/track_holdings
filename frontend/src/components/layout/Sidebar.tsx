/**
 * Sidebar — Three-State Action Drawer (+ three pinned-panel sub-states)
 *
 * State 1 — Collapsed         (64px):   icon-only column
 * State 2 — Expanded          (224px):  nav + portfolio tree with drag-and-drop
 * State 3a — Trade Entry      (520px):  TradeEntryForm
 * State 3b — Price Alerts     (520px):  PriceAlertsSidebar
 * State 3c — Portfolio Create (520px):  PortfolioCreatePanel  (Phase 16E)
 *
 * Phase 16D: @dnd-kit drag-and-drop for sibling reorder + parent reassignment.
 * Phase 16E: Portfolio creation moved from modal into inline sidebar panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS }                from '@dnd-kit/utilities'
import { usePortfolio }       from '@/context/PortfolioContext'
import { useLanguage }        from '@/context/LanguageContext'
import { useSidebar }         from '@/context/SidebarContext'
import TradeEntryForm         from '@/components/TradeEntryForm'
import PriceAlertsSidebar     from '@/components/PriceAlertsSidebar'
import { fmtCompact }         from '@/utils/format'
import { createPortfolio, movePortfolio, batchReorderPortfolios } from '@/api/holdings'
import type { Portfolio }     from '@/types'

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

// ── DnD helpers ───────────────────────────────────────────────────────────────

/**
 * Walk up from potentialDescendant via parentId links.
 * Returns true if potentialAncestor appears in that chain,
 * i.e. potentialDescendant IS inside potentialAncestor's subtree.
 */
function isDescendantOf(
  potentialDescendant: number,
  potentialAncestor:   number,
  map: Map<number, { node: Portfolio; parentId: number | null }>,
): boolean {
  let current: number | null = potentialDescendant
  while (current !== null) {
    if (current === potentialAncestor) return true
    current = map.get(current)?.parentId ?? null
  }
  return false
}

// ── Portfolio tree flatten for deep-nest creation ─────────────────────────────

interface FolderOption { id: number; label: string }

type DropIntent = 'before' | 'inside' | 'after'
interface DropState { targetId: number | null; intent: DropIntent | null; valid: boolean }
const EMPTY_DROP: DropState = { targetId: null, intent: null, valid: false }

function flattenFolders(nodes: Portfolio[], prefix = ''): FolderOption[] {
  const result: FolderOption[] = []
  for (const node of nodes) {
    if (node.is_folder) {
      const label = prefix ? `${prefix} › ${node.name}` : node.name
      result.push({ id: node.id, label })
      result.push(...flattenFolders(node.children, label))
    } else {
      // Non-folder: recurse to find any nested folders inside it
      result.push(...flattenFolders(node.children, prefix))
    }
  }
  return result
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

// ── Portfolio Create Panel (State 3c) ─────────────────────────────────────────

function PortfolioCreatePanel({ onBack, initialIsFolder = false }: { onBack: () => void; initialIsFolder?: boolean }) {
  const { portfolios, triggerRefresh } = usePortfolio()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const [name,     setName]     = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [isFolder, setIsFolder] = useState(initialIsFolder)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameRef.current?.focus() }, [])

  // Flat ordered list of all folder nodes with full path labels (any depth)
  const folderOptions = useMemo(() => flattenFolders(portfolios), [portfolios])

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      await createPortfolio({ name: trimmed, parent_id: parentId, is_folder: isFolder })
      triggerRefresh()
      onBack()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(isEn ? `Failed: ${msg}` : `创建失败：${msg}`)
    } finally {
      setLoading(false)
    }
  }, [name, parentId, isFolder, isEn, triggerRefresh, onBack])

  const L = {
    hdr:      isFolder
                ? (isEn ? 'New Portfolio' : '新建组合')
                : (isEn ? 'New Account'   : '新建账户'),
    back:     isEn ? 'Back'                       : '返回',
    nameLbl:  isEn ? 'Name'                       : '名称',
    namePh:   isEn ? 'e.g. NVDA Wheel'           : '例：NVDA 轮动策略',
    typeLbl:  isEn ? 'Type'                       : '类型',
    account:  isEn ? 'Account'                    : '账户',
    folder:   isEn ? 'Portfolio'                  : '组合',
    parentLbl:isEn ? 'Parent Portfolio'           : '父组合',
    noParent: isEn ? '— Root level (none) —'      : '— 根层级（无）—',
    create:   isEn ? (isFolder ? 'Create Portfolio' : 'Create Account') : '创建',
    creating: isEn ? 'Creating…'                  : '创建中…',
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader label={L.hdr} onBack={onBack} backTitle={L.back} />

      <form
        onSubmit={handleSubmit}
        className="flex-1 overflow-y-auto"
      >
        <div className="px-5 py-5 space-y-5">

          {/* ── Name ─────────────────────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider
                               text-slate-400 mb-1.5">
              {L.nameLbl}
            </label>
            <input
              ref={nameRef}
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder={L.namePh}
              maxLength={100}
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50
                         px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-sky-400
                         transition"
            />
          </div>

          {/* ── Type segmented toggle ────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider
                               text-slate-400 mb-1.5">
              {L.typeLbl}
            </label>
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setIsFolder(false)}
                className={[
                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px]',
                  'text-[12.5px] font-semibold transition-all duration-150',
                  !isFolder
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                <IconBriefcase active={!isFolder} />
                {L.account}
              </button>
              <button
                type="button"
                onClick={() => setIsFolder(true)}
                className={[
                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px]',
                  'text-[12.5px] font-semibold transition-all duration-150',
                  isFolder
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                <IconFolder active={isFolder} />
                {L.folder}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {isFolder
                ? (isEn ? 'Groups sub-portfolios; no direct trades.' : '用于组织子组合，不直接持仓。')
                : (isEn ? 'Trading account with holdings and trades.' : '持有仓位并可记录交易。')
              }
            </p>
          </div>

          {/* ── Parent portfolio ──────────────────────────────────────────── */}
          {(
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider
                                 text-slate-400 mb-1.5">
                {L.parentLbl}
              </label>
              <div className="relative">
                <select
                  value={parentId ?? ''}
                  onChange={e => setParentId(e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50
                             px-3.5 py-2.5 text-[13px] text-slate-900
                             focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-sky-400
                             transition appearance-none cursor-pointer pr-8"
                >
                  <option value="">{L.noParent}</option>
                  {folderOptions.map(f => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
                {/* Chevron decoration */}
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2
                             w-3.5 h-3.5 text-slate-400"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && (
            <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200
                            rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}

          {/* ── Submit ────────────────────────────────────────────────────── */}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full rounded-xl bg-sky-500 py-2.5
                       text-[13px] font-semibold text-white
                       hover:bg-sky-600 active:bg-sky-700
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition shadow-sm"
          >
            {loading ? L.creating : L.create}
          </button>

        </div>
      </form>
    </div>
  )
}

// ── Sortable portfolio tree node ───────────────────────────────────────────────

function SortablePortfolioNode({
  node,
  depth = 0,
  parentId = null,
  activeId,
  dropState,
  expandSet,
  ancestorIds,
}: {
  node:        Portfolio
  depth?:      number
  parentId?:   number | null
  activeId:    number | null
  dropState:   DropState
  expandSet:   ReadonlySet<number>
  ancestorIds: ReadonlySet<number>
}) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const isActive       = selectedPortfolioId === node.id
  const isInActivePath = ancestorIds.has(node.id)
  const hasChildren    = node.children.length > 0
  const isExpandable   = hasChildren || node.is_folder
  const [expanded, setExpanded] = useState(true)

  // Auto-expand: selection trail
  useEffect(() => { if (isInActivePath) setExpanded(true) }, [isInActivePath])
  // Auto-expand: drag-hover timer
  useEffect(() => { if (expandSet.has(node.id)) setExpanded(true) }, [expandSet, node.id])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id:   node.id,
    data: { type: 'portfolio', node, parentId },
  })

  const dndStyle: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  }

  // Per-node drop indicators
  const isTarget  = dropState.targetId === node.id
  const showBefore = isTarget && dropState.intent === 'before' && dropState.valid
  const showAfter  = isTarget && dropState.intent === 'after'  && dropState.valid
  const showInside = isTarget && dropState.intent === 'inside' && dropState.valid
  const showInvalid = isTarget && !dropState.valid

  const btnClass = [
    'flex-1 min-w-0 text-left flex items-center gap-2 rounded-lg px-2 py-1.5',
    'text-[12.5px] transition-all duration-150 border-l-[3px]',
    isActive
      ? 'border-l-sky-400 bg-sky-50 text-sky-700 font-semibold'
      : isInActivePath
        ? 'border-l-sky-200/70 text-sky-600/80 font-semibold hover:bg-sky-50/40'
        : node.is_folder
          ? 'border-l-transparent text-slate-700 font-semibold hover:bg-slate-50 hover:text-slate-900'
          : 'border-l-transparent text-slate-500 font-medium hover:bg-slate-50 hover:text-slate-700',
  ].join(' ')

  return (
    <li ref={setNodeRef} style={dndStyle} className="group relative">
      {/* Row ─── contains insertion lines (relative context) */}
      <div
        className={[
          'relative flex items-center gap-0.5 rounded-lg transition-all duration-150',
          isDragging  ? 'opacity-30'                                  : '',
          showInside  ? 'bg-sky-100/50 ring-1 ring-sky-300/60'        : '',
          showInvalid ? 'cursor-not-allowed'                          : '',
        ].join(' ')}
        style={{ paddingLeft: depth * 20 }}
      >
        {/* ── Insertion lines ─────────────────────────────── */}
        {showBefore && (
          <div className="absolute inset-x-0 -top-px h-0.5 bg-sky-500 rounded-full z-20 pointer-events-none" />
        )}
        {showAfter && (
          <div className="absolute inset-x-0 -bottom-px h-0.5 bg-sky-500 rounded-full z-20 pointer-events-none" />
        )}

        {/* Drag handle — appears on hover */}
        <button
          {...attributes}
          {...listeners}
          tabIndex={-1}
          title="Drag to reorder"
          className={[
            'flex items-center justify-center w-4 h-5 rounded shrink-0',
            'text-slate-300 hover:text-slate-500',
            showInvalid ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
          ].join(' ')}
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

        {/* Portfolio / Account select button */}
        <button
          onClick={() => setSelectedPortfolioId(node.id)}
          title={node.name}
          className={btnClass}
        >
          {node.is_folder
            ? <IconFolder active={isActive || isInActivePath} />
            : <IconBriefcase active={isActive} />
          }
          <span className="flex-1 truncate leading-none">{node.name}</span>
          <span className={`text-[10.5px] tabular-nums shrink-0 ${isActive ? 'text-sky-500/70' : 'text-slate-400'}`}>
            {fmtCompact(node.aggregated_cash)}
          </span>
        </button>
      </div>

      {/* Children with guide line + subtle group shading */}
      {isExpandable && expanded && hasChildren && (
        <>
          <div
            className="absolute w-px bg-slate-200/60 pointer-events-none"
            style={{ left: depth * 20 + 28, top: 14, bottom: 6 }}
          />
          <SortableContext
            items={node.children.map(c => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="mt-0.5 rounded-sm bg-slate-50/30">
              <ul className="space-y-0.5">
                {node.children.map(child => (
                  <SortablePortfolioNode
                    key={child.id}
                    node={child}
                    depth={depth + 1}
                    parentId={node.id}
                    activeId={activeId}
                    dropState={dropState}
                    expandSet={expandSet}
                    ancestorIds={ancestorIds}
                  />
                ))}
              </ul>
            </div>
          </SortableContext>
        </>
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

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { portfolios, loading, fetchError, triggerRefresh, selectedPortfolioId } = usePortfolio()
  const { lang } = useLanguage()
  const {
    mode, isExpanded,
    pendingClose, alertPrefill,
    openTradeEntry,       exitTradeEntry,
    openPriceAlerts,      exitPriceAlerts,
    openPortfolioCreate,  exitPortfolioCreate,
    toggleExpand,
  } = useSidebar()

  const [activeId,         setActiveId]         = useState<number | null>(null)
  const [dropState,        setDropState]        = useState<DropState>(EMPTY_DROP)
  const [forceExpandedIds, setForceExpandedIds] = useState<ReadonlySet<number>>(new Set())
  const [moving,           setMoving]           = useState(false)
  const [showCreateMenu,   setShowCreateMenu]   = useState(false)
  const [createIsFolder,   setCreateIsFolder]   = useState(false)

  // Refs
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastOverIdRef = useRef<number | null>(null)
  const lastIntentRef = useRef<DropIntent | null>(null)
  const pointerYRef   = useRef(0)
  const createMenuRef = useRef<HTMLDivElement>(null)

  // Stable pointer tracker — used by add/removeEventListener
  const handlePointerMove = useCallback((e: PointerEvent) => {
    pointerYRef.current = e.clientY
  }, [])

  const isEn = lang !== 'zh'

  // Close create-type dropdown on outside click
  useEffect(() => {
    if (!showCreateMenu) return
    const handle = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setShowCreateMenu(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showCreateMenu])

  const handleCreateChoice = (isFolder: boolean) => {
    setCreateIsFolder(isFolder)
    setShowCreateMenu(false)
    openPortfolioCreate()
  }

  const handleTradeSuccess = () => {
    exitTradeEntry()
    triggerRefresh()
  }

  const isTradeMode  = mode === 'trade_entry'
  const isAlertsMode = mode === 'price_alerts'
  const isCreateMode = mode === 'portfolio_create'
  const isPinnedMode = isTradeMode || isAlertsMode || isCreateMode

  const sidebarWidth = isPinnedMode ? 520 : isExpanded ? 224 : 64

  const L = {
    newTrade:   lang === 'zh' ? '新建交易' : 'New Trade',
    priceAlerts:lang === 'zh' ? '价格警报' : 'Price Alerts',
    portfolios: lang === 'zh' ? '投资组合' : 'Portfolios',
    noPf:       lang === 'zh' ? '暂无组合' : 'No portfolios',
    back:       lang === 'zh' ? '返回'     : 'Back',
    close:      lang === 'zh' ? '平仓交易' : 'Close Position',
    alertsHdr:  lang === 'zh' ? '价格警报' : 'Price Alerts',
    collapse:   lang === 'zh' ? '折叠'     : 'Collapse',
    expand:     lang === 'zh' ? '展开'     : 'Expand',
    newPf:      lang === 'zh' ? '新建组合' : 'New Portfolio',
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

  // ── Ancestor IDs of the selected portfolio (for trail highlighting + auto-expand)
  const ancestorIds = useMemo<ReadonlySet<number>>(() => {
    const ids = new Set<number>()
    if (!selectedPortfolioId) return ids
    let cur = flatMap.get(selectedPortfolioId)
    while (cur?.parentId != null) {
      ids.add(cur.parentId)
      cur = flatMap.get(cur.parentId)
    }
    return ids
  }, [selectedPortfolioId, flatMap])

  // ── Drag handlers ────────────────────────────────────────────────────────────

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as number)
    setDropState(EMPTY_DROP)
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    lastOverIdRef.current = null
    lastIntentRef.current = null
    document.addEventListener('pointermove', handlePointerMove)
  }

  /**
   * Computes drop zone (top 25% = before, middle 50% = inside, bottom 25% = after)
   * from pointer Y vs target element rect. Manages 600ms auto-expand timer.
   */
  const handleDragOver = useCallback((e: DragOverEvent) => {
    const overId = e.over ? (e.over.id as number) : null

    if (overId === null) {
      setDropState(EMPTY_DROP)
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
      lastOverIdRef.current = null
      lastIntentRef.current = null
      return
    }

    const rect      = e.over!.rect
    const relY      = pointerYRef.current - rect.top
    const ratio     = rect.height > 0 ? relY / rect.height : 0.5
    const overNode  = flatMap.get(overId)?.node
    const activeItemId = e.active.id as number

    // Zone → intent; degrade 'inside' to before/after for non-folders
    let intent: DropIntent
    if      (ratio < 0.25) intent = 'before'
    else if (ratio > 0.75) intent = 'after'
    else    intent = overNode?.is_folder ? 'inside' : (ratio < 0.5 ? 'before' : 'after')

    // Validation: can't drop onto self, can't move folder into its own subtree
    const valid = overId !== activeItemId
      && !(intent === 'inside' && isDescendantOf(overId, activeItemId, flatMap))

    setDropState({ targetId: overId, intent, valid })

    // Restart 600ms auto-expand timer when target or intent changes
    const targetChanged = overId !== lastOverIdRef.current
    const intentChanged = intent !== lastIntentRef.current
    lastOverIdRef.current = overId
    lastIntentRef.current = intent

    if (targetChanged || intentChanged) {
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
      if (intent === 'inside' && overNode?.is_folder && valid) {
        hoverTimerRef.current = setTimeout(() => {
          setForceExpandedIds(prev => new Set([...prev, overId]))
        }, 600)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatMap])

  const handleDragEnd = async (e: DragEndEvent) => {
    document.removeEventListener('pointermove', handlePointerMove)
    setActiveId(null)
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    lastOverIdRef.current = null
    lastIntentRef.current = null

    // Capture drop state before clearing (avoids stale-closure issues)
    const { intent, targetId: _overId, valid } = dropState
    setDropState(EMPTY_DROP)
    setForceExpandedIds(new Set())

    const { active, over } = e
    if (!over || !intent || !valid || active.id === over.id || moving) return

    const activeEntry = flatMap.get(active.id as number)
    const overEntry   = flatMap.get(over.id as number)
    if (!activeEntry || !overEntry) return

    const activeParentId = activeEntry.parentId
    const overParentId   = overEntry.parentId

    setMoving(true)
    try {
      if (intent === 'inside') {
        // Move active into over (folder); backend handles cycle guard
        await movePortfolio(active.id as number, over.id as number, 0)
        triggerRefresh()

      } else if (activeParentId === overParentId) {
        // Same parent → batch sibling reorder
        const siblings = [...(siblingGroups.get(activeParentId) ?? [])]
        const oldIdx   = siblings.findIndex(p => p.id === active.id)
        if (oldIdx === -1) return
        const without   = siblings.filter(p => p.id !== active.id)
        const overIdx   = without.findIndex(p => p.id === over.id)
        if (overIdx === -1) return
        const insertAt  = intent === 'after' ? overIdx + 1 : overIdx
        without.splice(insertAt, 0, siblings[oldIdx])
        await batchReorderPortfolios(without.map((p, i) => ({ id: p.id, sort_order: i })))
        triggerRefresh()

      } else {
        // Cross-parent: move active to over's parent, at the indicated position
        const targetSiblings = siblingGroups.get(overParentId) ?? []
        const overIdx  = targetSiblings.findIndex(p => p.id === over.id)
        const insertAt = intent === 'after' ? overIdx + 1 : overIdx
        await movePortfolio(active.id as number, overParentId, insertAt)
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
            label={pendingClose ? L.close : L.newTrade}
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

      ) : isCreateMode ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 3c — PORTFOLIO CREATE  (520px)
         * ══════════════════════════════════════════════════════════════════ */
        <PortfolioCreatePanel onBack={exitPortfolioCreate} initialIsFolder={createIsFolder} />

      ) : isExpanded ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 2 — EXPANDED NAV  (224px)
         * ══════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pt-8">

          {/* Header row: label + new portfolio button + collapse toggle */}
          <div className="flex items-center gap-1 px-3 pb-2.5 shrink-0">
            <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 pl-0.5">
              {L.portfolios}
            </span>
            <div className="relative" ref={createMenuRef}>
              <button
                title={L.newPf}
                onClick={() => setShowCreateMenu(v => !v)}
                className={[
                  'flex items-center justify-center w-6 h-6 rounded-md transition-colors',
                  showCreateMenu
                    ? 'text-sky-600 bg-sky-100'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100',
                ].join(' ')}
              >
                <IconPlus />
              </button>
              {showCreateMenu && (
                <div className="absolute right-0 top-full mt-1.5 z-50
                                bg-white border border-slate-200 rounded-xl shadow-lg py-1
                                min-w-[164px]">
                  <button
                    onClick={() => handleCreateChoice(true)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2
                               text-[12.5px] font-medium text-slate-700
                               hover:bg-slate-50 transition-colors"
                  >
                    <IconFolder />
                    {isEn ? 'New Portfolio' : '新建组合'}
                  </button>
                  <button
                    onClick={() => handleCreateChoice(false)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2
                               text-[12.5px] font-medium text-slate-700
                               hover:bg-slate-50 transition-colors"
                  >
                    <IconBriefcase />
                    {isEn ? 'New Account' : '新建账户'}
                  </button>
                </div>
              )}
            </div>
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

          {/* Portfolio list with drag-and-drop */}
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
                onDragOver={handleDragOver}
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
                        dropState={dropState}
                        expandSet={forceExpandedIds}
                        ancestorIds={ancestorIds}
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

          <PortfolioBadge />
        </div>
      )}
    </aside>
  )
}
