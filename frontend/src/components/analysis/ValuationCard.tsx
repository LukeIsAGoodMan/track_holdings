/**
 * Valuation card — EPS estimates, fair value band, status.
 */
import type { AnalysisValuation } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice } from '@/utils/format'

const statusColors: Record<string, string> = {
  deeply_undervalued:  'text-emerald-700',
  undervalued:         'text-emerald-600',
  fair_value:          'text-sky-600',
  overvalued:          'text-amber-600',
  deeply_overvalued:   'text-rose-600',
  unavailable:         'text-slate-400',
}

const statusLabels: Record<string, { en: string; zh: string }> = {
  deeply_undervalued:  { en: 'Deeply Undervalued', zh: '严重低估' },
  undervalued:         { en: 'Undervalued',        zh: '低估' },
  fair_value:          { en: 'Fair Value',          zh: '合理估值' },
  overvalued:          { en: 'Overvalued',          zh: '高估' },
  deeply_overvalued:   { en: 'Deeply Overvalued',   zh: '严重高估' },
  unavailable:         { en: 'Unavailable',         zh: '不可用' },
}

interface Props {
  valuation: AnalysisValuation
  price: number
}

export default function ValuationCard({ valuation, price }: Props) {
  const { lang, t } = useLanguage()

  const statusColor = statusColors[valuation.status] ?? 'text-slate-500'
  const statusLabel = statusLabels[valuation.status]?.[lang] ?? valuation.status

  if (!valuation.available) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">
          {t('analysis_valuation')}
        </h3>
        <p className="text-sm text-slate-400 italic">{t('analysis_val_unavailable')}</p>
      </div>
    )
  }

  const band = valuation.adjusted_fair_value
  const growth = valuation.eps_growth_pct

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
        {t('analysis_valuation')}
      </h3>

      {/* Status badge */}
      <div className={`text-lg font-bold mb-3 ${statusColor}`}>
        {statusLabel}
      </div>

      {/* Fair value band visual */}
      {band && (
        <div className="mb-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-1.5">
            {t('analysis_fair_value_band')}
          </div>
          <div className="relative h-8 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden">
            {/* Band fill */}
            {(() => {
              const min = band.low * 0.8
              const max = band.high * 1.2
              const range = max - min
              const leftPct = ((band.low - min) / range) * 100
              const widthPct = ((band.high - band.low) / range) * 100
              const pricePct = ((price - min) / range) * 100
              return (
                <>
                  <div
                    className="absolute top-0 bottom-0 bg-sky-100 border-x border-sky-200"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-slate-800"
                    style={{ left: `${Math.min(Math.max(pricePct, 2), 98)}%` }}
                    title={`Price: ${fmtPrice(price)}`}
                  />
                </>
              )
            })()}
          </div>
          <div className="flex justify-between mt-1 text-[11px] text-slate-400 tabular-nums">
            <span>{fmtPrice(band.low)}</span>
            <span>{fmtPrice(band.high)}</span>
          </div>
        </div>
      )}

      {/* EPS estimates */}
      <div className="grid grid-cols-2 gap-3">
        {valuation.fy1_eps_avg != null && (
          <div className="text-center p-2 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-[11px] text-slate-400 font-medium">FY1 EPS</div>
            <div className="text-sm font-bold text-slate-700 tabular-nums">
              ${valuation.fy1_eps_avg.toFixed(2)}
            </div>
          </div>
        )}
        {valuation.fy2_eps_avg != null && (
          <div className="text-center p-2 rounded-xl bg-slate-50 border border-slate-100">
            <div className="text-[11px] text-slate-400 font-medium">FY2 EPS</div>
            <div className="text-sm font-bold text-slate-700 tabular-nums">
              ${valuation.fy2_eps_avg.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Growth */}
      {growth != null && (
        <div className="mt-2 text-xs text-slate-500">
          {lang === 'zh' ? 'EPS增长' : 'EPS Growth'}: {(growth * 100).toFixed(1)}%
        </div>
      )}
    </div>
  )
}
