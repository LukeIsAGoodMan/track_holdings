/**
 * CoachPanel — AI Trading Coach sidebar (right-side slide-in drawer)
 * Light theme
 */
import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import type { CoachResult } from '@/types'
import type { TKey } from '@/i18n/translations'

// ── Assessment badge ───────────────────────────────────────────────────────────
const ASSESSMENT_CLASSES: Record<string, string> = {
  Safe:    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300',
  Warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-300',
  Danger:  'bg-rose-50 text-rose-700 ring-1 ring-rose-300',
}

function AssessmentBadge({ value }: { value: string }) {
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold tracking-wide
      ${ASSESSMENT_CLASSES[value] ?? ASSESSMENT_CLASSES.Warning}`}>
      {value}
    </span>
  )
}

// ── Blinking cursor ────────────────────────────────────────────────────────────
function Cursor() {
  return (
    <span className="inline-block w-[2px] h-[1em] bg-primary ml-0.5 align-middle
                     animate-pulse" />
  )
}

// ── Structured result cards ────────────────────────────────────────────────────
function ResultCards({ result, t }: { result: CoachResult; t: (k: TKey) => string }) {
  return (
    <div className="space-y-3">
      {/* Assessment */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
          Risk Level
        </span>
        <AssessmentBadge value={result.assessment} />
      </div>

      {/* Key Weakness */}
      {result.weakness && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            {t('coach_weakness')}
          </div>
          <p className="text-slate-700 text-sm leading-relaxed">{result.weakness}</p>
        </div>
      )}

      {/* Actionable Steps */}
      {result.steps.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
            {t('coach_steps')}
          </div>
          <ol className="space-y-2">
            {result.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full
                                 bg-amber-50 border border-amber-200
                                 text-amber-700 text-[10px] font-bold
                                 flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-slate-700 text-sm leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Weekly Review */}
      {result.weekly && (
        <div className="bg-slate-50/80 border border-slate-100 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">
            {t('coach_weekly')}
          </div>
          <p className="text-slate-600 text-sm leading-relaxed">{result.weekly}</p>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function CoachPanel({
  portfolioId,
}: {
  portfolioId: number | null | undefined
}) {
  const { t } = useLanguage()

  const [open,          setOpen]          = useState(false)
  const [streaming,     setStreaming]      = useState(false)
  const [streamText,    setStreamText]     = useState('')
  const [result,        setResult]         = useState<CoachResult | null>(null)
  const [error,         setError]          = useState<string | null>(null)
  const [includeWeekly, setIncludeWeekly]  = useState(false)

  const esRef      = useRef<EventSource | null>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)

  // Auto-scroll streaming text
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [streamText, streaming])

  // Clean up EventSource on unmount
  useEffect(() => () => esRef.current?.close(), [])

  function diagnose() {
    esRef.current?.close()
    setStreamText('')
    setResult(null)
    setError(null)
    setStreaming(true)

    const params = new URLSearchParams()
    if (portfolioId != null) params.set('portfolio_id', String(portfolioId))
    if (includeWeekly)       params.set('include_weekly', 'true')
    const token = localStorage.getItem('th_token')
    if (token) params.set('token', token)

    const url = `/api/coach/analyze?${params.toString()}`
    const es  = new EventSource(url)
    esRef.current = es

    es.onmessage = (event) => {
      if (event.data === '[DONE]') {
        es.close()
        setStreaming(false)
        return
      }
      try {
        const chunk = JSON.parse(event.data)
        if (chunk.t === 'chunk') {
          setStreamText((prev) => prev + (chunk.v ?? ''))
        } else if (chunk.t === 'done') {
          setResult({
            assessment: chunk.assessment ?? 'Warning',
            weakness:   chunk.weakness   ?? '',
            steps:      chunk.steps      ?? [],
            weekly:     chunk.weekly     ?? '',
          })
        } else if (chunk.t === 'error') {
          setError(chunk.v ?? 'Unknown error')
          es.close()
          setStreaming(false)
        }
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      es.close()
      setStreaming(false)
      if (!result) setError('Connection error — check backend is running.')
    }
  }

  // ── Tab button (always visible, right-edge) ───────────────────────────────
  const tabBtn = (
    <button
      onClick={() => setOpen((v) => !v)}
      title={t('coach_title')}
      className={`fixed right-0 top-1/2 -translate-y-1/2 z-50
                  flex flex-col items-center justify-center gap-1
                  w-8 py-5 rounded-l-xl
                  border-l border-t border-b border-slate-200
                  bg-white/95 backdrop-blur
                  text-slate-500 hover:text-primary
                  transition-all duration-300 shadow-md
                  ${open ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <span className="text-base">🤖</span>
      <span
        className="text-[9px] font-bold uppercase tracking-widest text-slate-400"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        AI Coach
      </span>
    </button>
  )

  // ── Drawer panel ──────────────────────────────────────────────────────────
  const panel = (
    <div
      className={`fixed top-0 right-0 h-full w-96 z-40
                  flex flex-col
                  bg-white
                  border-l border-slate-200
                  shadow-xl
                  transition-transform duration-300 ease-in-out
                  ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3
                      border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <span className="text-sm font-bold text-slate-800">{t('coach_title')}</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-400 hover:text-slate-700 text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 px-4 py-2
                      border-b border-slate-100 flex-shrink-0">
        {/* Weekly toggle */}
        <button
          onClick={() => setIncludeWeekly((v) => !v)}
          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors
            ${includeWeekly
              ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
              : 'text-slate-500 hover:text-slate-700 bg-slate-100'
            }`}
        >
          {t('coach_weekly')}
        </button>

        {/* Diagnose button */}
        <button
          onClick={diagnose}
          disabled={streaming}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg
                      text-xs font-semibold transition-all
                      ${streaming
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-primary hover:bg-primary/90 text-white shadow-sm'
                      }`}
        >
          {streaming ? (
            <>
              <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500
                               rounded-full animate-spin" />
              {t('coach_streaming')}
            </>
          ) : (
            <>▶ {t('coach_diagnose')}</>
          )}
        </button>
      </div>

      {/* Content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Error */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg
                          px-3 py-2 text-xs text-rose-600">
            {error === 'ANTHROPIC_API_KEY not set'
              ? t('coach_no_key')
              : error}
          </div>
        )}

        {/* Structured result cards */}
        {result && !streaming && (
          <ResultCards result={result} t={t} />
        )}

        {/* Streaming raw text */}
        {streamText && (
          <div className={`${result ? 'mt-4 pt-4 border-t border-slate-100' : ''}`}>
            {result && (
              <div className="text-[9px] uppercase tracking-widest text-slate-400
                              font-semibold mb-2">
                Full Analysis
              </div>
            )}
            <pre className="font-mono text-[11px] text-slate-600 whitespace-pre-wrap
                             leading-relaxed break-words">
              {streamText}
              {streaming && <Cursor />}
            </pre>
          </div>
        )}

        {/* Empty state */}
        {!streamText && !streaming && !result && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
            <div className="text-4xl opacity-20">🤖</div>
            <p className="text-xs text-slate-500 max-w-[220px] leading-relaxed">
              Click <span className="text-primary font-semibold">Diagnose</span> to get
              AI-powered coaching based on your current Greeks and risk posture.
            </p>
          </div>
        )}
      </div>

      {/* Footer credit */}
      <div className="px-4 py-2 border-t border-slate-100 flex-shrink-0">
        <p className="text-[9px] text-slate-400 text-center">
          Powered by Claude Haiku — indicative only, not financial advice
        </p>
      </div>
    </div>
  )

  return (
    <>
      {tabBtn}
      {panel}
      {/* Overlay backdrop when panel is open */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  )
}
