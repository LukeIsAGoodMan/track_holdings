/**
 * AiInsightPanel — Real-time AI risk diagnostics card (light theme)
 * Phase 8b + 10a Voice
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useWebSocket } from '@/context/WebSocketContext'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage } from '@/context/LanguageContext'
import type { AiDiagnostic, AiInsightData, HoldingGroup } from '@/types'
import type { TKey } from '@/i18n/translations'

// ── Fingerprint helpers ────────────────────────────────────────────────────────
function holdingsFingerprint(portfolioId: number | null | undefined, holdings: HoldingGroup[]): string {
  const pid = portfolioId ?? 0
  const parts = holdings
    .map((g) => {
      const opts = g.option_legs.map((l) => `${l.strike}-${l.expiry}-${l.net_contracts}`).join('|')
      const stks = g.stock_legs.map((l) => `${l.net_shares}`).join('|')
      return `${g.symbol}:${opts}:${stks}`
    })
    .sort()
    .join(';')
  // Simple deterministic hash (djb2-style)
  let h = 5381
  const str = `${pid}::${parts}`
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h = h >>> 0  // keep 32-bit unsigned
  }
  return `ai_insight_${h}`
}

function loadCachedInsight(key: string): AiInsightData | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as AiInsightData
  } catch {
    return null
  }
}

function saveCachedInsight(key: string, data: AiInsightData) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

// ── Severity styling (light theme) ───────────────────────────────────────────

const SEV_DOT: Record<string, string> = {
  critical: 'bg-rose-500',
  warning:  'bg-amber-500',
  info:     'bg-sky-500',
}

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border border-rose-200',
  warning:  'bg-amber-50 text-amber-700 border border-amber-200',
  info:     'bg-sky-50 text-sky-700 border border-sky-200',
}

const ASSESS_STYLE: Record<string, string> = {
  Danger:  'bg-rose-50 text-rose-700 border border-rose-200',
  Warning: 'bg-amber-50 text-amber-700 border border-amber-200',
  Caution: 'bg-sky-50 text-sky-700 border border-sky-200',
  Safe:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

const CAT_KEY: Record<string, TKey> = {
  delta:           'ai_cat_delta',
  gamma:           'ai_cat_gamma',
  theta:           'ai_cat_theta',
  vega:            'ai_cat_vega',
  expiry:          'ai_cat_expiry',
  diversification: 'ai_cat_diversification',
}

const ASSESS_KEY: Record<string, TKey> = {
  Safe:    'ai_safe',
  Caution: 'ai_caution',
  Warning: 'ai_warning',
  Danger:  'ai_danger',
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconBrain() {
  return (
    <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 2.8 2A3 3 0 0 1 21 12a3 3 0 0 1-2.2 2.9A3 3 0 0 1 16 17v1a4 4 0 0 1-8 0v-1a3 3 0 0 1-2.8-2.1A3 3 0 0 1 3 12a3 3 0 0 1 2.2-2.9A3 3 0 0 1 8 7V6a4 4 0 0 1 4-4z" />
      <path d="M12 2v20" />
    </svg>
  )
}

function IconVolumeOn({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

function IconVolumeOff({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function IconSpeaker({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

// ── Diagnostic row ────────────────────────────────────────────────────────────
function DiagnosticRow({ item, t }: { item: AiDiagnostic; t: (key: TKey) => string }) {
  const catKey = CAT_KEY[item.category]
  return (
    <div className="flex gap-3 py-3.5">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[item.severity] ?? SEV_DOT.info}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${SEV_BADGE[item.severity] ?? SEV_BADGE.info}`}>
            {catKey ? t(catKey) : item.category}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.explanation}</p>
        <p className="text-xs text-primary/80 mt-1.5">
          <span className="text-slate-300 mr-1">&rarr;</span>
          {item.suggestion}
        </p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AiInsightPanel({ holdings = [] }: { holdings?: HoldingGroup[] }) {
  const { t } = useLanguage()
  const { lastAiInsight } = useWebSocket()
  const { selectedPortfolioId } = usePortfolio()

  // Fingerprint key — stable as long as portfolio composition is the same.
  // Changing tab or language won't recompute (same holdings array reference).
  const cacheKey = useMemo(
    () => holdingsFingerprint(selectedPortfolioId, holdings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPortfolioId, holdings.length, holdings.map((g) => g.symbol).join(',')],
  )

  // Hydrate from localStorage on mount or when portfolio/holdings change
  const [insight, setInsight] = useState<AiInsightData | null>(
    () => loadCachedInsight(holdingsFingerprint(selectedPortfolioId, holdings))
  )
  const [pulsing, setPulsing] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [muted,   setMuted]   = useState(() => localStorage.getItem('tts_muted') !== 'false')
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // When portfolio changes, load cached insight for the new portfolio immediately
  useEffect(() => {
    const cached = loadCachedInsight(cacheKey)
    setInsight(cached)
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setPlaying(false) }
  }, [cacheKey])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      localStorage.setItem('tts_muted', String(next))
      if (next && audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
        setPlaying(false)
      }
      return next
    })
  }, [])

  const playAudio = useCallback((url: string) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onplay  = () => setPlaying(true)
    audio.onended = () => { setPlaying(false); audioRef.current = null }
    audio.onerror = () => { setPlaying(false); audioRef.current = null }
    audio.play().catch(() => setPlaying(false))
  }, [])

  // On new WS insight: save to localStorage cache + display
  useEffect(() => {
    if (!lastAiInsight) return
    if (lastAiInsight.portfolioId !== selectedPortfolioId) return
    const data = lastAiInsight.data
    saveCachedInsight(cacheKey, data)
    setInsight(data)
    const hasCritical = data.diagnostics.some((d) => d.severity === 'critical')
    if (hasCritical) {
      setPulsing(true)
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
      pulseTimer.current = setTimeout(() => setPulsing(false), 3000)
    }
  }, [lastAiInsight, selectedPortfolioId, cacheKey])

  useEffect(() => {
    if (!lastAiInsight) return
    if (lastAiInsight.portfolioId !== selectedPortfolioId) return
    if (muted) return
    const data = lastAiInsight.data
    if (!data.audio_url) return
    if (data.diagnostics.some((d) => d.severity === 'critical')) playAudio(data.audio_url)
  }, [lastAiInsight, selectedPortfolioId, muted, playAudio])

  useEffect(() => {
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])

  const borderClass = pulsing ? 'border-rose-300 ring-2 ring-rose-200' : 'border-slate-200'

  return (
    <div className={`bg-white border ${borderClass} rounded-2xl shadow-sm p-5 transition-all duration-300`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconBrain />
          <h2 className="text-sm font-semibold text-slate-800">{t('ai_title')}</h2>
          {insight && (
            <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold ${
              ASSESS_STYLE[insight.overall_assessment] ?? ASSESS_STYLE.Caution
            }`}>
              {t(ASSESS_KEY[insight.overall_assessment] ?? 'ai_caution')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {insight && (
            <button onClick={toggleMute}
              className={`p-1 rounded-md transition-colors ${
                muted ? 'text-slate-400 hover:text-slate-600' : 'text-primary hover:text-primary/70'
              }`}
              title={muted ? t('tts_muted') : t('tts_unmuted')}>
              {muted ? <IconVolumeOff /> : <IconVolumeOn />}
            </button>
          )}
          {insight?.audio_url && (
            <button
              onClick={() => {
                if (playing && audioRef.current) {
                  audioRef.current.pause(); audioRef.current = null; setPlaying(false)
                } else {
                  playAudio(insight.audio_url!)
                }
              }}
              className={`p-1 rounded-md transition-colors ${
                playing ? 'text-amber-600 animate-pulse' : 'text-slate-400 hover:text-slate-700'
              }`}
              title={playing ? t('tts_playing') : t('tts_play')}>
              <IconSpeaker />
            </button>
          )}
          {insight && (
            <span className="text-[10px] text-slate-400">
              {t('ai_generated')}{' '}
              {new Date(insight.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Skeleton */}
      {!insight && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
          ))}
          <p className="text-xs text-slate-400 text-center pt-1">{t('ai_scanning')}</p>
        </div>
      )}

      {/* Diagnostics */}
      {insight && (
        <div className="divide-y divide-slate-100">
          {insight.diagnostics.map((d, idx) => (
            <DiagnosticRow key={idx} item={d} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
