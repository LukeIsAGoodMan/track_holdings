/**
 * MarketTicker — Horizontal market data bar (light theme)
 *
 * Left (pinned): SPX | VIX | Next macro event
 * Right (scroll): real-time portfolio symbol prices from WS spot_update
 *
 * Scrolling uses a CSS marquee animation that duplicates items for
 * a seamless infinite loop. Only activates when WS delivers spot data.
 */
import { useMemo } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import type { HoldingGroup } from '@/types'

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

// Symbols shown in the pinned macro section — excluded from scrolling ticker
const MACRO_SYMBOLS = new Set(['SPY', 'QQQ', 'VIX', 'SPX'])

interface TickerItem {
  symbol: string
  price: string
  changePct: string | null
}

function TickerChip({ item }: { item: TickerItem }) {
  const pct = item.changePct != null ? parseFloat(item.changePct) : null
  const up = pct == null || pct >= 0
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap select-none">
      <span className="text-xs font-bold text-slate-700">{item.symbol}</span>
      <span className="text-xs tabular-nums text-slate-500">${parseFloat(item.price).toFixed(2)}</span>
      {pct != null && (
        <span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border
          ${up
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
      <span className="text-slate-200 mx-2">|</span>
    </span>
  )
}

export default function MarketTicker({ fallbackHoldings = [] }: { fallbackHoldings?: HoldingGroup[] }) {
  const { lang } = useLanguage()
  const { lastMacroTicker, lastSpotUpdate, lastSpotChangePct } = useWebSocket()

  // Build scrolling ticker items:
  // 1st priority: WS live spot_update (real-time prices + % change)
  // 2nd priority: holdings snapshot from REST (spot_price without change %)
  // → guarantees the ticker is always populated even on WS cold-start
  const tickerItems = useMemo<TickerItem[]>(() => {
    const hasWs = lastSpotUpdate && Object.keys(lastSpotUpdate).length > 0
    if (hasWs) {
      return Object.entries(lastSpotUpdate!)
        .filter(([sym]) => !MACRO_SYMBOLS.has(sym))
        .map(([sym, price]) => ({
          symbol: sym,
          price,
          changePct: lastSpotChangePct?.[sym] ?? null,
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    }
    // Fallback: use holdings REST snapshot prices (no change %, refreshes every REST poll)
    if (fallbackHoldings.length > 0) {
      return fallbackHoldings
        .filter((g) => g.spot_price != null)
        .map((g) => ({
          symbol: g.symbol,
          price:  g.spot_price!,
          changePct: null,
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    }
    return []
  }, [lastSpotUpdate, lastSpotChangePct, fallbackHoldings])

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

  const hasScroll = tickerItems.length > 0

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm font-sans overflow-hidden">
      <div className="flex items-center h-11">
        {/* ── Pinned macro data (left) ────────────────────────────────── */}
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

        {/* ── Scrolling portfolio ticker (right) ──────────────────────── */}
        {hasScroll ? (
          <div className="flex-1 overflow-hidden h-full flex items-center relative">
            {/* Fade masks */}
            <div className="absolute left-0 top-0 bottom-0 w-6 z-10 bg-gradient-to-r from-white to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-6 z-10 bg-gradient-to-l from-white to-transparent pointer-events-none" />

            {/* Marquee track — duplicate items for seamless loop */}
            <div
              className="flex items-center"
              style={{
                animation: `ticker-scroll ${Math.max(15, tickerItems.length * 4)}s linear infinite`,
                willChange: 'transform',
              }}
            >
              {/* Original + duplicate for seamless wrap */}
              {[...tickerItems, ...tickerItems].map((item, i) => (
                <TickerChip key={`${item.symbol}-${i}`} item={item} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 px-4 text-[11px] text-slate-300 italic">
            {lang === 'zh' ? '等待实时行情...' : 'Waiting for live prices…'}
          </div>
        )}
      </div>

      {/* CSS keyframes injected inline */}
      <style>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}
