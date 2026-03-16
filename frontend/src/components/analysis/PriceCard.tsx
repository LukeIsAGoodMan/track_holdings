/**
 * Price hero card — current price, trend state, structure state, scenario bias.
 * Decision-level information only — no raw indicator clutter.
 */
import type { AnalysisResult } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice, fmtPctSigned } from '@/utils/format'

const trendLabels: Record<string, { en: string; zh: string }> = {
  above_sma200: { en: 'Above SMA200', zh: '高于200日均线' },
  below_sma200: { en: 'Below SMA200', zh: '低于200日均线' },
  near_sma200:  { en: 'Near SMA200',  zh: '接近200日均线' },
}

const trendColors: Record<string, string> = {
  above_sma200: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  below_sma200: 'text-rose-700 bg-rose-50 border-rose-200',
  near_sma200:  'text-amber-700 bg-amber-50 border-amber-200',
}

const locationLabels: Record<string, { en: string; zh: string }> = {
  near_support:    { en: 'Near Support',     zh: '接近支撑' },
  near_resistance: { en: 'Near Resistance',  zh: '接近阻力' },
  mid_range:       { en: 'Mid Range',        zh: '区间中部' },
  breakout_zone:   { en: 'Breakout Zone',    zh: '突破区域' },
  breakdown_risk:  { en: 'Breakdown Risk',   zh: '跌破风险' },
}

const locationColors: Record<string, string> = {
  near_support:    'text-emerald-700 bg-emerald-50 border-emerald-200',
  near_resistance: 'text-rose-700 bg-rose-50 border-rose-200',
  mid_range:       'text-slate-600 bg-slate-50 border-slate-200',
  breakout_zone:   'text-sky-700 bg-sky-50 border-sky-200',
  breakdown_risk:  'text-rose-700 bg-rose-50 border-rose-200',
}

const stanceColors: Record<string, string> = {
  constructive:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  neutral:       'text-slate-600 bg-slate-50 border-slate-200',
  cautious:      'text-amber-700 bg-amber-50 border-amber-200',
  defensive:     'text-rose-700 bg-rose-50 border-rose-200',
  opportunistic: 'text-violet-700 bg-violet-50 border-violet-200',
}

const stanceLabels: Record<string, { en: string; zh: string }> = {
  constructive:  { en: 'Constructive',  zh: '积极' },
  neutral:       { en: 'Neutral',       zh: '中性' },
  cautious:      { en: 'Cautious',      zh: '谨慎' },
  defensive:     { en: 'Defensive',     zh: '防御' },
  opportunistic: { en: 'Opportunistic', zh: '机会型' },
}

const actionLabels: Record<string, { en: string; zh: string }> = {
  strong_buy:    { en: 'STRONG BUY',    zh: '强烈买入' },
  defensive_buy: { en: 'DEFENSIVE BUY', zh: '防御买入' },
  hold_watch:    { en: 'HOLD / WATCH',  zh: '持有观望' },
  reduce:        { en: 'REDUCE',        zh: '减仓' },
  stop_loss:     { en: 'STOP LOSS',     zh: '止损' },
}

const actionColors: Record<string, string> = {
  strong_buy:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  defensive_buy:  'text-sky-700 bg-sky-50 border-sky-200',
  hold_watch:     'text-amber-700 bg-amber-50 border-amber-200',
  reduce:         'text-orange-700 bg-orange-50 border-orange-200',
  stop_loss:      'text-rose-700 bg-rose-50 border-rose-200',
}

const gradeColors: Record<string, string> = {
  A: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  B: 'text-sky-600 bg-sky-50 border-sky-200',
  C: 'text-amber-600 bg-amber-50 border-amber-200',
  D: 'text-rose-600 bg-rose-50 border-rose-200',
}

interface Props {
  data: AnalysisResult
}

export default function PriceCard({ data }: Props) {
  const { lang } = useLanguage()
  const { quote, semantic, playbook, confidence, symbol } = data
  const price = quote?.price ?? 0
  const changePct = quote?.change_pct ?? null

  // Explicit enum mapping — no string matching
  const TREND_MAP: Record<string, string> = {
    above_sma200: 'above_sma200',
    below_sma200: 'below_sma200',
    near_sma200:  'near_sma200',
    unavailable:  'near_sma200',
  }
  const trendState = semantic?.trend_state ?? 'unavailable'
  const trendKey = TREND_MAP[trendState] ?? 'near_sma200'

  const locationKey = semantic?.price_location ?? 'mid_range'
  const stanceKey = semantic?.stance ?? 'neutral'
  const actionKey = playbook.action_tag

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col">
      {/* Symbol + Price */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold text-slate-800 tracking-tight">{symbol}</h2>
          {quote?.name && (
            <span className="text-xs text-slate-400 truncate">{quote.name}</span>
          )}
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-slate-900 tabular-nums">
            {fmtPrice(price)}
          </span>
          {changePct != null && (
            <span className={`text-base font-semibold tabular-nums ${
              changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}>
              {fmtPctSigned(changePct)}
            </span>
          )}
        </div>
      </div>

      {/* Trend + Structure */}
      <div className="space-y-2.5 mb-4 flex-1">
        <div>
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-1">
            {lang === 'zh' ? '趋势' : 'Trend'}
          </div>
          <span className={`inline-block px-2.5 py-1 rounded-lg border text-xs font-semibold ${
            trendColors[trendKey] ?? 'text-slate-500 bg-slate-50 border-slate-200'
          }`}>
            {trendLabels[trendKey]?.[lang] ?? trendKey}
          </span>
        </div>
        <div>
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-1">
            {lang === 'zh' ? '结构' : 'Structure'}
          </div>
          <span className={`inline-block px-2.5 py-1 rounded-lg border text-xs font-semibold ${
            locationColors[locationKey] ?? 'text-slate-500 bg-slate-50 border-slate-200'
          }`}>
            {locationLabels[locationKey]?.[lang] ?? locationKey.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Action + Stance + Confidence row */}
      <div className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-100">
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
          actionColors[actionKey] ?? 'text-slate-600 bg-slate-50 border-slate-200'
        }`}>
          {actionLabels[actionKey]?.[lang] ?? actionKey}
        </span>
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
          stanceColors[stanceKey] ?? stanceColors.neutral
        }`}>
          {stanceLabels[stanceKey]?.[lang] ?? stanceKey}
        </span>
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
          gradeColors[confidence.grade] ?? gradeColors.D
        }`}>
          {confidence.grade} ({confidence.score})
        </span>
      </div>
    </div>
  )
}
