/**
 * MarketTicker — Horizontal market data bar (light theme)
 *
 * Left (pinned): SPX | VIX | Next macro event  — from WS macro_ticker
 * Right (static): SPY | QQQ | DIA | VIX         — REST polled every 60s
 */
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchMarketQuotes } from '@/api/holdings'
import type { MarketQuote } from '@/types'

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

const MARKET_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'VIX']
const POLL_INTERVAL_MS = 60_000

function MarketChip({ q }: { q: MarketQuote }) {
  const price = q.price != null ? parseFloat(q.price) : null
  const pct   = q.change_pct
  const up    = pct == null || pct >= 0

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{q.symbol}</span>
      {price != null ? (
        <span className="text-sm font-bold tabular-nums text-slate-900">
          {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ) : (
        <span className="h-4 w-14 bg-slate-100 rounded animate-pulse inline-block" />
      )}
      {pct != null && (
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border
          ${up
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
    </div>
  )
}

export default function MarketTicker() {
  const { lang } = useLanguage()
  const { lastMacroTicker } = useWebSocket()

  const [quotes, setQuotes] = useState<MarketQuote[]>([])

  useEffect(() => {
    let cancelled = false

    const fetch = () => {
      fetchMarketQuotes(MARKET_SYMBOLS)
        .then((data) => { if (!cancelled) setQuotes(data) })
        .catch(() => {})
    }

    fetch()
    const id = setInterval(fetch, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

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
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm font-sans overflow-hidden">
      <div className="flex items-center h-11 gap-0">

        {/* ── Pinned macro data (left) ──────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-4 shrink-0 border-r border-slate-100 h-full">
          {/* SPX */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">{spxLabel}</span>
            <span className="text-slate-900 font-bold tabular-nums text-sm">
              {d.spx_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${spxBg} ${spxColor}`}>
              {spxArrow}{spxUp ? '+' : ''}{d.spx_change_pct.toFixed(2)}%
            </span>
          </div>

          <div className="w-px h-4 bg-slate-200 shrink-0" />

          {/* VIX */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">{vixLabel}</span>
            <span className="text-slate-900 font-bold tabular-nums text-sm">{d.vix_level.toFixed(2)}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${termStyle}`}>{termLabel}</span>
          </div>

          {d.next_event_name && d.days_to_next_event != null && (
            <>
              <div className="w-px h-4 bg-slate-200 shrink-0" />
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-sm">📅</span>
                <span className={`text-[11px] font-medium ${d.days_to_next_event <= 2 ? 'text-amber-600' : 'text-slate-600'}`}>
                  {d.next_event_name}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border
                  ${d.days_to_next_event <= 2
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                  {d.days_to_next_event}{dayLabel}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ── Static market chips (right, REST-polled) ──────────────────────── */}
        <div className="flex items-center gap-5 px-5 flex-1 overflow-x-auto">
          {quotes.length === 0
            ? MARKET_SYMBOLS.map((sym) => (
                <div key={sym} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase">{sym}</span>
                  <span className="h-4 w-14 bg-slate-100 rounded animate-pulse inline-block" />
                </div>
              ))
            : quotes.map((q) => <MarketChip key={q.symbol} q={q} />)
          }
        </div>

      </div>
    </div>
  )
}
