/**
 * Valuation hero card — FY0/FY1/FY2 EPS, avg growth, fair value bar with
 * segmented position indicator, and valuation regime label.
 */
import type { AnalysisValuation } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice } from '@/utils/format'

const statusColors: Record<string, string> = {
  deeply_undervalued: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  undervalued:        'text-emerald-600 bg-emerald-50 border-emerald-200',
  fair_value:         'text-sky-600 bg-sky-50 border-sky-200',
  overvalued:         'text-amber-600 bg-amber-50 border-amber-200',
  deeply_overvalued:  'text-rose-600 bg-rose-50 border-rose-200',
  unavailable:        'text-slate-400 bg-slate-50 border-slate-200',
}

const statusLabels: Record<string, { en: string; zh: string }> = {
  deeply_undervalued: { en: 'Deep Value',   zh: '深度价值' },
  undervalued:        { en: 'Discount',     zh: '折价' },
  fair_value:         { en: 'Fair Value',   zh: '合理估值' },
  overvalued:         { en: 'Premium',      zh: '溢价' },
  deeply_overvalued:  { en: 'Rich',         zh: '高估' },
  unavailable:        { en: 'Unavailable',  zh: '不可用' },
}

interface Props {
  valuation: AnalysisValuation
  price: number
}

export default function ValuationCard({ valuation, price }: Props) {
  const { lang, t } = useLanguage()

  const statusColor = statusColors[valuation.status] ?? statusColors.unavailable
  const statusLabel = statusLabels[valuation.status]?.[lang] ?? valuation.status

  if (!valuation.available) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">
          {t('analysis_valuation')}
        </h3>
        <p className="text-sm text-slate-400 italic flex-1">{t('analysis_val_unavailable')}</p>
      </div>
    )
  }

  const band = valuation.raw_fair_value
  const adjustedBand = valuation.adjusted_fair_value
  const growth = valuation.eps_growth_pct
  const hasHaircut = adjustedBand && band && Math.abs(band.mid - adjustedBand.mid) > 0.01

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {t('analysis_valuation')}
        </h3>
        <span className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Fair value bar — uses raw intrinsic band (pre-haircut) */}
      {band && (
        <div className="mb-4">
          <div className="text-[11px] text-slate-400 font-medium mb-2">
            {lang === 'zh' ? '内在估值区间' : 'Intrinsic valuation band'}
          </div>
          <FairValueBar band={band} price={price} />
          {hasHaircut && adjustedBand && (
            <div className="text-[10px] text-amber-600 mt-1.5">
              {lang === 'zh'
                ? `宏观折扣后: ${fmtPrice(adjustedBand.low)}–${fmtPrice(adjustedBand.high)}`
                : `Macro-adjusted: ${fmtPrice(adjustedBand.low)}–${fmtPrice(adjustedBand.high)}`}
            </div>
          )}
        </div>
      )}

      {/* EPS trajectory: FY0 → FY1 → FY2 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <EpsBox label="FY0" value={valuation.fy0_eps_avg} />
        <EpsBox label="FY1" value={valuation.fy1_eps_avg} />
        <EpsBox label="FY2" value={valuation.fy2_eps_avg} />
      </div>

      {/* Growth + PE band */}
      <div className="flex items-center gap-3 text-xs text-slate-500 mt-auto pt-2 border-t border-slate-100">
        {growth != null && (
          <span>
            <span className="text-slate-400">{lang === 'zh' ? '平均增长' : 'Avg Growth'}:</span>{' '}
            <span className={`font-semibold ${growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {(growth * 100).toFixed(1)}%
            </span>
          </span>
        )}
        {valuation.pe_band_low != null && valuation.pe_band_high != null && (
          <span className="text-slate-400">
            PE {valuation.pe_band_low}–{valuation.pe_band_high}x
          </span>
        )}
      </div>
    </div>
  )
}


function EpsBox({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="text-center p-2.5 rounded-xl bg-slate-50 border border-slate-100">
      <div className="text-[11px] text-slate-400 font-medium">{label} EPS</div>
      <div className="text-sm font-bold text-slate-700 tabular-nums mt-0.5">
        {value != null ? `$${value.toFixed(2)}` : '—'}
      </div>
    </div>
  )
}


function FairValueBar({ band, price }: { band: { low: number; mid: number; high: number }; price: number }) {
  // Visual range extends 15% beyond band endpoints
  const vizMin = band.low * 0.85
  const vizMax = band.high * 1.15
  const range = vizMax - vizMin
  if (range <= 0) return null

  const bandLeftPct = ((band.low - vizMin) / range) * 100
  const bandWidthPct = ((band.high - band.low) / range) * 100
  const midPct = ((band.mid - vizMin) / range) * 100
  const pricePct = Math.min(Math.max(((price - vizMin) / range) * 100, 1), 99)

  // Determine position segment for gradient coloring
  const isBelow = price < band.low
  const isAbove = price > band.high
  const markerColor = isBelow ? '#10b981' : isAbove ? '#ef4444' : '#3b82f6'

  return (
    <div>
      {/* Segmented bar */}
      <div className="relative h-7 bg-slate-100 rounded-lg overflow-hidden">
        {/* Deep value zone (left of band) */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-100/60"
          style={{ left: 0, width: `${bandLeftPct}%` }}
        />
        {/* Fair value zone (band) */}
        <div
          className="absolute top-0 bottom-0 bg-sky-100/80 border-x border-sky-300/40"
          style={{ left: `${bandLeftPct}%`, width: `${bandWidthPct}%` }}
        />
        {/* Premium zone (right of band) */}
        <div
          className="absolute top-0 bottom-0 bg-rose-100/50"
          style={{ left: `${bandLeftPct + bandWidthPct}%`, right: 0 }}
        />
        {/* Midpoint tick */}
        <div
          className="absolute top-0 bottom-0 w-px bg-sky-400/40"
          style={{ left: `${midPct}%` }}
        />
        {/* Price marker — prominent triangle + line */}
        <div
          className="absolute top-0 bottom-0 w-0.5"
          style={{ left: `${pricePct}%`, backgroundColor: markerColor }}
        />
        <div
          className="absolute -top-0.5 w-2.5 h-2.5 rotate-45 rounded-sm"
          style={{
            left: `${pricePct}%`,
            marginLeft: '-5px',
            backgroundColor: markerColor,
          }}
        />
      </div>
      {/* Labels */}
      <div className="flex justify-between mt-1.5 text-[11px] tabular-nums">
        <span className="text-emerald-600 font-medium">{fmtPrice(band.low)}</span>
        <span className="text-sky-500 font-medium">{fmtPrice(band.mid)}</span>
        <span className="text-rose-500 font-medium">{fmtPrice(band.high)}</span>
      </div>
    </div>
  )
}
