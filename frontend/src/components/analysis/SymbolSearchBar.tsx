/**
 * Symbol search bar with language toggle for the Analysis page.
 * Debounced input → fires onSearch(symbol) on Enter or button click.
 */
import { useState, useCallback } from 'react'
import { useLanguage } from '@/context/LanguageContext'

interface Props {
  onSearch: (symbol: string) => void
  loading: boolean
}

export default function SymbolSearchBar({ onSearch, loading }: Props) {
  const { t } = useLanguage()
  const [value, setValue] = useState('')

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const sym = value.trim().toUpperCase()
      if (sym) onSearch(sym)
    },
    [value, onSearch],
  )

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <div className="relative flex-1 max-w-md">
        {/* Search icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
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
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('analysis_search_ph')}
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200
                     bg-white text-slate-800 placeholder:text-slate-400
                     focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                     transition-shadow appearance-none
                     [&::-webkit-search-decoration]:hidden
                     [&::-webkit-search-cancel-button]:hidden
                     [&::-webkit-search-results-button]:hidden
                     [&::-webkit-search-results-decoration]:hidden"
          disabled={loading}
        />
      </div>
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary
                   hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors shadow-sm"
      >
        {loading ? t('analysis_loading') : t('analysis_analyze')}
      </button>
    </form>
  )
}
