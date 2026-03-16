/**
 * Narrative section — renders Rhino narrative as structured collapsible cards.
 *
 * Shows the narrative summary prominently, then individual sections.
 * Falls back to legacy text report if narrative is absent.
 */
import { useState } from 'react'
import type { AnalysisNarrative, AnalysisTextSections } from '@/types'
import { useLanguage } from '@/context/LanguageContext'

interface Props {
  narrative?: AnalysisNarrative
  /** Legacy text report — shown as fallback if narrative is empty */
  sections?: AnalysisTextSections
}

const narrativeOrder = ['valuation', 'structure', 'macro', 'patterns', 'playbook'] as const

const sectionIcons: Record<string, string> = {
  valuation: '01',
  structure: '02',
  macro:     '03',
  patterns:  '04',
  playbook:  '05',
}

const sectionLabels: Record<string, { en: string; zh: string }> = {
  valuation: { en: 'Valuation',  zh: '估值分析' },
  structure: { en: 'Structure',  zh: '趋势与结构' },
  macro:     { en: 'Macro',      zh: '宏观环境' },
  patterns:  { en: 'Patterns',   zh: '价格形态' },
  playbook:  { en: 'Playbook',   zh: '操作策略' },
}

/* ── Legacy fallback for old text report format ─────────────────────────── */

const legacySectionOrder: (keyof AnalysisTextSections)[] = [
  'overview', 'technical', 'valuation', 'macro', 'playbook', 'confidence',
]

const legacyMarkers: Record<string, string> = {
  overview:   '01',
  technical:  '02',
  valuation:  '03',
  macro:      '04',
  playbook:   '05',
  confidence: '06',
}

function LegacyNarrative({ sections }: { sections: AnalysisTextSections }) {
  const { t } = useLanguage()
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
        {t('analysis_narrative')}
      </h3>
      <div className="space-y-4">
        {legacySectionOrder.map((key) => {
          const text = sections[key]
          if (!text) return null
          return (
            <div key={key}>
              <div className="text-[11px] text-slate-400 font-semibold uppercase mb-1 flex items-center gap-1.5">
                <span className="text-[10px] text-slate-300 font-mono">{legacyMarkers[key]}</span>
                {t(`analysis_section_${key}` as never) || key}
              </div>
              <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                {text}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Main component ─────────────────────────────────────────────────────── */

export default function NarrativeSection({ narrative, sections }: Props) {
  const { lang, t } = useLanguage()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Determine if narrative has content (summary OR sections)
  const hasNarrative = narrative &&
    (narrative.summary ||
     Object.values(narrative.sections).some((s) => s && s.length > 0))

  // Fall back to legacy if narrative is empty/absent
  if (!hasNarrative) {
    if (sections) return <LegacyNarrative sections={sections} />
    return null
  }

  const toggle = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">
        {t('analysis_narrative')}
      </h3>

      {/* Summary */}
      {narrative.summary && (
        <div className="bg-slate-50 rounded-xl px-4 py-3 mb-4 text-sm text-slate-700 leading-relaxed border border-slate-100">
          {narrative.summary}
        </div>
      )}

      {/* Sections */}
      <div className="space-y-2">
        {narrativeOrder.map((key) => {
          const text = narrative.sections[key]
          if (!text) return null
          const isCollapsed = collapsed[key] ?? false
          const label = sectionLabels[key]?.[lang] ?? key
          return (
            <div key={key} className="border border-slate-100 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-300 font-mono">{sectionIcons[key]}</span>
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
                </span>
                <svg
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {!isCollapsed && (
                <div className="px-4 pb-3 text-sm text-slate-600 leading-relaxed">
                  {text}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
