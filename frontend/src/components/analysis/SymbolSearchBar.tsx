/**
 * Symbol search bar with dropdown autocomplete for the Analysis page.
 * Mirrors the SymbolAutocomplete pattern from TradeEntryForm:
 *   debounced search → dropdown suggestions → keyboard nav → onSearch(symbol).
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { searchSymbols } from '@/api/holdings'
import type { SymbolSuggestion } from '@/types'

const ASSET_CLASS_STYLE: Record<string, string> = {
  stock:  'bg-blue-50    text-blue-600    border-blue-200',
  etf:    'bg-emerald-50 text-emerald-600 border-emerald-200',
  index:  'bg-amber-50   text-amber-600   border-amber-200',
  crypto: 'bg-violet-50  text-violet-600  border-violet-200',
  option: 'bg-rose-50    text-rose-600    border-rose-200',
}
const ASSET_CLASS_LABEL: Record<string, string> = {
  stock: 'Stock', etf: 'ETF', index: 'Index', crypto: 'Crypto', option: 'Option',
}

interface Props {
  onSearch: (symbol: string) => void
  loading: boolean
}

export default function SymbolSearchBar({ onSearch, loading }: Props) {
  const { t } = useLanguage()
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleInput = useCallback((raw: string) => {
    const upper = raw.toUpperCase()
    setValue(upper)
    setHighlighted(-1)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (upper.length < 1) { setSuggestions([]); setOpen(false); return }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchSymbols(upper)
        setSuggestions(res)
        setOpen(res.length > 0)
      } catch {
        setSuggestions([]); setOpen(false)
      }
    }, 220)
  }, [])

  const select = useCallback((sym: string) => {
    setValue(sym)
    setSuggestions([])
    setOpen(false)
    onSearch(sym)
  }, [onSearch])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (open && highlighted >= 0 && highlighted < suggestions.length) {
      select(suggestions[highlighted].symbol)
      return
    }
    const sym = value.trim().toUpperCase()
    if (sym) {
      setOpen(false)
      onSearch(sym)
    }
  }, [value, onSearch, open, highlighted, suggestions, select])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(i => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
    }
  }, [open, suggestions.length])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <div className="relative flex-1 max-w-md" ref={containerRef}>
        {/* Search icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path
            fillRule="evenodd" clipRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={t('analysis_search_ph')}
          className="w-full pl-10 pr-4 py-2.5 sm:py-3 text-sm rounded-xl border border-slate-200
                     bg-white text-slate-800 placeholder:text-slate-400 font-mono uppercase
                     focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                     transition-shadow appearance-none"
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Dropdown suggestions */}
        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl shadow-lg
                          border border-slate-200 backdrop-blur-md bg-white/90 overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={s.symbol}
                type="button"
                onMouseDown={e => { e.preventDefault(); select(s.symbol) }}
                onMouseEnter={() => setHighlighted(i)}
                className={`w-full flex items-center justify-between px-3 py-2 sm:py-2.5 text-left
                           transition-colors first:rounded-t-xl last:rounded-b-xl
                           ${i === highlighted ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <div className="min-w-0 mr-2">
                  <div className="font-mono font-bold text-[12px] text-slate-800">{s.symbol}</div>
                  {s.name && (
                    <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{s.name}</div>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ASSET_CLASS_STYLE[s.type] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  {ASSET_CLASS_LABEL[s.type] ?? s.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="px-5 py-2.5 sm:py-3 rounded-xl text-sm font-semibold text-white bg-primary
                   hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors shadow-sm"
      >
        {loading ? t('analysis_loading') : t('analysis_analyze')}
      </button>
    </form>
  )
}
