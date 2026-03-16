/**
 * Rhino Battle Report — 4-section structured analysis summary.
 *
 * Sections:
 *   1. Fundamental & valuation anchor (classification + key metrics)
 *   2. Support/resistance ladder (semantic-labeled price levels)
 *   3. Macro radar (risk flags)
 *   4. Tactical playbook (dual-track: upside + downside)
 */
import type { BattleReport } from '@/types'
import { useLanguage } from '@/context/LanguageContext'

interface Props {
  report: BattleReport
}

/* ── Classification colors ──────────────────────────────────────────────── */

const classColors: Record<string, string> = {
  deep_value: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  discount:   'text-emerald-600 bg-emerald-50 border-emerald-200',
  fair:       'text-sky-600 bg-sky-50 border-sky-200',
  premium:    'text-rose-600 bg-rose-50 border-rose-200',
}

const classLabels: Record<string, { en: string; zh: string }> = {
  deep_value: { en: 'Deep Value',  zh: '深度价值' },
  discount:   { en: 'Discount',    zh: '折价' },
  fair:       { en: 'Fair Value',  zh: '合理估值' },
  premium:    { en: 'Premium',     zh: '溢价' },
}

/* ── Ladder label colors ────────────────────────────────────────────────── */

const ladderColors: Record<string, string> = {
  'Structural Reversal': 'text-indigo-700 bg-indigo-50',
  'Regime Line':         'text-purple-700 bg-purple-50',
  'Major':               'text-sky-700 bg-sky-50',
  'Structural':          'text-slate-600 bg-slate-100',
  'Weak':                'text-slate-400 bg-slate-50',
}

/* ── Severity colors ────────────────────────────────────────────────────── */

const severityColors: Record<string, string> = {
  high:   'text-rose-700 bg-rose-50 border-rose-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low:    'text-slate-600 bg-slate-50 border-slate-200',
}

/* ── Action colors ──────────────────────────────────────────────────────── */

const actionColors: Record<string, string> = {
  strong_buy:    'text-emerald-700 bg-emerald-50 border-emerald-200',
  defensive_buy: 'text-sky-700 bg-sky-50 border-sky-200',
  hold_watch:    'text-amber-700 bg-amber-50 border-amber-200',
  reduce:        'text-orange-700 bg-orange-50 border-orange-200',
  stop_loss:     'text-rose-700 bg-rose-50 border-rose-200',
}

const actionLabels: Record<string, { en: string; zh: string }> = {
  strong_buy:    { en: 'STRONG BUY',    zh: '强烈买入' },
  defensive_buy: { en: 'DEFENSIVE BUY', zh: '防御买入' },
  hold_watch:    { en: 'HOLD / WATCH',  zh: '持有观望' },
  reduce:        { en: 'REDUCE',        zh: '减仓' },
  stop_loss:     { en: 'STOP LOSS',     zh: '止损' },
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function RhinoBattleReport({ report }: Props) {
  const { lang } = useLanguage()
  const { fundamental, ladder, macro, playbook } = report

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {lang === 'zh' ? '犀牛作战报告' : 'Rhino Battle Report'}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-slate-100">
        {/* Section 1: Fundamental */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-slate-400 font-medium uppercase">
              {lang === 'zh' ? '估值锚定' : 'Valuation Anchor'}
            </div>
            <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
              classColors[fundamental.classification] ?? 'text-slate-500 bg-slate-50 border-slate-200'
            }`}>
              {classLabels[fundamental.classification]?.[lang] ?? fundamental.label}
            </span>
          </div>
          {fundamental.lines.length > 0 ? (
            <ul className="space-y-1">
              {fundamental.lines.map((line, i) => (
                <li key={i} className="text-xs text-slate-600">{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400 italic">
              {lang === 'zh' ? '估值数据不可用' : 'Valuation data unavailable'}
            </p>
          )}
        </div>

        {/* Section 2: Ladder */}
        <div className="p-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-2">
            {lang === 'zh' ? '支撑/阻力阶梯' : 'Support / Resistance Ladder'}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] text-emerald-600 font-semibold uppercase mb-1">
                {lang === 'zh' ? '支撑' : 'Support'}
              </div>
              {ladder.support.length > 0 ? (
                ladder.support.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-xs text-slate-700 tabular-nums font-medium">
                      ${r.level.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      -{r.dist_pct}%
                    </span>
                    <span className={`text-[9px] px-1 py-px rounded font-medium ${
                      ladderColors[r.label] ?? 'text-slate-400 bg-slate-50'
                    }`}>
                      {r.label}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 italic">—</div>
              )}
            </div>
            <div>
              <div className="text-[10px] text-rose-600 font-semibold uppercase mb-1">
                {lang === 'zh' ? '阻力' : 'Resistance'}
              </div>
              {ladder.resistance.length > 0 ? (
                ladder.resistance.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-xs text-slate-700 tabular-nums font-medium">
                      ${r.level.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      +{r.dist_pct}%
                    </span>
                    <span className={`text-[9px] px-1 py-px rounded font-medium ${
                      ladderColors[r.label] ?? 'text-slate-400 bg-slate-50'
                    }`}>
                      {r.label}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 italic">—</div>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: Macro Radar */}
        <div className="p-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-2">
            {lang === 'zh' ? '宏观雷达' : 'Macro Radar'}
          </div>
          {macro.risks.length > 0 ? (
            <div className="space-y-1.5">
              {macro.risks.map((r, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded-lg border font-medium ${
                  severityColors[r.severity] ?? severityColors.low
                }`}>
                  {r.label}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-emerald-600 font-medium">
              {lang === 'zh' ? '无宏观风险信号' : 'No macro risk signals'}
            </div>
          )}
          {macro.haircut_pct > 0 && (
            <div className="text-[11px] text-amber-600 mt-2">
              {lang === 'zh' ? `估值折扣 ${macro.haircut_pct}%` : `Valuation haircut: ${macro.haircut_pct}%`}
            </div>
          )}
        </div>

        {/* Section 4: Tactical Playbook */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-slate-400 font-medium uppercase">
              {lang === 'zh' ? '战术手册' : 'Tactical Playbook'}
            </div>
            <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
              actionColors[playbook.action_tag] ?? 'text-slate-600 bg-slate-50 border-slate-200'
            }`}>
              {actionLabels[playbook.action_tag]?.[lang] ?? playbook.action_tag}
            </span>
          </div>

          {/* Dual-track: always show both */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100">
              <div className="text-[10px] text-emerald-600 font-semibold uppercase mb-0.5">
                {lang === 'zh' ? '上行' : 'Upside'}
              </div>
              <div className="text-xs text-emerald-700 font-medium tabular-nums">
                {playbook.upside.target_label}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-rose-50/60 border border-rose-100">
              <div className="text-[10px] text-rose-600 font-semibold uppercase mb-0.5">
                {lang === 'zh' ? '下行' : 'Downside'}
              </div>
              <div className="text-xs text-rose-700 font-medium tabular-nums">
                {playbook.downside.stop_label}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 italic">{playbook.risk_rule}</div>
        </div>
      </div>
    </div>
  )
}
