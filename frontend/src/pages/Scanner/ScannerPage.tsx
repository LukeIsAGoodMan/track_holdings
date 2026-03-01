/**
 * Market Scanner / Opportunities Page
 *
 * Displays IV Rank & IV Percentile for a watchlist of symbols.
 * - Color-coded IV Rank bars (red = high IV = sell premium, green = low IV = cheap options)
 * - Live updates via WebSocket `market_opportunity` messages
 * - Initial data via REST `GET /api/scanner/opportunities`
 * - i18n via useLanguage()
 */
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchOpportunities } from '@/api/holdings'
import type { MarketOpportunity } from '@/types'
import { fmtNum } from '@/utils/format'
import type { TKey } from '@/i18n/translations'

// ── Signal badge colors ──────────────────────────────────────────────────────
const signalStyles: Record<MarketOpportunity['signal'], { bg: string; text: string }> = {
  HIGH_IV:     { bg: 'bg-red-500/20',    text: 'text-red-400' },
  ELEVATED_IV: { bg: 'bg-amber-500/20',  text: 'text-amber-400' },
  LOW_IV:      { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  NEUTRAL:     { bg: 'bg-slate-500/20',  text: 'text-slate-400' },
}

const signalKey: Record<MarketOpportunity['signal'], TKey> = {
  HIGH_IV:     'signal_high_iv',
  ELEVATED_IV: 'signal_elevated',
  LOW_IV:      'signal_low_iv',
  NEUTRAL:     'signal_neutral',
}

// ── IV Rank bar ──────────────────────────────────────────────────────────────
function IVRankBar({ rank }: { rank: number }) {
  const pct = Math.round(rank * 100)
  // Color gradient: green (low) → amber (mid) → red (high)
  let barColor = 'bg-emerald-500'
  if (pct > 80) barColor = 'bg-red-500'
  else if (pct > 60) barColor = 'bg-amber-500'
  else if (pct > 40) barColor = 'bg-yellow-500'

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums w-8 text-right">{pct}%</span>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { t } = useLanguage()
  const { lastOpportunitiesUpdate } = useWebSocket()
  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([])
  const [loading, setLoading] = useState(true)

  // Initial REST fetch
  useEffect(() => {
    fetchOpportunities()
      .then(setOpportunities)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Live WS updates
  useEffect(() => {
    if (lastOpportunitiesUpdate) {
      setOpportunities(lastOpportunitiesUpdate)
    }
  }, [lastOpportunitiesUpdate])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">{t('scanner_title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('scanner_sub')}</p>
      </div>

      {/* Table */}
      <div className="bg-card border border-line rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-4 py-8 text-center text-slate-500 animate-pulse">
            {t('scanner_loading')}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500">
            {t('scanner_empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-slate-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">{t('symbol')}</th>
                  <th className="text-right px-4 py-3 font-medium">{t('price')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('col_iv_rank')}</th>
                  <th className="text-right px-4 py-3 font-medium">{t('col_iv_pctl')}</th>
                  <th className="text-right px-4 py-3 font-medium">{t('col_current_hv')}</th>
                  <th className="text-center px-4 py-3 font-medium">{t('col_hv_range')}</th>
                  <th className="text-center px-4 py-3 font-medium">Signal</th>
                  <th className="text-left px-4 py-3 font-medium">{t('col_suggestion')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {opportunities.map((opp) => {
                  const rank = parseFloat(opp.iv_rank)
                  const pctl = parseFloat(opp.iv_percentile)
                  const hv = parseFloat(opp.current_hv)
                  const hvHigh = parseFloat(opp.hv_52w_high)
                  const hvLow = parseFloat(opp.hv_52w_low)
                  const style = signalStyles[opp.signal]

                  return (
                    <tr
                      key={opp.symbol}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Symbol */}
                      <td className="px-4 py-3 font-semibold text-slate-100">
                        {opp.symbol}
                      </td>

                      {/* Price */}
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {opp.spot_price ? `$${fmtNum(opp.spot_price, 2)}` : '—'}
                      </td>

                      {/* IV Rank bar */}
                      <td className="px-4 py-3">
                        <IVRankBar rank={rank} />
                      </td>

                      {/* IV Percentile */}
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {Math.round(pctl * 100)}%
                      </td>

                      {/* Current HV */}
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                        {(hv * 100).toFixed(1)}%
                      </td>

                      {/* 52w HV Range */}
                      <td className="px-4 py-3 text-center tabular-nums text-slate-500 text-xs">
                        {(hvLow * 100).toFixed(1)}% — {(hvHigh * 100).toFixed(1)}%
                      </td>

                      {/* Signal badge */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
                          {t(signalKey[opp.signal])}
                        </span>
                      </td>

                      {/* Suggestion */}
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-xs">
                        {opp.suggestion}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
