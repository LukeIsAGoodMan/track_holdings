/**
 * Sidebar — Three-State Action Drawer (+ pinned-panel sub-states)
 *
 * State 1 — Collapsed         (64px):   icon-only column
 * State 2 — Expanded          (224px):  nav + static portfolio tree
 * State 3a — Trade Entry      (520px):  TradeEntryForm
 * State 3b — Price Alerts     (520px):  PriceAlertsSidebar
 * State 3c — Portfolio Create (520px):  PortfolioCreatePanel
 * State 3d — Portfolio Edit   (520px):  PortfolioEditPanel (rename + move + delete)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePortfolio }       from '@/context/PortfolioContext'
import { useLanguage }        from '@/context/LanguageContext'
import { useSidebar }         from '@/context/SidebarContext'
import TradeEntryForm         from '@/components/TradeEntryForm'
import PriceAlertsSidebar     from '@/components/PriceAlertsSidebar'
import { fmtCompact }         from '@/utils/format'
import { createPortfolio, movePortfolio, updatePortfolioName, deletePortfolio } from '@/api/holdings'
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

const IconWallet = ({ active }: { active?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 transition-colors ${active ? 'text-sky-500' : 'text-slate-400'}`}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
)

const IconBriefcase = ({ active }: { active?: boolean }) => (
  <svg
    className={`w-3.5 h-3.5 shrink-0 transition-colors ${active ? 'text-sky-500' : 'text-slate-400'}`}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    {/* Vault body */}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    {/* Dial ring */}
    <circle cx="12" cy="12" r="3.5" />
    {/* Dial tick */}
    <line x1="12" y1="8.5" x2="12" y2="10" />
    {/* Handle bar */}
    <line x1="15.5" y1="12" x2="17.5" y2="12" />
    {/* Hinge pins */}
    <line x1="3" y1="8" x2="5" y2="8" />
    <line x1="3" y1="16" x2="5" y2="16" />
  </svg>
)

const IconDots = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
)

// ── Portfolio tree helpers ─────────────────────────────────────────────────────

interface FolderOption { id: number; label: string }

function flattenFolders(nodes: Portfolio[], prefix = ''): FolderOption[] {
  const result: FolderOption[] = []
  for (const node of nodes) {
    if (node.is_folder) {
      const label = prefix ? `${prefix} › ${node.name}` : node.name
      result.push({ id: node.id, label })
      result.push(...flattenFolders(node.children, label))
    } else {
      result.push(...flattenFolders(node.children, prefix))
    }
  }
  return result
}

function collectDescendantIds(node: Portfolio): Set<number> {
  const ids = new Set<number>([node.id])
  const walk = (nodes: Portfolio[]) => {
    for (const n of nodes) { ids.add(n.id); walk(n.children) }
  }
  walk(node.children)
  return ids
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

function PortfolioCreatePanel({
  onBack,
  initialIsFolder = false,
  initialParentId = null,
}: {
  onBack:           () => void
  initialIsFolder?: boolean
  initialParentId?: number | null
}) {
  const { portfolios, triggerRefresh } = usePortfolio()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const [name,     setName]     = useState('')
  const [parentId, setParentId] = useState<number | null>(initialParentId)
  const [isFolder, setIsFolder] = useState(initialIsFolder)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameRef.current?.focus() }, [])

  const folderOptions = useMemo(() => flattenFolders(portfolios), [portfolios])

  const handleSubmit = useCallback(async (e: React.SyntheticEvent<HTMLFormElement>) => {
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
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        setError(isEn ? 'Name already taken — choose a different name' : '名称已被占用，请换一个名称')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        setError(isEn ? `Failed: ${msg}` : `创建失败：${msg}`)
      }
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

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
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
                <IconWallet active={isFolder} />
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
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider
                               text-slate-400 mb-1.5">
              {L.parentLbl}
            </label>
            {initialParentId !== null ? (
              <div className="w-full rounded-xl border border-slate-200 bg-slate-100
                              px-3.5 py-2.5 text-[13px] text-slate-500 flex items-center gap-2">
                <IconWallet />
                <span className="truncate">
                  {folderOptions.find(f => f.id === initialParentId)?.label ?? `#${initialParentId}`}
                </span>
                <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                  {isEn ? 'locked' : '已锁定'}
                </span>
              </div>
            ) : (
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
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2
                             w-3.5 h-3.5 text-slate-400"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            )}
          </div>

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

// ── Portfolio Tree Node (static, no DnD) ──────────────────────────────────────

function PortfolioTreeNode({
  node,
  depth = 0,
  ancestorIds,
}: {
  node:        Portfolio
  depth?:      number
  ancestorIds: ReadonlySet<number>
}) {
  const { selectedPortfolioId, setSelectedPortfolioId } = usePortfolio()
  const { openPortfolioEdit } = useSidebar()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const isActive       = selectedPortfolioId === node.id
  const isInActivePath = ancestorIds.has(node.id)
  const hasChildren    = node.children.length > 0
  const isExpandable   = hasChildren || node.is_folder

  const [expanded, setExpanded] = useState(true)

  // Auto-expand when this node is on the active selection trail
  useEffect(() => { if (isInActivePath) setExpanded(true) }, [isInActivePath])

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
    <li className="group relative">
      <div
        className="relative flex items-center gap-0.5 rounded-lg transition-all duration-150"
        style={{ paddingLeft: depth * 20 }}
      >
        {/* Expand / collapse chevron */}
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

        {/* Select button */}
        <button
          onClick={() => setSelectedPortfolioId(node.id)}
          title={node.name}
          className={btnClass}
        >
          {node.is_folder
            ? <IconWallet active={isActive || isInActivePath} />
            : <IconBriefcase active={isActive} />
          }
          <span className="flex-1 truncate leading-none">{node.name}</span>
          {Number(node.aggregated_cash) !== 0 && (
            <span className={`text-[10.5px] tabular-nums shrink-0 ${isActive ? 'text-sky-500/70' : 'text-slate-400'}`}>
              {fmtCompact(node.aggregated_cash)}
            </span>
          )}
        </button>

        {/* ⋯ actions button */}
        <button
          onClick={e => { e.stopPropagation(); openPortfolioEdit(node) }}
          title={isEn ? 'Actions' : '操作'}
          className={[
            'flex items-center justify-center w-6 h-6 rounded shrink-0',
            'text-slate-300 hover:text-slate-600 hover:bg-slate-100',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
          ].join(' ')}
        >
          <IconDots />
        </button>
      </div>

      {/* Children with indent guide line */}
      {isExpandable && expanded && hasChildren && (
        <>
          <div
            className="absolute w-px bg-slate-200/60 pointer-events-none"
            style={{ left: depth * 20 + 24, top: 14, bottom: 6 }}
          />
          <div className="mt-0.5 rounded-sm bg-slate-50/30">
            <ul className="space-y-0.5">
              {node.children.map(child => (
                <PortfolioTreeNode
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  ancestorIds={ancestorIds}
                />
              ))}
            </ul>
          </div>
        </>
      )}
    </li>
  )
}

// ── Portfolio Edit Panel (State 3d) ───────────────────────────────────────────

function PortfolioEditPanel({
  target,
  onBack,
  onAddChild,
}: {
  target:     Portfolio
  onBack:     () => void
  onAddChild: (parentId: number, isFolder: boolean) => void
}) {
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId, triggerRefresh } = usePortfolio()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  // ── Rename state ──────────────────────────────────────────────────────────
  const [name,         setName]         = useState(target.name)
  const [renameError,  setRenameError]  = useState<string | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)
  const [renamed,      setRenamed]      = useState(false)

  // ── Move state ────────────────────────────────────────────────────────────
  const [moveParentId, setMoveParentId] = useState<number | null>(target.parent_id)
  const [moveSaving,   setMoveSaving]   = useState(false)
  const [moveError,    setMoveError]    = useState<string | null>(null)
  const [moveSaved,    setMoveSaved]    = useState(false)

  // ── Delete state ──────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Sync if the same panel is reused for a different target
  useEffect(() => {
    setName(target.name)
    setRenamed(false)
    setRenameError(null)
    setMoveParentId(target.parent_id)
    setMoveSaved(false)
    setMoveError(null)
  }, [target.id, target.name, target.parent_id])

  // Folder options for "Move to" — exclude the target itself and all its descendants
  const descendantIds = useMemo(() => collectDescendantIds(target), [target])

  const folderOptions = useMemo(
    () => flattenFolders(portfolios).filter(f => !descendantIds.has(f.id)),
    [portfolios, descendantIds],
  )

  const submitRename = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === target.name) return
    setRenameSaving(true)
    setRenameError(null)
    try {
      await updatePortfolioName(target.id, trimmed)
      triggerRefresh()
      setRenamed(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setRenameError(
        msg.includes('409') || msg.includes('already')
          ? (isEn ? 'Name already taken' : '名称已存在')
          : (isEn ? 'Save failed' : '保存失败'),
      )
    } finally {
      setRenameSaving(false)
    }
  }

  const submitMove = async () => {
    if (moveParentId === target.parent_id) return
    setMoveSaving(true)
    setMoveError(null)
    try {
      await movePortfolio(target.id, moveParentId, 0)
      triggerRefresh()
      setMoveSaved(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMoveError(
        msg.includes('400') || msg.includes('cycle')
          ? (isEn ? 'Cannot move into a descendant' : '无法移入子节点')
          : (isEn ? `Move failed: ${msg}` : `移动失败：${msg}`),
      )
    } finally {
      setMoveSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleteLoading(true)
    try {
      await deletePortfolio(target.id)
      if (selectedPortfolioId === target.id) setSelectedPortfolioId(null)
      triggerRefresh()
      onBack()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setDeleteLoading(false)
    }
  }

  const isFolder    = target.is_folder
  const hasChildren = target.children.length > 0

  const moveChanged = moveParentId !== target.parent_id

  const L = {
    hdr:        isEn ? (isFolder ? 'Edit Portfolio' : 'Edit Account') : (isFolder ? '编辑组合' : '编辑账户'),
    back:       isEn ? 'Back'         : '返回',
    nameLbl:    isEn ? 'Name'         : '名称',
    save:       isEn ? 'Save'         : '保存',
    saving:     isEn ? 'Saving…'      : '保存中…',
    saved:      isEn ? 'Saved!'       : '已保存！',
    locationLbl:isEn ? 'Location'     : '位置',
    noParent:   isEn ? '— Root level (no parent) —' : '— 根层级（无父组合）—',
    move:       isEn ? 'Move'         : '移动',
    moving:     isEn ? 'Moving…'      : '移动中…',
    moved:      isEn ? 'Moved!'       : '已移动！',
    addChild:   isEn ? 'Add Child'    : '添加子项',
    addPf:      isEn ? 'Portfolio'    : '组合',
    addAcct:    isEn ? 'Account'      : '账户',
    danger:     isEn ? 'Danger Zone'  : '危险操作',
    deleteBtn:  isEn ? (isFolder ? 'Delete Portfolio' : 'Delete Account') : '删除',
    deleting:   isEn ? 'Deleting…'   : '删除中…',
    confirmMsg: isFolder && hasChildren
      ? isEn
        ? `"${target.name}" contains sub-portfolios. All nested items, trades, and cash will be permanently deleted.`
        : `"${target.name}" 包含子组合。所有嵌套项目、交易记录和资金将被永久删除。`
      : isEn
        ? `Permanently delete "${target.name}" and all its trades and cash? Cannot be undone.`
        : `永久删除"${target.name}"及其所有交易和资金？此操作无法撤销。`,
    confirmYes: isEn ? 'Confirm Delete' : '确认删除',
    confirmNo:  isEn ? 'Cancel'         : '取消',
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader label={L.hdr} sublabel={name.trim() || target.name} onBack={onBack} backTitle={L.back} />

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-5 space-y-6">

          {/* ── Rename ──────────────────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider
                               text-slate-400 mb-1.5">
              {L.nameLbl}
            </label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={e => { setName(e.target.value); setRenameError(null); setRenamed(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitRename() } }}
                maxLength={100}
                className={[
                  'flex-1 rounded-xl border px-3.5 py-2.5',
                  'text-[13px] text-slate-900 bg-slate-50',
                  'focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-sky-400',
                  'transition',
                  renameError ? 'border-rose-400' : 'border-slate-200',
                ].join(' ')}
              />
              <button
                onClick={submitRename}
                disabled={renameSaving || !name.trim() || name.trim() === target.name}
                className="shrink-0 rounded-xl bg-sky-500 px-4 py-2.5
                           text-[13px] font-semibold text-white
                           hover:bg-sky-600 active:bg-sky-700
                           disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {renameSaving ? L.saving : renamed ? L.saved : L.save}
              </button>
            </div>
            {renameError && (
              <p className="mt-1.5 text-[11.5px] text-rose-500">{renameError}</p>
            )}
          </div>

          {/* ── Location / Move ───────────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider
                               text-slate-400 mb-1.5">
              {L.locationLbl}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <select
                  value={moveParentId ?? ''}
                  onChange={e => {
                    setMoveParentId(e.target.value === '' ? null : Number(e.target.value))
                    setMoveSaved(false)
                    setMoveError(null)
                  }}
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
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2
                             w-3.5 h-3.5 text-slate-400"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
              <button
                onClick={submitMove}
                disabled={moveSaving || !moveChanged}
                className="shrink-0 rounded-xl bg-sky-500 px-4 py-2.5
                           text-[13px] font-semibold text-white
                           hover:bg-sky-600 active:bg-sky-700
                           disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {moveSaving ? L.moving : moveSaved ? L.moved : L.move}
              </button>
            </div>
            {moveError && (
              <p className="mt-1.5 text-[11.5px] text-rose-500">{moveError}</p>
            )}
          </div>

          {/* ── Add Child (folders only) ─────────────────────────────────── */}
          {isFolder && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider
                                 text-slate-400 mb-1.5">
                {L.addChild}
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => onAddChild(target.id, true)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl
                             border border-slate-200 py-2.5
                             text-[12.5px] font-semibold text-slate-700
                             hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700
                             transition"
                >
                  <IconWallet />
                  {L.addPf}
                </button>
                <button
                  onClick={() => onAddChild(target.id, false)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl
                             border border-slate-200 py-2.5
                             text-[12.5px] font-semibold text-slate-700
                             hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700
                             transition"
                >
                  <IconBriefcase />
                  {L.addAcct}
                </button>
              </div>
            </div>
          )}

          {/* ── Danger Zone ──────────────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider
                               text-slate-400 mb-1.5">
              {L.danger}
            </label>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full rounded-xl border border-rose-200 py-2.5
                           text-[13px] font-semibold text-rose-600
                           hover:bg-rose-50 hover:border-rose-300 transition"
              >
                {L.deleteBtn}
              </button>
            ) : (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-3">
                <p className="text-[12px] text-rose-700 leading-relaxed">{L.confirmMsg}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleteLoading}
                    className="flex-1 rounded-xl border border-slate-200 bg-white py-2
                               text-[12.5px] font-semibold text-slate-600
                               hover:bg-slate-50 disabled:opacity-50 transition"
                  >
                    {L.confirmNo}
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteLoading}
                    className="flex-1 rounded-xl bg-rose-500 py-2
                               text-[12.5px] font-semibold text-white
                               hover:bg-rose-600 disabled:opacity-50 transition"
                  >
                    {deleteLoading ? L.deleting : L.confirmYes}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
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
    pendingClose, alertPrefill, editTarget,
    openTradeEntry,       exitTradeEntry,
    openPriceAlerts,      exitPriceAlerts,
    openPortfolioCreate,  exitPortfolioCreate,
    exitPortfolioEdit,
    toggleExpand,
  } = useSidebar()

  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [createIsFolder, setCreateIsFolder] = useState(false)
  const [createParentId, setCreateParentId] = useState<number | null>(null)

  const createMenuRef = useRef<HTMLDivElement>(null)

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

  const handleAddChild = (pId: number, isFolder: boolean) => {
    exitPortfolioEdit()
    setCreateParentId(pId)
    setCreateIsFolder(isFolder)
    openPortfolioCreate()
  }

  // Ancestor IDs of the selected portfolio (for trail highlighting + auto-expand)
  const flatMap = useMemo(() => {
    const map = new Map<number, { node: Portfolio; parentId: number | null }>()
    const walk = (nodes: Portfolio[], pId: number | null) => {
      nodes.forEach(n => { map.set(n.id, { node: n, parentId: pId }); walk(n.children, n.id) })
    }
    walk(portfolios, null)
    return map
  }, [portfolios])

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

  const isTradeMode  = mode === 'trade_entry'
  const isAlertsMode = mode === 'price_alerts'
  const isCreateMode = mode === 'portfolio_create'
  const isEditMode   = mode === 'portfolio_edit'
  const isPinnedMode = isTradeMode || isAlertsMode || isCreateMode || isEditMode

  const sidebarWidth = isPinnedMode ? 580 : isExpanded ? 340 : 64

  const L = {
    newTrade:   lang === 'zh' ? '新建交易'       : 'New Trade',
    priceAlerts:lang === 'zh' ? '价格警报'       : 'Price Alerts',
    portfolios: lang === 'zh' ? '投资组合'       : 'Portfolios',
    noPf:       lang === 'zh' ? '暂无组合'       : 'No portfolios',
    back:       lang === 'zh' ? '返回'           : 'Back',
    close:      lang === 'zh' ? '平仓交易'       : 'Close Position',
    alertsHdr:  lang === 'zh' ? '价格警报'       : 'Price Alerts',
    collapse:   lang === 'zh' ? '折叠'           : 'Collapse',
    expand:     lang === 'zh' ? '展开'           : 'Expand',
    newPfCard:  lang === 'zh' ? '新建组合 / 账户' : 'New Portfolio / Account',
  }

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
         * STATE 3a — TRADE ENTRY  (580px)
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
         * STATE 3b — PRICE ALERTS  (580px)
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
         * STATE 3c — PORTFOLIO CREATE  (580px)
         * ══════════════════════════════════════════════════════════════════ */
        <PortfolioCreatePanel
          onBack={() => { setCreateParentId(null); exitPortfolioCreate() }}
          initialIsFolder={createIsFolder}
          initialParentId={createParentId}
        />

      ) : isEditMode && editTarget ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 3d — PORTFOLIO EDIT  (580px)
         * ══════════════════════════════════════════════════════════════════ */
        <PortfolioEditPanel
          target={editTarget}
          onBack={exitPortfolioEdit}
          onAddChild={handleAddChild}
        />

      ) : isExpanded ? (
        /* ══════════════════════════════════════════════════════════════════
         * STATE 2 — EXPANDED NAV  (340px)
         * ══════════════════════════════════════════════════════════════════ */
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pt-8">

          {/* Header row: label + collapse toggle */}
          <div className="flex items-center gap-1 px-4 pb-2.5 shrink-0">
            <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 pl-0.5">
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

          {/* Action cards */}
          <div className="px-4 pb-2 shrink-0 space-y-1.5">

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

            {/* New Portfolio / Account card */}
            <button
              onClick={() => { setCreateParentId(null); setCreateIsFolder(false); openPortfolioCreate() }}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl
                         bg-white border border-slate-200 shadow-sm
                         text-[13px] font-semibold text-slate-700
                         hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700
                         hover:shadow-md active:shadow-none
                         transition-all duration-150 group"
            >
              <span className="w-6 h-6 rounded-lg bg-sky-100 flex items-center justify-center
                               shrink-0 group-hover:bg-sky-200 transition-colors text-sky-500">
                <IconWallet />
              </span>
              {L.newPfCard}
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
          <div className="mx-4 h-px bg-slate-100 mb-3 shrink-0" />

          {/* Portfolio tree */}
          <div className="px-3 pt-2 pb-8 space-y-0.5">
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
              <div className="py-8 px-3 text-center">
                <div className="flex justify-center mb-2 text-slate-300">
                  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                </div>
                <p className="text-[12px] font-medium text-slate-400">{L.noPf}</p>
                <p className="mt-1 text-[11px] text-slate-300 leading-snug">
                  {isEn
                    ? 'Create your first portfolio to organize accounts and strategies'
                    : '创建第一个组合来组织账户和策略'}
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {portfolios.map(p => (
                  <PortfolioTreeNode
                    key={p.id}
                    node={p}
                    depth={0}
                    ancestorIds={ancestorIds}
                  />
                ))}
              </ul>
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

          {/* Portfolio create — collapsed: dropdown with New Portfolio / New Account */}
          <div className="relative" ref={createMenuRef}>
            <button
              onClick={() => setShowCreateMenu(v => !v)}
              title={L.newPfCard}
              className={[
                'w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-sm',
                showCreateMenu
                  ? 'bg-sky-200 text-sky-700'
                  : 'bg-sky-100 text-sky-600 hover:bg-sky-200 hover:text-sky-700',
              ].join(' ')}
            >
              <IconWallet />
            </button>
            {showCreateMenu && (
              <div className="absolute left-full ml-2 top-0 z-50
                              bg-white border border-slate-200 rounded-xl shadow-lg py-1
                              min-w-[172px]">
                <button
                  onClick={() => handleCreateChoice(true)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2
                             text-[12.5px] font-medium text-slate-700
                             hover:bg-slate-50 transition-colors"
                >
                  <IconWallet />
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
