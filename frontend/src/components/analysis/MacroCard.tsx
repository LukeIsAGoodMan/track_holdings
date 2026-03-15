/**
 * Macro card — VIX regime, treasury rate, haircut.
 *
 * Shows "unavailable" state truthfully when data is missing — never
 * displays fake "normal" or "neutral" labels for absent data.
 */
import type { AnalysisMacro } from '@/types'
import { useLanguage } from '@/context/LanguageContext'

const regimeColors: Record<string, string> = {
  calm:        'text-emerald-700 bg-emerald-50 border-emerald-200',
  normal:      'text-sky-700 bg-sky-50 border-sky-200',
  elevated:    'text-amber-700 bg-amber-50 border-amber-200',
  crisis:      'text-rose-700 bg-rose-50 border-rose-200',
  unavailable: 'text-slate-400 bg-slate-50 border-slate-200',
}

const regimeLabels: Record<string, { en: string; zh: string }> = {
  calm:        { en: 'Calm',        zh: '平静' },
  normal:      { en: 'Normal',      zh: '正常' },
  elevated:    { en: 'Elevated',    zh: '偏高' },
  crisis:      { en: 'Crisis',      zh: '危机' },
  unavailable: { en: 'Unavailable', zh: '不可用' },
}

const pressureColors: Record<string, string> = {
  supportive:  'text-emerald-600',
  neutral:     'text-sky-600',
  restrictive: 'text-amber-600',
  hostile:     'text-rose-600',
  unavailable: 'text-slate-400',
}

const pressureLabels: Record<string, { en: string; zh: string }> = {
  supportive:  { en: 'Supportive',  zh: '宽松' },
  neutral:     { en: 'Neutral',     zh: '中性' },
  restrictive: { en: 'Restrictive', zh: '紧缩' },
  hostile:     { en: 'Hostile',     zh: '严峻' },
  unavailable: { en: 'Unavailable', zh: '不可用' },
}

interface Props {
  macro: AnalysisMacro
}

export default function MacroCard({ macro }: Props) {
  const { lang, t } = useLanguage()
  const regimeColor = regimeColors[macro.vix_regime] ?? regimeColors.unavailable
  const regimeLabel = regimeLabels[macro.vix_regime]?.[lang] ?? macro.vix_regime
  const pressureColor = pressureColors[macro.rate_pressure_regime] ?? pressureColors.unavailable
  const pressureLabel = pressureLabels[macro.rate_pressure_regime]?.[lang] ?? macro.rate_pressure_regime

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
        {t('analysis_macro')}
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* VIX */}
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-[11px] text-slate-400 font-medium uppercase">VIX</div>
          <div className="text-lg font-bold text-slate-700 tabular-nums mt-0.5">
            {macro.vix_level != null ? macro.vix_level.toFixed(1) : '—'}
          </div>
          {macro.vix_regime !== 'unavailable' ? (
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${regimeColor}`}>
              {regimeLabel}
            </span>
          ) : (
            <span className="inline-block mt-1 text-[11px] text-slate-400 italic">
              {regimeLabel}
            </span>
          )}
        </div>

        {/* Treasury */}
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-[11px] text-slate-400 font-medium uppercase">10Y Treasury</div>
          <div className="text-lg font-bold text-slate-700 tabular-nums mt-0.5">
            {macro.treasury_10y != null ? `${macro.treasury_10y.toFixed(2)}%` : '—'}
          </div>
          <span className={`inline-block mt-1 text-[11px] font-medium ${pressureColor}`}>
            {pressureLabel}
          </span>
        </div>
      </div>

      {/* Haircut — only show when data-backed, not from unavailable inputs */}
      {macro.recommended_haircut_pct > 0 && macro.vix_regime !== 'unavailable' && (
        <div className="text-xs text-amber-600 font-medium">
          {lang === 'zh' ? `估值折扣 ${macro.recommended_haircut_pct}%` : `Valuation haircut: ${macro.recommended_haircut_pct}%`}
        </div>
      )}

      {/* Alerts */}
      {macro.alerts.length > 0 && (
        <div className="mt-3 space-y-1">
          {macro.alerts.map((alert, i) => (
            <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
              {alert}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
