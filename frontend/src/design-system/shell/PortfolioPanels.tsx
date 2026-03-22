/**
 * PortfolioPanels — Create + Edit portfolio panels for V2 action panel.
 *
 * Ported from V1 (components/layout/Sidebar.tsx) with V2 visual adaptation.
 * Logic, flows, and state handling are IDENTICAL to V1.
 * Only visual styling adapted to warm silver shell language.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import { createPortfolio, updatePortfolioName, movePortfolio, deletePortfolio } from '@/api/holdings'
import type { Portfolio } from '@/types'

// ── Helpers (from V1) ───────────────────────────────────────────────────────

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

// ── Shared panel header ─────────────────────────────────────────────────────

function PanelHeader({ label, sublabel, onBack }: {
  label: string; sublabel?: string; onBack: () => void
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-2">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 ds-color"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
      <div className="flex-1 min-w-0 text-right">
        <span className="text-sm font-medium text-stone-700">{label}</span>
        {sublabel && <span className="text-xs text-stone-400 ml-2 truncate">{sublabel}</span>}
      </div>
    </div>
  )
}

// ── Shared form styles ──────────────────────────────────────────────────────

const inputCls = `w-full rounded-v2-md border border-stone-200 bg-white
                  px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400
                  focus:outline-none focus:ring-1 focus:ring-stone-400/30 focus:border-stone-300`

const btnPrimary = `rounded-v2-md bg-stone-700 px-4 py-2
                    text-sm font-medium text-white
                    hover:bg-stone-800 active:bg-stone-900
                    disabled:opacity-40 disabled:cursor-not-allowed ds-color`

const labelCls = 'block text-xs font-medium uppercase tracking-wider text-stone-400 mb-1.5'

// ═══ CREATE PANEL ═══════════════════════════════════════════════════════════

export function PortfolioCreatePanel({
  onBack,
  initialIsFolder = false,
  initialParentId = null,
}: {
  onBack: () => void
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
    setLoading(true); setError(null)
    try {
      await createPortfolio({ name: trimmed, parent_id: parentId, is_folder: isFolder })
      triggerRefresh(); onBack()
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) setError(isEn ? 'Name already taken' : '名称已被占用')
      else setError(isEn ? 'Creation failed' : '创建失败')
    } finally { setLoading(false) }
  }, [name, parentId, isFolder, isEn, triggerRefresh, onBack])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader
        label={isFolder ? (isEn ? 'New Portfolio' : '新建组合') : (isEn ? 'New Account' : '新建账户')}
        onBack={onBack}
      />
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-4">

          {/* Name */}
          <div>
            <label className={labelCls}>{isEn ? 'Name' : '名称'}</label>
            <input
              ref={nameRef}
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder={isEn ? 'e.g. NVDA Wheel' : '例：NVDA 轮动策略'}
              maxLength={100}
              required
              className={inputCls}
            />
          </div>

          {/* Type toggle */}
          <div>
            <label className={labelCls}>{isEn ? 'Type' : '类型'}</label>
            <div className="flex rounded-v2-md border border-stone-200 bg-stone-50 p-0.5 gap-0.5">
              {[false, true].map(folder => (
                <button
                  key={String(folder)}
                  type="button"
                  onClick={() => setIsFolder(folder)}
                  className={`flex-1 py-2 rounded-v2-sm text-xs font-medium ds-color ${
                    isFolder === folder
                      ? 'bg-white text-stone-800 shadow-sm'
                      : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  {folder ? (isEn ? 'Portfolio' : '组合') : (isEn ? 'Account' : '账户')}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-400">
              {isFolder
                ? (isEn ? 'Groups sub-portfolios; no direct trades.' : '用于组织子组合，不直接持仓。')
                : (isEn ? 'Trading account with holdings.' : '持有仓位并可记录交易。')
              }
            </p>
          </div>

          {/* Parent */}
          <div>
            <label className={labelCls}>{isEn ? 'Parent' : '父组合'}</label>
            {initialParentId !== null ? (
              <div className={`${inputCls} bg-stone-50 text-stone-500 flex items-center justify-between`}>
                <span className="truncate">{folderOptions.find(f => f.id === initialParentId)?.label ?? `#${initialParentId}`}</span>
                <span className="text-xs text-stone-400 shrink-0">{isEn ? 'locked' : '已锁定'}</span>
              </div>
            ) : (
              <select
                value={parentId ?? ''}
                onChange={e => setParentId(e.target.value === '' ? null : Number(e.target.value))}
                className={`${inputCls} cursor-pointer`}
              >
                <option value="">{isEn ? '— Root level —' : '— 根层级 —'}</option>
                {folderOptions.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-v2-negative bg-v2-negative-bg border border-v2-negative/20 rounded-v2-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button type="submit" disabled={loading || !name.trim()} className={btnPrimary + ' w-full'}>
            {loading ? (isEn ? 'Creating…' : '创建中…') : (isEn ? 'Create' : '创建')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ═══ EDIT PANEL ═════════════════════════════════════════════════════════════

export function PortfolioEditPanel({
  target,
  onBack,
  onAddChild,
}: {
  target: Portfolio
  onBack: () => void
  onAddChild: (parentId: number, isFolder: boolean) => void
}) {
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId, triggerRefresh } = usePortfolio()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const [name, setName] = useState(target.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)
  const [renamed, setRenamed] = useState(false)

  const [moveParentId, setMoveParentId] = useState<number | null>(target.parent_id)
  const [moveSaving, setMoveSaving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moveSaved, setMoveSaved] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    setName(target.name); setRenamed(false); setRenameError(null)
    setMoveParentId(target.parent_id); setMoveSaved(false); setMoveError(null)
  }, [target.id, target.name, target.parent_id])

  const descendantIds = useMemo(() => collectDescendantIds(target), [target])
  const folderOptions = useMemo(
    () => flattenFolders(portfolios).filter(f => !descendantIds.has(f.id)),
    [portfolios, descendantIds],
  )

  const submitRename = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === target.name) return
    setRenameSaving(true); setRenameError(null)
    try {
      await updatePortfolioName(target.id, trimmed)
      triggerRefresh(); setRenamed(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setRenameError(msg.includes('409') || msg.includes('already') ? (isEn ? 'Name taken' : '名称已存在') : (isEn ? 'Save failed' : '保存失败'))
    } finally { setRenameSaving(false) }
  }

  const submitMove = async () => {
    if (moveParentId === target.parent_id) return
    setMoveSaving(true); setMoveError(null)
    try {
      await movePortfolio(target.id, moveParentId, 0)
      triggerRefresh(); setMoveSaved(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMoveError(msg.includes('cycle') ? (isEn ? 'Cannot move into descendant' : '无法移入子节点') : (isEn ? 'Move failed' : '移动失败'))
    } finally { setMoveSaving(false) }
  }

  const handleDelete = async () => {
    setDeleteLoading(true)
    try {
      await deletePortfolio(target.id)
      if (selectedPortfolioId === target.id) setSelectedPortfolioId(null)
      triggerRefresh(); onBack()
    } catch { /* logged */ } finally { setDeleteLoading(false) }
  }

  const isFolder = target.is_folder
  const hasChildren = target.children.length > 0
  const moveChanged = moveParentId !== target.parent_id

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader
        label={isEn ? (isFolder ? 'Edit Portfolio' : 'Edit Account') : (isFolder ? '编辑组合' : '编辑账户')}
        sublabel={name.trim() || target.name}
        onBack={onBack}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-5">

          {/* Rename */}
          <div>
            <label className={labelCls}>{isEn ? 'Name' : '名称'}</label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={e => { setName(e.target.value); setRenameError(null); setRenamed(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitRename() } }}
                maxLength={100}
                className={`flex-1 ${inputCls} ${renameError ? 'border-v2-negative' : ''}`}
              />
              <button
                onClick={submitRename}
                disabled={renameSaving || !name.trim() || name.trim() === target.name}
                className={btnPrimary + ' shrink-0'}
              >
                {renameSaving ? (isEn ? 'Saving…' : '保存中…') : renamed ? (isEn ? 'Saved!' : '已保存！') : (isEn ? 'Save' : '保存')}
              </button>
            </div>
            {renameError && <p className="mt-1 text-xs text-v2-negative">{renameError}</p>}
          </div>

          {/* Move */}
          <div>
            <label className={labelCls}>{isEn ? 'Location' : '位置'}</label>
            <div className="flex gap-2">
              <select
                value={moveParentId ?? ''}
                onChange={e => { setMoveParentId(e.target.value === '' ? null : Number(e.target.value)); setMoveSaved(false); setMoveError(null) }}
                className={`flex-1 ${inputCls} cursor-pointer`}
              >
                <option value="">{isEn ? '— Root level —' : '— 根层级 —'}</option>
                {folderOptions.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <button onClick={submitMove} disabled={moveSaving || !moveChanged} className={btnPrimary + ' shrink-0'}>
                {moveSaving ? (isEn ? 'Moving…' : '移动中…') : moveSaved ? (isEn ? 'Moved!' : '已移动！') : (isEn ? 'Move' : '移动')}
              </button>
            </div>
            {moveError && <p className="mt-1 text-xs text-v2-negative">{moveError}</p>}
          </div>

          {/* Add child (folders only) */}
          {isFolder && (
            <div>
              <label className={labelCls}>{isEn ? 'Add Child' : '添加子项'}</label>
              <div className="flex gap-2">
                <button onClick={() => onAddChild(target.id, true)}
                  className="flex-1 rounded-v2-md border border-stone-200 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 ds-color">
                  {isEn ? 'Portfolio' : '组合'}
                </button>
                <button onClick={() => onAddChild(target.id, false)}
                  className="flex-1 rounded-v2-md border border-stone-200 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 ds-color">
                  {isEn ? 'Account' : '账户'}
                </button>
              </div>
            </div>
          )}

          {/* Danger zone */}
          <div>
            <label className={labelCls}>{isEn ? 'Danger Zone' : '危险操作'}</label>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="w-full rounded-v2-md border border-v2-negative/20 py-2 text-xs font-medium text-v2-negative hover:bg-v2-negative-bg ds-color">
                {isEn ? (isFolder ? 'Delete Portfolio' : 'Delete Account') : '删除'}
              </button>
            ) : (
              <div className="rounded-v2-md border border-v2-negative/20 bg-v2-negative-bg p-3 space-y-2">
                <p className="text-xs text-v2-negative leading-relaxed">
                  {isFolder && hasChildren
                    ? (isEn ? `"${target.name}" contains sub-portfolios. All will be permanently deleted.` : `"${target.name}" 包含子组合，所有内容将被永久删除。`)
                    : (isEn ? `Permanently delete "${target.name}"? Cannot be undone.` : `永久删除"${target.name}"？此操作无法撤销。`)
                  }
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} disabled={deleteLoading}
                    className="flex-1 rounded-v2-md border border-stone-200 bg-white py-1.5 text-xs font-medium text-stone-600 ds-color">
                    {isEn ? 'Cancel' : '取消'}
                  </button>
                  <button onClick={handleDelete} disabled={deleteLoading}
                    className="flex-1 rounded-v2-md bg-v2-negative py-1.5 text-xs font-medium text-white ds-color disabled:opacity-50">
                    {deleteLoading ? (isEn ? 'Deleting…' : '删除中…') : (isEn ? 'Confirm Delete' : '确认删除')}
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
