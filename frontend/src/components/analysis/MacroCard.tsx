/**
 * Macro hero card — VIX regime, treasury rate, haircut, macro warnings.
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
  supportive:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  neutral:     'text-sky-700 bg-sky-50 border-sky-200',
  restrictive: 'text-amber-700 bg-amber-50 border-amber-200',
  hostile:     'text-rose-700 bg-rose-50 border-rose-200',
  unavailable: 'text-slate-400 bg-slate-50 border-slate-200',
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
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
        {t('analysis_macro')}
      </h3>

      <div className="space-y-3 flex-1">
        {/* VIX */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div>
            <div className="text-[11px] text-slate-400 font-medium uppercase">VIX</div>
            <div className="text-xl font-bold text-slate-700 tabular-nums mt-0.5">
              {macro.vix_level != null ? macro.vix_level.toFixed(1) : '—'}
            </div>
          </div>
          {macro.vix_regime !== 'unavailable' ? (
            <span className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${regimeColor}`}>
              {regimeLabel}
            </span>
          ) : (
            <span className="text-xs text-slate-400 italic">{regimeLabel}</span>
          )}
        </div>

        {/* Treasury */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div>
            <div className="text-[11px] text-slate-400 font-medium uppercase">10Y Treasury</div>
            <div className="text-xl font-bold text-slate-700 tabular-nums mt-0.5">
              {macro.treasury_10y != null ? `${macro.treasury_10y.toFixed(2)}%` : '—'}
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${pressureColor}`}>
            {pressureLabel}
          </span>
        </div>
      </div>

      {/* Haircut + Alerts */}
      <div className="mt-auto pt-3 border-t border-slate-100 space-y-1.5">
        {macro.recommended_haircut_pct > 0 && macro.vix_regime !== 'unavailable' && (
          <div className="text-xs text-amber-600 font-medium">
            {lang === 'zh' ? `估值折扣 ${macro.recommended_haircut_pct}%` : `Valuation haircut: ${macro.recommended_haircut_pct}%`}
          </div>
        )}
        {macro.alerts.map((alert, i) => (
          <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
            {alert}
          </div>
        ))}
      </div>
    </div>
  )
}
