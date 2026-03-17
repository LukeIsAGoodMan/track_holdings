/**
 * Rhino Battle Report -- 4-section structured analysis with bilingual narrative.
 *
 * Sections:
 *   1. Valuation Anchor (narrative + classification + key metrics)
 *   2. Battlefield Structure (narrative + semantic-labeled price levels)
 *   3. Macro Radar + Volume Mirror (narrative + risk flags)
 *   4. Rhino Tactical Playbook (narrative + dual-track: upside + downside)
 */
import type { BattleReport } from '@/types'
import { useLanguage } from '@/context/LanguageContext'

interface Props {
  report: BattleReport
}

/* -- Classification colors ------------------------------------------------- */

const classColors: Record<string, string> = {
  deep_value: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  discount:   'text-emerald-600 bg-emerald-50 border-emerald-200',
  fair:       'text-sky-600 bg-sky-50 border-sky-200',
  premium:    'text-rose-600 bg-rose-50 border-rose-200',
}

const classLabels: Record<string, { en: string; zh: string }> = {
  deep_value: { en: 'Deep Value',  zh: '\u6df1\u5ea6\u4ef7\u503c' },
  discount:   { en: 'Discount',    zh: '\u6298\u4ef7' },
  fair:       { en: 'Fair Value',  zh: '\u5408\u7406\u4f30\u503c' },
  premium:    { en: 'Premium',     zh: '\u6ea2\u4ef7' },
}

/* -- Ladder label colors & bilingual names --------------------------------- */

const ladderColors: Record<string, string> = {
  'Structural Reversal': 'text-indigo-700 bg-indigo-50',
  'Regime Line':         'text-purple-700 bg-purple-50',
  'Major':               'text-sky-700 bg-sky-50',
  'Structural':          'text-slate-600 bg-slate-100',
  'Weak':                'text-slate-400 bg-slate-50',
}

const ladderLabels: Record<string, { en: string; zh: string }> = {
  'Structural Reversal': { en: 'Structural Reversal', zh: '\u7ed3\u6784\u53cd\u8f6c' },
  'Regime Line':         { en: 'Regime Line',         zh: '\u8d8b\u52bf\u7ebf' },
  'Major':               { en: 'Major',               zh: '\u4e3b\u8981' },
  'Structural':          { en: 'Structural',          zh: '\u7ed3\u6784' },
  'Weak':                { en: 'Weak',                zh: '\u5f31' },
}

/* -- Severity colors ------------------------------------------------------- */

const severityColors: Record<string, string> = {
  high:   'text-rose-700 bg-rose-50 border-rose-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low:    'text-slate-600 bg-slate-50 border-slate-200',
  info:   'text-sky-600 bg-sky-50 border-sky-200',
}

/* -- Action colors & labels ------------------------------------------------ */

const actionColors: Record<string, string> = {
  strong_buy:    'text-emerald-700 bg-emerald-50 border-emerald-200',
  defensive_buy: 'text-sky-700 bg-sky-50 border-sky-200',
  hold_watch:    'text-amber-700 bg-amber-50 border-amber-200',
  reduce:        'text-orange-700 bg-orange-50 border-orange-200',
  stop_loss:     'text-rose-700 bg-rose-50 border-rose-200',
}

const actionLabels: Record<string, { en: string; zh: string }> = {
  strong_buy:    { en: 'STRONG BUY',    zh: '\u5f3a\u70c8\u4e70\u5165' },
  defensive_buy: { en: 'DEFENSIVE BUY', zh: '\u9632\u5fa1\u4e70\u5165' },
  hold_watch:    { en: 'HOLD / WATCH',  zh: '\u6301\u6709\u89c2\u671b' },
  reduce:        { en: 'REDUCE',        zh: '\u51cf\u4ed3' },
  stop_loss:     { en: 'STOP LOSS',     zh: '\u6b62\u635f' },
}

/* -- Narrative paragraph component ----------------------------------------- */

function NarrativeParagraph({ text }: { text?: string }) {
  if (!text) return null
  return (
    <p className="text-xs text-slate-500 leading-relaxed mb-2">
      {text}
    </p>
  )
}

/* -- Bilingual helper ------------------------------------------------------ */

function l(lang: string, en: string, zh: string): string {
  return lang === 'zh' ? zh : en
}

/* -- Main component -------------------------------------------------------- */

const marketStateStyle: Record<string, { en: string; zh: string; color: string; bg: string }> = {
  TRENDING:       { en: 'TRENDING',       zh: '\u8d8b\u52bf', color: '#059669', bg: '#ecfdf5' },
  RANGE:          { en: 'RANGE',          zh: '\u9707\u8361', color: '#d97706', bg: '#fffbeb' },
  BREAKDOWN_RISK: { en: 'BREAKDOWN RISK', zh: '\u7834\u4f4d\u98ce\u9669', color: '#dc2626', bg: '#fef2f2' },
}

export default function RhinoBattleReport({ report }: Props) {
  const { lang } = useLanguage()
  const { fundamental, ladder, macro, playbook, narrative } = report

  const ms = marketStateStyle[report.market_state ?? 'RANGE'] ?? marketStateStyle.RANGE

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          {l(lang, 'Rhino Battle Report', '\u7280\u725b\u54e5\u6218\u62a5')}
        </h3>
        <div className="flex items-center gap-3">
          {/* Market state badge */}
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{ color: ms.color, backgroundColor: ms.bg, borderColor: ms.color + '33' }}
          >
            {lang === 'zh' ? ms.zh : ms.en}
          </span>
          {/* Space awareness */}
          {report.upside_pct != null && (
            <span className="text-[10px] text-emerald-600 font-medium tabular-nums">
              {'\u25b2'} {report.upside_pct}%
            </span>
          )}
          {report.downside_pct != null && (
            <span className="text-[10px] text-rose-600 font-medium tabular-nums">
              {'\u25bc'} {report.downside_pct}%
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-slate-100">
        {/* Section 1: Valuation Anchor */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-slate-400 font-medium uppercase">
              {l(lang, 'Valuation Anchor', '\u4f30\u503c\u951a\u70b9')}
            </div>
            <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
              classColors[fundamental.classification] ?? 'text-slate-500 bg-slate-50 border-slate-200'
            }`}>
              {classLabels[fundamental.classification]?.[lang] ?? fundamental.label}
            </span>
          </div>
          <NarrativeParagraph text={narrative?.fundamental} />
          {fundamental.lines.length > 0 ? (
            <ul className="space-y-1">
              {fundamental.lines.map((line, i) => (
                <li key={i} className="text-xs text-slate-600">{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400 italic">
              {l(lang, 'Valuation data unavailable', '\u4f30\u503c\u6570\u636e\u4e0d\u53ef\u7528')}
            </p>
          )}
        </div>

        {/* Section 2: Battlefield Structure */}
        <div className="p-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-2">
            {l(lang, 'Battlefield Structure', '\u5e02\u573a\u6218\u573a\u7ed3\u6784')}
          </div>
          <NarrativeParagraph text={narrative?.battlefield} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] text-emerald-600 font-semibold uppercase mb-1">
                {l(lang, 'Support', '\u652f\u6491')}
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
                      {ladderLabels[r.label]?.[lang] ?? r.label_zh ?? r.label}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 italic">&mdash;</div>
              )}
            </div>
            <div>
              <div className="text-[10px] text-rose-600 font-semibold uppercase mb-1">
                {l(lang, 'Resistance', '\u963b\u529b')}
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
                      {ladderLabels[r.label]?.[lang] ?? r.label_zh ?? r.label}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 italic">&mdash;</div>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: Macro Radar */}
        <div className="p-4">
          <div className="text-[11px] text-slate-400 font-medium uppercase mb-2">
            {l(lang, 'Macro Radar', '\u5b8f\u89c2\u96f7\u8fbe\u4e0e\u6210\u4ea4\u91cf\u7167\u5996\u955c')}
          </div>
          <NarrativeParagraph text={narrative?.macro} />
          {macro.risks.length > 0 ? (
            <div className="space-y-1.5">
              {macro.risks.map((r, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded-lg border font-medium ${
                  severityColors[r.severity] ?? severityColors.low
                }`}>
                  {lang === 'zh' ? (r.label_zh ?? r.label) : r.label}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-emerald-600 font-medium">
              {l(lang, 'No macro risk signals', '\u65e0\u5b8f\u89c2\u98ce\u9669\u4fe1\u53f7')}
            </div>
          )}
          {macro.haircut_pct > 0 && (
            <div className="text-[11px] text-amber-600 mt-2">
              {lang === 'zh'
                ? `\u4f30\u503c\u6298\u6263 ${macro.haircut_pct}%`
                : `Valuation haircut: ${macro.haircut_pct}%`}
            </div>
          )}
        </div>

        {/* Section 4: Tactical Playbook */}
        <div className="p-4 bg-slate-50/70 border-l-4 border-indigo-500">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
              {l(lang, 'Tactical Playbook', '\u7280\u725b\u54e5\u6267\u884c\u5267\u672c')}
            </div>
            <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${
              actionColors[playbook.action_tag] ?? 'text-slate-600 bg-slate-50 border-slate-200'
            }`}>
              {actionLabels[playbook.action_tag]?.[lang] ?? playbook.action_tag}
            </span>
          </div>
          <NarrativeParagraph text={narrative?.playbook} />

          {/* Scenario tree: trigger -> target */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100">
              <div className="text-[10px] text-emerald-600 font-semibold uppercase mb-0.5">
                {l(lang, 'Upside', '\u4e0a\u884c')}
              </div>
              {playbook.upside.trigger != null && (
                <div className="text-[10px] text-emerald-500 tabular-nums">
                  {l(lang, 'Trigger', '\u89e6\u53d1')}: {playbook.upside.trigger_label}
                </div>
              )}
              <div className="text-xs text-emerald-700 font-medium tabular-nums">
                {l(lang, 'Target', '\u76ee\u6807')}: {playbook.upside.target_label}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-rose-50/60 border border-rose-100">
              <div className="text-[10px] text-rose-600 font-semibold uppercase mb-0.5">
                {l(lang, 'Downside', '\u4e0b\u884c')}
              </div>
              {playbook.downside.trigger != null && (
                <div className="text-[10px] text-rose-500 tabular-nums">
                  {l(lang, 'Trigger', '\u89e6\u53d1')}: {playbook.downside.trigger_label}
                </div>
              )}
              <div className="text-xs text-rose-700 font-medium tabular-nums">
                {l(lang, 'Target', '\u76ee\u6807')}: {playbook.downside.target_label}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 italic">
            {lang === 'zh' ? playbook.risk_rule_zh : playbook.risk_rule}
          </div>
        </div>
      </div>
    </div>
  )
}
