/**
 * Hero summary — price, change, confidence grade, bias tag, action tag.
 */
import type { AnalysisResult } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice, fmtPctSigned } from '@/utils/format'

const gradeColors: Record<string, string> = {
  A: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  B: 'text-sky-600 bg-sky-50 border-sky-200',
  C: 'text-amber-600 bg-amber-50 border-amber-200',
  D: 'text-rose-600 bg-rose-50 border-rose-200',
}

const actionColors: Record<string, string> = {
  strong_buy:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  defensive_buy:  'text-sky-700 bg-sky-50 border-sky-200',
  hold_watch:     'text-amber-700 bg-amber-50 border-amber-200',
  reduce:         'text-orange-700 bg-orange-50 border-orange-200',
  stop_loss:      'text-rose-700 bg-rose-50 border-rose-200',
}

const actionLabels: Record<string, { en: string; zh: string }> = {
  strong_buy:    { en: 'STRONG BUY',     zh: '强烈买入' },
  defensive_buy: { en: 'DEFENSIVE BUY',  zh: '防御买入' },
  hold_watch:    { en: 'HOLD / WATCH',   zh: '持有观望' },
  reduce:        { en: 'REDUCE',          zh: '减仓' },
  stop_loss:     { en: 'STOP LOSS',       zh: '止损' },
}

interface Props {
  data: AnalysisResult
}

export default function HeroSummaryCard({ data }: Props) {
  const { lang } = useLanguage()
  const { quote, confidence, playbook, symbol } = data
  const price = quote?.price ?? 0
  const changePct = quote?.change_pct ?? null

  const actionKey = playbook.action_tag
  const actionLabel = actionLabels[actionKey]?.[lang] ?? actionKey.replace(/_/g, ' ').toUpperCase()
  const actionColor = actionColors[actionKey] ?? 'text-slate-600 bg-slate-50 border-slate-200'
  const gradeColor = gradeColors[confidence.grade] ?? gradeColors.D

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left: Symbol + Price */}
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
            {symbol}
            {quote?.name && (
              <span className="ml-2 text-sm font-normal text-slate-400">{quote.name}</span>
            )}
          </h2>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold text-slate-900 tabular-nums">
              {fmtPrice(price)}
            </span>
            {changePct != null && (
              <span
                className={`text-lg font-semibold tabular-nums ${
                  changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {fmtPctSigned(changePct)}
              </span>
            )}
          </div>
        </div>

        {/* Right: Badges */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Confidence grade */}
          <div className={`px-3 py-1.5 rounded-lg border text-sm font-bold ${gradeColor}`}>
            {lang === 'zh' ? '置信度' : 'Confidence'}: {confidence.grade} ({confidence.score})
          </div>

          {/* Action tag */}
          <div className={`px-3 py-1.5 rounded-lg border text-sm font-bold ${actionColor}`}>
            {actionLabel}
          </div>
        </div>
      </div>

      {/* Rationale */}
      {playbook.rationale.length > 0 && (
        <p className="mt-3 text-sm text-slate-500 leading-relaxed">
          {playbook.rationale.join(' · ')}
        </p>
      )}
    </div>
  )
}
