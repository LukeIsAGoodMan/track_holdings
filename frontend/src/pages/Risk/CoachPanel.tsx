/**
 * CoachPanel — AI Trading Coach sidebar (right-side slide-in drawer)
 *
 * · Fixed-position 384px panel, slides in from the right edge.
 * · Click the "AI Coach" tab (fixed to right viewport edge) to toggle.
 * · "Diagnose" button opens an SSE connection to GET /api/coach/analyze.
 * · Text streams in token-by-token (typewriter effect with blinking cursor).
 * · On completion, structured cards render:
 *     - Assessment badge (Safe=green / Warning=amber / Danger=red)
 *     - Key Weakness card (dark slate)
 *     - Actionable Steps list (amber-accented)
 *     - Weekly Review card (optional, toggle-able)
 *
 * Parent usage (RiskPage):
 *   <CoachPanel portfolioId={selectedPortfolioId} />
 */
import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import type { CoachResult } from '@/types'

// ── Assessment badge ───────────────────────────────────────────────────────────
const ASSESSMENT_CLASSES: Record<string, string> = {
  Safe:    'bg-bull/20 text-bull ring-1 ring-bull/40',
  Warning: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40',
  Danger:  'bg-bear/20 text-bear ring-1 ring-bear/40',
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
    <span className="inline-block w-[2px] h-[1em] bg-sky-400 ml-0.5 align-middle
                     animate-pulse" />
  )
}

// ── Structured result cards ────────────────────────────────────────────────────
function ResultCards({ result, t }: { result: CoachResult; t: (k: string) => string }) {
  return (
    <div className="space-y-3">
      {/* Assessment */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
          Risk Level
        </span>
        <AssessmentBadge value={result.assessment} />
      </div>

      {/* Key Weakness */}
      {result.weakness && (
        <div className="bg-slate-800/70 border border-line rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5">
            {t('coach_weakness')}
          </div>
          <p className="text-slate-200 text-sm leading-relaxed">{result.weakness}</p>
        </div>
      )}

      {/* Actionable Steps */}
      {result.steps.length > 0 && (
        <div className="bg-slate-800/70 border border-line rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">
            {t('coach_steps')}
          </div>
          <ol className="space-y-2">
            {result.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full
                                 bg-amber-500/20 border border-amber-500/40
                                 text-amber-300 text-[10px] font-bold
                                 flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-slate-200 text-sm leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Weekly Review */}
      {result.weekly && (
        <div className="bg-slate-800/50 border border-line/50 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5">
            {t('coach_weekly')}
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">{result.weekly}</p>
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
    // Close any existing stream
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
          // Keep streamText so the full prose is still readable
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
                  border-l border-t border-b border-line
                  bg-card/90 backdrop-blur
                  text-slate-400 hover:text-sky-300
                  transition-all duration-300 shadow-lg
                  ${open ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <span className="text-base">🤖</span>
      <span
        className="text-[9px] font-bold uppercase tracking-widest"
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
                  bg-[#0d1117]/96 backdrop-blur-md
                  border-l border-line
                  transition-transform duration-300 ease-in-out
                  ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3
                      border-b border-line flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <span className="text-sm font-bold text-white">{t('coach_title')}</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-500 hover:text-slate-300 text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 px-4 py-2
                      border-b border-line/50 flex-shrink-0">
        {/* Weekly toggle */}
        <button
          onClick={() => setIncludeWeekly((v) => !v)}
          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors
            ${includeWeekly
              ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
              : 'text-slate-500 hover:text-slate-300 bg-slate-800/50'
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
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-sky-600 hover:bg-sky-500 text-white'
                      }`}
        >
          {streaming ? (
            <>
              <span className="w-3 h-3 border-2 border-slate-400 border-t-transparent
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
          <div className="bg-red-500/10 border border-red-500/25 rounded-lg
                          px-3 py-2 text-xs text-red-400">
            {error === 'ANTHROPIC_API_KEY not set'
              ? t('coach_no_key')
              : error}
          </div>
        )}

        {/* Structured result cards (appear after stream completes) */}
        {result && !streaming && (
          <ResultCards result={result} t={t} />
        )}

        {/* Streaming raw text (shown while streaming OR before result cards) */}
        {streamText && (
          <div className={`${result ? 'mt-4 pt-4 border-t border-line/30' : ''}`}>
            {result && (
              <div className="text-[9px] uppercase tracking-widest text-slate-600
                              font-semibold mb-2">
                Full Analysis
              </div>
            )}
            <pre className="font-mono text-[11px] text-slate-400 whitespace-pre-wrap
                             leading-relaxed break-words">
              {streamText}
              {streaming && <Cursor />}
            </pre>
          </div>
        )}

        {/* Empty state */}
        {!streamText && !streaming && !result && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
            <div className="text-4xl opacity-30">🤖</div>
            <p className="text-xs text-slate-600 max-w-[220px] leading-relaxed">
              Click <span className="text-sky-400 font-semibold">Diagnose</span> to get
              AI-powered coaching based on your current Greeks and risk posture.
            </p>
          </div>
        )}
      </div>

      {/* Footer credit */}
      <div className="px-4 py-2 border-t border-line/30 flex-shrink-0">
        <p className="text-[9px] text-slate-700 text-center">
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
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  )
}
