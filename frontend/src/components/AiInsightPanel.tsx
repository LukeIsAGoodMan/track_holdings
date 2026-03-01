/**
 * AiInsightPanel — Real-time AI risk diagnostics card (Phase 8b + 10a Voice)
 *
 * Consumes `lastAiInsight` from WebSocketContext.
 * Shows skeleton while waiting for first AI scan (~120s),
 * then renders 3-5 diagnostics with severity colors + category badges.
 *
 * Pulse: red border flash for 3s when a critical diagnostic arrives.
 * Voice: speaker button + mute toggle for TTS playback (Phase 10a).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useWebSocket } from '@/context/WebSocketContext'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage } from '@/context/LanguageContext'
import type { AiDiagnostic, AiInsightData } from '@/types'
import type { TKey } from '@/i18n/translations'

// ── Severity styling ─────────────────────────────────────────────────────────

const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  warning:  'bg-amber-500',
  info:     'bg-sky-500',
}

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400',
  warning:  'bg-amber-500/15 text-amber-300',
  info:     'bg-sky-500/15 text-sky-400',
}

// ── Assessment badge styling ─────────────────────────────────────────────────

const ASSESS_STYLE: Record<string, string> = {
  Danger:  'bg-red-500/15 text-red-400 border border-red-500/30',
  Warning: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  Caution: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
  Safe:    'bg-green-500/15 text-green-400 border border-green-500/30',
}

// ── Category → i18n key mapping ──────────────────────────────────────────────

const CAT_KEY: Record<string, TKey> = {
  delta:           'ai_cat_delta',
  gamma:           'ai_cat_gamma',
  theta:           'ai_cat_theta',
  vega:            'ai_cat_vega',
  expiry:          'ai_cat_expiry',
  diversification: 'ai_cat_diversification',
}

// ── Assessment → i18n key mapping ────────────────────────────────────────────

const ASSESS_KEY: Record<string, TKey> = {
  Safe:    'ai_safe',
  Caution: 'ai_caution',
  Warning: 'ai_warning',
  Danger:  'ai_danger',
}

// ── Brain icon (inline SVG) ──────────────────────────────────────────────────

function IconBrain() {
  return (
    <svg
      className="w-4 h-4 text-info"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 2.8 2A3 3 0 0 1 21 12a3 3 0 0 1-2.2 2.9A3 3 0 0 1 16 17v1a4 4 0 0 1-8 0v-1a3 3 0 0 1-2.8-2.1A3 3 0 0 1 3 12a3 3 0 0 1 2.2-2.9A3 3 0 0 1 8 7V6a4 4 0 0 1 4-4z" />
      <path d="M12 2v20" />
    </svg>
  )
}

// ── Volume icons (inline SVG) ────────────────────────────────────────────────

function IconVolumeOn({ className }: { className?: string }) {
  return (
    <svg className={className || 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

function IconVolumeOff({ className }: { className?: string }) {
  return (
    <svg className={className || 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function IconSpeaker({ className }: { className?: string }) {
  return (
    <svg className={className || 'w-3.5 h-3.5'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AiInsightPanel() {
  const { t } = useLanguage()
  const { lastAiInsight } = useWebSocket()
  const { selectedPortfolioId } = usePortfolio()

  // Local state: cached insight for the current portfolio
  const [insight, setInsight] = useState<AiInsightData | null>(null)
  const [pulsing, setPulsing] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Voice state (Phase 10a) ─────────────────────────────────────────────
  const [muted, setMuted] = useState(() => localStorage.getItem('tts_muted') !== 'false')
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      localStorage.setItem('tts_muted', String(next))
      // Stop current playback when muting
      if (next && audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
        setPlaying(false)
      }
      return next
    })
  }, [])

  const playAudio = useCallback((url: string) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onplay = () => setPlaying(true)
    audio.onended = () => { setPlaying(false); audioRef.current = null }
    audio.onerror = () => { setPlaying(false); audioRef.current = null }
    audio.play().catch(() => setPlaying(false))
  }, [])

  // Update insight when WS delivers data for this portfolio
  useEffect(() => {
    if (!lastAiInsight) return
    if (lastAiInsight.portfolioId !== selectedPortfolioId) return

    setInsight(lastAiInsight.data)

    // Trigger pulse if any critical diagnostic
    const hasCritical = lastAiInsight.data.diagnostics.some(
      (d) => d.severity === 'critical',
    )
    if (hasCritical) {
      setPulsing(true)
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
      pulseTimer.current = setTimeout(() => setPulsing(false), 3000)
    }
  }, [lastAiInsight, selectedPortfolioId])

  // Auto-play TTS on critical (if unmuted)
  useEffect(() => {
    if (!lastAiInsight) return
    if (lastAiInsight.portfolioId !== selectedPortfolioId) return
    if (muted) return

    const data = lastAiInsight.data
    if (!data.audio_url) return

    const hasCritical = data.diagnostics.some((d) => d.severity === 'critical')
    if (hasCritical) {
      playAudio(data.audio_url)
    }
  }, [lastAiInsight, selectedPortfolioId, muted, playAudio])

  // Clear insight when portfolio changes
  useEffect(() => {
    setInsight(null)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setPlaying(false)
    }
  }, [selectedPortfolioId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  const borderClass = pulsing
    ? 'border-red-500/40 animate-pulse'
    : 'border-line'

  return (
    <div className={`bg-card border ${borderClass} rounded-xl p-5 transition-colors duration-300`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconBrain />
          <h2 className="text-sm font-semibold text-slate-200">
            {t('ai_title')}
          </h2>
          {insight && (
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                ASSESS_STYLE[insight.overall_assessment] || ASSESS_STYLE.Caution
              }`}
            >
              {t(ASSESS_KEY[insight.overall_assessment] || 'ai_caution')}
            </span>
          )}
        </div>

        {/* ── Voice controls + timestamp ────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {/* Mute toggle */}
          {insight && (
            <button
              onClick={toggleMute}
              className={`p-1 rounded transition-colors ${
                muted
                  ? 'text-slate-600 hover:text-slate-400'
                  : 'text-info hover:text-info/80'
              }`}
              title={muted ? t('tts_muted') : t('tts_unmuted')}
            >
              {muted ? <IconVolumeOff /> : <IconVolumeOn />}
            </button>
          )}

          {/* Speaker play button — only when audio_url available */}
          {insight?.audio_url && (
            <button
              onClick={() => {
                if (playing && audioRef.current) {
                  audioRef.current.pause()
                  audioRef.current = null
                  setPlaying(false)
                } else {
                  playAudio(insight.audio_url!)
                }
              }}
              className={`p-1 rounded transition-colors ${
                playing
                  ? 'text-amber-400 animate-pulse'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={playing ? t('tts_playing') : t('tts_play')}
            >
              <IconSpeaker />
            </button>
          )}

          {/* Timestamp */}
          {insight && (
            <span className="text-[10px] text-slate-600">
              {t('ai_generated')}{' '}
              {new Date(insight.generated_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      </div>

      {/* ── Skeleton (waiting for first scan) ───────────────────────────── */}
      {!insight && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 bg-slate-800/50 rounded-lg animate-pulse"
            />
          ))}
          <p className="text-xs text-slate-600 text-center pt-1">
            {t('ai_scanning')}
          </p>
        </div>
      )}

      {/* ── Diagnostics list ────────────────────────────────────────────── */}
      {insight && (
        <div className="space-y-0 divide-y divide-line/30">
          {insight.diagnostics.map((d, idx) => (
            <DiagnosticRow key={idx} item={d} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Diagnostic row sub-component ─────────────────────────────────────────────

function DiagnosticRow({
  item,
  t,
}: {
  item: AiDiagnostic
  t: (key: TKey) => string
}) {
  const catKey = CAT_KEY[item.category]

  return (
    <div className="flex gap-3 py-3">
      {/* Severity dot */}
      <div
        className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
          SEV_DOT[item.severity] || SEV_DOT.info
        }`}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-200 truncate">
            {item.title}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${
              SEV_BADGE[item.severity] || SEV_BADGE.info
            }`}
          >
            {catKey ? t(catKey) : item.category}
          </span>
        </div>

        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          {item.explanation}
        </p>

        <p className="text-xs text-info/70 mt-1.5">
          <span className="text-slate-600 mr-1">&rarr;</span>
          {item.suggestion}
        </p>
      </div>
    </div>
  )
}
