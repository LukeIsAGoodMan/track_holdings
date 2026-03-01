/**
 * MarketTicker — Horizontal bar showing SPX + VIX + next macro event (Phase 12a)
 *
 * Displays:
 *   SPX  5,234.42  +0.32%  |  VIX  16.82  Normal  |  CPI in 3d
 *
 * Color coding:
 *   SPX change: green (positive) / red (negative)
 *   VIX term badge: green=low, yellow=normal, orange=elevated, red=crisis
 *   Event countdown: pulsing amber if <= 2d
 */
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'

const VIX_TERM_COLORS: Record<string, string> = {
  low:      'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  normal:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  elevated: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  crisis:   'bg-red-500/20 text-red-400 border-red-500/30',
}

const VIX_TERM_LABELS: Record<string, { en: string; zh: string }> = {
  low:      { en: 'Low Vol',  zh: '\u4f4e\u6ce2\u52a8' },
  normal:   { en: 'Normal',   zh: '\u6b63\u5e38' },
  elevated: { en: 'Elevated', zh: '\u504f\u9ad8' },
  crisis:   { en: 'Crisis',   zh: '\u5371\u673a' },
}

export default function MarketTicker() {
  const { lang } = useLanguage()
  const { lastMacroTicker } = useWebSocket()

  if (!lastMacroTicker) {
    return (
      <div className="bg-card border border-line rounded-xl px-4 py-2 mb-4 animate-pulse">
        <div className="h-5 bg-muted rounded w-3/4" />
      </div>
    )
  }

  const d = lastMacroTicker
  const spxUp = d.spx_change_pct >= 0
  const spxColor = spxUp ? 'text-emerald-400' : 'text-red-400'
  const spxArrow = spxUp ? '\u25b2' : '\u25bc'

  const termStyle = VIX_TERM_COLORS[d.vix_term] || VIX_TERM_COLORS.normal
  const termLabel = VIX_TERM_LABELS[d.vix_term]?.[lang] || d.vix_term

  const spxLabel = lang === 'zh' ? '\u6807\u666e500' : 'SPX'
  const vixLabel = lang === 'zh' ? '\u6050\u6148\u6307\u6570' : 'VIX'
  const dayLabel = lang === 'zh' ? '\u65e5' : 'd'

  return (
    <div className="bg-card border border-line rounded-xl px-4 py-2 mb-4 flex items-center gap-6 text-sm font-mono overflow-x-auto">
      {/* SPX */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-muted text-xs font-semibold uppercase tracking-wide">{spxLabel}</span>
        <span className="text-foreground font-semibold">
          {d.spx_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`${spxColor} text-xs font-medium`}>
          {spxArrow}{spxUp ? '+' : ''}{d.spx_change_pct.toFixed(2)}%
        </span>
      </div>

      <div className="w-px h-5 bg-line" />

      {/* VIX */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-muted text-xs font-semibold uppercase tracking-wide">{vixLabel}</span>
        <span className="text-foreground font-semibold">
          {d.vix_level.toFixed(2)}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded border ${termStyle}`}>
          {termLabel}
        </span>
      </div>

      <div className="w-px h-5 bg-line" />

      {/* Next event */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        {d.next_event_name && d.days_to_next_event != null ? (
          <>
            <span className="text-muted text-xs">
              {lang === 'zh' ? '\ud83d\udcc5' : '\ud83d\udcc5'}
            </span>
            <span className={`font-medium ${d.days_to_next_event <= 2 ? 'text-amber-400 animate-pulse' : 'text-foreground'}`}>
              {d.next_event_name}
            </span>
            <span className={`text-xs ${d.days_to_next_event <= 2 ? 'text-amber-400' : 'text-muted'}`}>
              {d.days_to_next_event}{dayLabel}
            </span>
          </>
        ) : (
          <span className="text-muted text-xs">
            {lang === 'zh' ? '\u65e0\u8fd1\u671f\u4e8b\u4ef6' : 'No upcoming event'}
          </span>
        )}
      </div>
    </div>
  )
}
