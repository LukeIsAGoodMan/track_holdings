/**
 * Market Scanner / Opportunities Page — light professional theme
 */
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'
import { fetchOpportunities } from '@/api/holdings'
import type { MarketOpportunity } from '@/types'
import { fmtNum } from '@/utils/format'
import type { TKey } from '@/i18n/translations'

// ── Signal badge styles (light theme) ────────────────────────────────────────
const signalStyles: Record<MarketOpportunity['signal'], { bg: string; text: string; border: string }> = {
  HIGH_IV:     { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200'    },
  ELEVATED_IV: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
  LOW_IV:      { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  NEUTRAL:     { bg: 'bg-slate-100',  text: 'text-slate-500',   border: 'border-slate-200'   },
}

const signalKey: Record<MarketOpportunity['signal'], TKey> = {
  HIGH_IV:     'signal_high_iv',
  ELEVATED_IV: 'signal_elevated',
  LOW_IV:      'signal_low_iv',
  NEUTRAL:     'signal_neutral',
}

// ── IV Rank bar (light theme) ────────────────────────────────────────────────
function IVRankBar({ rank }: { rank: number }) {
  const pct = Math.round(rank * 100)
  let barColor = 'bg-emerald-500'
  if (pct > 80) barColor = 'bg-rose-500'
  else if (pct > 60) barColor = 'bg-amber-500'
  else if (pct > 40) barColor = 'bg-yellow-400'

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right text-slate-600 font-medium">{pct}%</span>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { t } = useLanguage()
  const { lastOpportunitiesUpdate } = useWebSocket()
  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOpportunities().then(setOpportunities).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (lastOpportunitiesUpdate) setOpportunities(lastOpportunitiesUpdate)
  }, [lastOpportunitiesUpdate])

  return (
    <div className="max-w-7xl mx-auto space-y-5 font-sans">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('scanner_title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('scanner_sub')}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="inline-flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              <span className="text-sm text-slate-400">{t('scanner_loading')}</span>
            </div>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="px-4 py-12 text-center text-slate-400 text-sm">{t('scanner_empty')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th-left">{t('symbol')}</th>
                  <th className="th">{t('price')}</th>
                  <th className="th-left" style={{ minWidth: 160 }}>{t('col_iv_rank')}</th>
                  <th className="th">{t('col_iv_pctl')}</th>
                  <th className="th">{t('col_current_hv')}</th>
                  <th className="th">{t('col_hv_range')}</th>
                  <th className="th">Signal</th>
                  <th className="th-left">{t('col_suggestion')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {opportunities.map((opp) => {
                  const rank   = parseFloat(opp.iv_rank)
                  const pctl   = parseFloat(opp.iv_percentile)
                  const hv     = parseFloat(opp.current_hv)
                  const hvHigh = parseFloat(opp.hv_52w_high)
                  const hvLow  = parseFloat(opp.hv_52w_low)
                  const style  = signalStyles[opp.signal]
                  return (
                    <tr key={opp.symbol} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900">{opp.symbol}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700 font-medium">
                        {opp.spot_price ? `$${fmtNum(opp.spot_price)}` : '—'}
                      </td>
                      <td className="px-4 py-3"><IVRankBar rank={rank} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {Math.round(pctl * 100)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {(hv * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-slate-400 text-xs">
                        {(hvLow * 100).toFixed(1)}% — {(hvHigh * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border
                          ${style.bg} ${style.text} ${style.border}`}>
                          {t(signalKey[opp.signal])}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-xs">{opp.suggestion}</td>
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
