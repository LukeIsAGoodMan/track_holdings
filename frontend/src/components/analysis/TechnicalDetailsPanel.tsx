/**
 * Technical details panel — secondary information relocated from the hero area.
 * Shows SMA values, ATR, volume metrics, support/resistance lists, pattern tags.
 * Collapsible to reduce visual weight.
 */
import { useState } from 'react'
import type { AnalysisTechnical } from '@/types'
import { useLanguage } from '@/context/LanguageContext'
import { fmtPrice, fmtCompact } from '@/utils/format'

const patternLabels: Record<string, { en: string; zh: string }> = {
  above_sma200:         { en: 'Above SMA200',          zh: '高于200日均线' },
  below_sma200:         { en: 'Below SMA200',          zh: '低于200日均线' },
  high_volume:          { en: 'High Volume',           zh: '放量' },
  low_volume:           { en: 'Low Volume',            zh: '缩量' },
  break_below_support:  { en: 'Break Below Support',   zh: '跌破支撑' },
  dead_cat_bounce:      { en: 'Dead Cat Bounce',       zh: '死猫反弹' },
  reversal_at_support:  { en: 'Reversal at Support',   zh: '支撑位反转' },
  false_break_recovery: { en: 'False Break Recovery',  zh: '假突破恢复' },
  limbo_zone:           { en: 'Limbo Zone',            zh: '中间区域' },
}

const patternColors: Record<string, string> = {
  above_sma200:         'text-emerald-700 bg-emerald-50 border-emerald-200',
  below_sma200:         'text-rose-700 bg-rose-50 border-rose-200',
  break_below_support:  'text-rose-700 bg-rose-50 border-rose-200',
  dead_cat_bounce:      'text-amber-700 bg-amber-50 border-amber-200',
  reversal_at_support:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  false_break_recovery: 'text-sky-700 bg-sky-50 border-sky-200',
  limbo_zone:           'text-slate-600 bg-slate-100 border-slate-200',
}

interface Props {
  technical: AnalysisTechnical
  price: number
}

export default function TechnicalDetailsPanel({ technical, price }: Props) {
  const { lang, t } = useLanguage()
  const [open, setOpen] = useState(false)

  const stats = [
    { label: 'SMA 30',  value: technical.sma30 != null ? fmtPrice(technical.sma30) : '—' },
    { label: 'SMA 100', value: technical.sma100 != null ? fmtPrice(technical.sma100) : '—' },
    { label: 'SMA 200', value: technical.sma200 != null ? fmtPrice(technical.sma200) : '—' },
    { label: 'ATR 20',  value: technical.atr20 != null ? fmtPrice(technical.atr20) : '—' },
    {
      label: lang === 'zh' ? '量比' : 'Vol Ratio',
      value: technical.volume_ratio != null ? `${technical.volume_ratio.toFixed(1)}x` : '—',
    },
    {
      label: lang === 'zh' ? '50日均量' : 'Avg Vol 50',
      value: technical.avg_volume_50 != null ? fmtCompact(technical.avg_volume_50) : '—',
    },
  ]

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
      >
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {t('analysis_technical')} {lang === 'zh' ? '详情' : 'Details'}
        </h3>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-4 pt-1 border-t border-slate-100">
          {/* Stats row */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {stats.map(({ label, value }) => (
              <div key={label} className="text-center p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[10px] text-slate-400 font-medium uppercase">{label}</div>
                <div className="text-xs font-bold text-slate-700 mt-0.5 tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          {/* Support / Resistance zones */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <div className="text-[11px] text-emerald-600 font-semibold uppercase mb-1">
                {t('analysis_support')} ({technical.support_zones.length})
              </div>
              {technical.support_zones.slice(0, 5).map((z, i) => {
                const pct = price > 0 ? ((price - z.center) / price * 100).toFixed(1) : '—'
                return (
                  <div key={i} className="text-xs text-slate-600 py-0.5 tabular-nums">
                    {fmtPrice(z.center)} <span className="text-slate-400">({pct !== '—' ? `${pct}%` : '—'})</span>
                  </div>
                )
              })}
              {technical.support_zones.length === 0 && (
                <div className="text-xs text-slate-400 italic">—</div>
              )}
            </div>
            <div>
              <div className="text-[11px] text-rose-600 font-semibold uppercase mb-1">
                {t('analysis_resistance')} ({technical.resistance_zones.length})
              </div>
              {technical.resistance_zones.slice(0, 5).map((z, i) => {
                const pct = price > 0 ? ((z.center - price) / price * 100).toFixed(1) : '—'
                return (
                  <div key={i} className="text-xs text-slate-600 py-0.5 tabular-nums">
                    {fmtPrice(z.center)} <span className="text-slate-400">({pct !== '—' ? `+${pct}%` : '—'})</span>
                  </div>
                )
              })}
              {technical.resistance_zones.length === 0 && (
                <div className="text-xs text-slate-400 italic">—</div>
              )}
            </div>
          </div>

          {/* Pattern tags */}
          {technical.pattern_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {technical.pattern_tags.map((tag) => {
                const label = patternLabels[tag]?.[lang] ?? tag.replace(/_/g, ' ')
                const color = patternColors[tag] ?? 'text-slate-600 bg-slate-100 border-slate-200'
                return (
                  <span key={tag} className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${color}`}>
                    {label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
