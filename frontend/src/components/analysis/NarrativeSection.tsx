/**
 * Narrative section — renders the text report sections as readable paragraphs.
 */
import type { AnalysisTextSections } from '@/types'
import { useLanguage } from '@/context/LanguageContext'

interface Props {
  sections: AnalysisTextSections
}

const sectionOrder: (keyof AnalysisTextSections)[] = [
  'overview', 'technical', 'valuation', 'macro', 'playbook', 'confidence',
]

const sectionMarkers: Record<string, string> = {
  overview:   '01',
  technical:  '02',
  valuation:  '03',
  macro:      '04',
  playbook:   '05',
  confidence: '06',
}

export default function NarrativeSection({ sections }: Props) {
  const { t } = useLanguage()

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
        {t('analysis_narrative')}
      </h3>

      <div className="space-y-4">
        {sectionOrder.map((key) => {
          const text = sections[key]
          if (!text) return null
          return (
            <div key={key}>
              <div className="text-[11px] text-slate-400 font-semibold uppercase mb-1 flex items-center gap-1.5">
                <span className="text-[10px] text-slate-300 font-mono">{sectionMarkers[key]}</span>
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
