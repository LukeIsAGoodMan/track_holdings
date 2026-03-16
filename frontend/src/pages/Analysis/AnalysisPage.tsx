/**
 * Rhino Analysis Page — search a symbol, get full analysis.
 *
 * Layout:
 *   SearchBar → Hero → [Technical | Valuation | Macro] → Chart → Narrative
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { fetchAnalysis } from '@/api/holdings'
import type { AnalysisResult } from '@/types'

import SymbolSearchBar from '@/components/analysis/SymbolSearchBar'
import HeroSummaryCard  from '@/components/analysis/HeroSummaryCard'
import TechnicalCard    from '@/components/analysis/TechnicalCard'
import ValuationCard    from '@/components/analysis/ValuationCard'
import MacroCard        from '@/components/analysis/MacroCard'
import RhinoChart       from '@/components/analysis/RhinoChart'
import NarrativeSection from '@/components/analysis/NarrativeSection'
import AnalysisSkeleton from '@/components/analysis/AnalysisSkeleton'

export default function AnalysisPage() {
  const { lang, t } = useLanguage()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lastSymbolRef = useRef<string | null>(null)

  const handleSearch = useCallback(
    async (symbol: string) => {
      lastSymbolRef.current = symbol
      setLoading(true)
      setError(null)
      try {
        const data = await fetchAnalysis(symbol, lang)
        setResult(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(msg)
        setResult(null)
      } finally {
        setLoading(false)
      }
    },
    [lang],
  )

  // Refetch when language changes (text report is language-dependent)
  useEffect(() => {
    if (lastSymbolRef.current && result) {
      handleSearch(lastSymbolRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const price = result?.quote?.price ?? 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-xl font-bold text-slate-800">{t('analysis_title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('analysis_sub')}</p>
      </div>

      {/* Search */}
      <SymbolSearchBar onSearch={handleSearch} loading={loading} />

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && <AnalysisSkeleton />}

      {/* Results */}
      {result && !loading && (
        <>
          <HeroSummaryCard data={result} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <TechnicalCard technical={result.technical} price={price} />
            <ValuationCard valuation={result.valuation} price={price} />
            <MacroCard macro={result.macro} />
          </div>

          <RhinoChart chart={result.chart} price={price} />

          <NarrativeSection narrative={result.narrative} sections={result.text.sections} />

          {/* Data quality footer */}
          <div className="text-[11px] text-slate-400 text-right">
            {t('analysis_as_of')}: {new Date(result.as_of).toLocaleString()}
            {' · '}
            {t('analysis_data_days')}: {result.data_quality.history_days}
          </div>
        </>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-20 text-slate-400">
          <svg className="w-16 h-16 mx-auto mb-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-lg font-medium">{t('analysis_empty')}</p>
          <p className="text-sm mt-1">{t('analysis_empty_hint')}</p>
        </div>
      )}
    </div>
  )
}
