/**
 * CreatePortfolioModal — Phase 16B
 *
 * Lets the user create either:
 *   - A folder (is_folder=true)  → container for grouping sub-portfolios
 *   - An account (is_folder=false) → actual trading account with holdings
 *
 * Parent dropdown shows only is_folder=true portfolios; root-level is the
 * default (no parent).
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { usePortfolio }    from '@/context/PortfolioContext'
import { useLanguage }     from '@/context/LanguageContext'
import { createPortfolio } from '@/api/holdings'
import type { Portfolio }  from '@/types'

interface Props {
  onClose: () => void
}

// Recursively flatten the tree to a flat list
function flatten(nodes: Portfolio[]): Portfolio[] {
  const acc: Portfolio[] = []
  const walk = (ps: Portfolio[]) =>
    ps.forEach(p => { acc.push(p); walk(p.children) })
  walk(nodes)
  return acc
}

export default function CreatePortfolioModal({ onClose }: Props) {
  const { portfolios, triggerRefresh } = usePortfolio()
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const [name,      setName]      = useState('')
  const [parentId,  setParentId]  = useState<number | null>(null)
  const [isFolder,  setIsFolder]  = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameRef.current?.focus() }, [])

  // Folders available as parent choices
  const folderOptions = useMemo(
    () => flatten(portfolios).filter(p => p.is_folder),
    [portfolios],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    try {
      await createPortfolio({
        name:      trimmed,
        parent_id: parentId ?? null,
        is_folder: isFolder,
      })
      triggerRefresh()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(isEn ? `Failed: ${msg}` : `创建失败：${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const L = {
    title:    isEn ? 'New Portfolio'    : '新建组合',
    nameLbl:  isEn ? 'Name'             : '名称',
    namePh:   isEn ? 'e.g. NVDA Wheel' : '例：NVDA 轮动策略',
    parentLbl:isEn ? 'Parent Folder'   : '父文件夹',
    noParent: isEn ? '— Root level —'  : '— 根层级 —',
    folderLbl:isEn ? 'Folder (container)' : '文件夹（容器）',
    folderSub:isEn ? 'Groups sub-portfolios; no direct trades' : '用于组织子组合，不直接持仓',
    cancel:   isEn ? 'Cancel'          : '取消',
    create:   isEn ? 'Create'          : '创建',
    creating: isEn ? 'Creating…'       : '创建中…',
  }

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-[15px] font-bold text-slate-900">{L.title}</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">

          {/* Name */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {L.nameLbl}
            </label>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={L.namePh}
              maxLength={100}
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50
                         px-3.5 py-2.5 text-[13px] text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-sky-400
                         transition"
            />
          </div>

          {/* Parent folder select */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {L.parentLbl}
            </label>
            <select
              value={parentId ?? ''}
              onChange={e => setParentId(e.target.value === '' ? null : Number(e.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-slate-50
                         px-3.5 py-2.5 text-[13px] text-slate-900
                         focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-sky-400
                         transition appearance-none cursor-pointer"
            >
              <option value="">{L.noParent}</option>
              {folderOptions.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* is_folder toggle */}
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <div className="relative mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={isFolder}
                onChange={e => setIsFolder(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5.5 rounded-full bg-slate-200 peer-checked:bg-sky-500
                              transition-colors duration-200" />
              <div className="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow
                              peer-checked:translate-x-4.5 transition-transform duration-200" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-slate-800 group-hover:text-slate-900">
                {L.folderLbl}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{L.folderSub}</div>
            </div>
          </label>

          {/* Error */}
          {error && (
            <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold
                         text-slate-600 hover:bg-slate-50 transition"
            >
              {L.cancel}
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 rounded-xl bg-sky-500 py-2.5 text-[13px] font-semibold
                         text-white hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed
                         transition shadow-sm"
            >
              {loading ? L.creating : L.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
