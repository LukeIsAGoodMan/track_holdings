/**
 * MarketTicker — Horizontal market data bar (light theme)
 * SPX price + change | VIX level + regime | Next macro event countdown
 */
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'

const VIX_TERM_COLORS: Record<string, string> = {
  low:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  normal:   'bg-yellow-50  text-yellow-700  border-yellow-200',
  elevated: 'bg-orange-50  text-orange-700  border-orange-200',
  crisis:   'bg-rose-50    text-rose-700    border-rose-200',
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
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-3 animate-pulse">
        <div className="h-5 bg-slate-100 rounded w-3/4" />
      </div>
    )
  }

  const d = lastMacroTicker
  const spxUp    = d.spx_change_pct >= 0
  const spxColor = spxUp ? 'text-emerald-600' : 'text-rose-600'
  const spxBg    = spxUp ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
  const spxArrow = spxUp ? '\u25b2' : '\u25bc'

  const termStyle = VIX_TERM_COLORS[d.vix_term] ?? VIX_TERM_COLORS.normal
  const termLabel = VIX_TERM_LABELS[d.vix_term]?.[lang] ?? d.vix_term

  const spxLabel = lang === 'zh' ? '\u6807\u666e500' : 'SPX'
  const vixLabel = lang === 'zh' ? '\u6050\u6148\u6307\u6570' : 'VIX'
  const dayLabel = lang === 'zh' ? '\u65e5' : 'd'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-5 py-3
                    flex items-center gap-5 font-sans overflow-x-auto">
      {/* SPX */}
      <div className="flex items-center gap-2.5 whitespace-nowrap">
        <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{spxLabel}</span>
        <span className="text-slate-900 font-bold tabular-nums text-sm">
          {d.spx_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${spxBg} ${spxColor}`}>
          {spxArrow}{spxUp ? '+' : ''}{d.spx_change_pct.toFixed(2)}%
        </span>
      </div>

      <div className="w-px h-5 bg-slate-200 shrink-0" />

      {/* VIX */}
      <div className="flex items-center gap-2.5 whitespace-nowrap">
        <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{vixLabel}</span>
        <span className="text-slate-900 font-bold tabular-nums text-sm">{d.vix_level.toFixed(2)}</span>
        <span className={`text-xs px-2 py-0.5 rounded-md border ${termStyle}`}>{termLabel}</span>
      </div>

      <div className="w-px h-5 bg-slate-200 shrink-0" />

      {/* Next event */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        {d.next_event_name && d.days_to_next_event != null ? (
          <>
            <span className="text-base">📅</span>
            <span className={`font-medium text-sm ${
              d.days_to_next_event <= 2 ? 'text-amber-600 animate-pulse' : 'text-slate-700'
            }`}>
              {d.next_event_name}
            </span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border
              ${d.days_to_next_event <= 2
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
              {d.days_to_next_event}{dayLabel}
            </span>
          </>
        ) : (
          <span className="text-slate-400 text-xs">
            {lang === 'zh' ? '\u65e0\u8fd1\u671f\u4e8b\u4ef6' : 'No upcoming event'}
          </span>
        )}
      </div>
    </div>
  )
}
