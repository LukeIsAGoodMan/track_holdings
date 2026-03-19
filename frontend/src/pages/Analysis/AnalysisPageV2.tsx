/**
 * AnalysisPageV2 — Intelligence Layer / Deep Thinking Workspace.
 *
 * Layout:
 *   SearchBar → AnalysisHero → 12-col grid
 *     col-span-8: ChartIntelligence → BattleReport → ScenarioNarrative
 *     col-span-4: LevelsPanel → TechnicalSidebar → MacroContext
 *
 * Reuses all V1 analysis components — this is a presentation-layer rebuild.
 * No data hooks, calculations, or API layer modified.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { fetchAnalysis } from '@/api/holdings'
import type { AnalysisResult } from '@/types'
import { fmtPrice, fmtPctSigned } from '@/utils/format'

import SymbolSearchBar       from '@/components/shared/SymbolSearchBar'
import RhinoBattleReport     from '@/components/analysis/RhinoBattleReport'
import RhinoChart            from '@/components/analysis/RhinoChart'
import NarrativeSection      from '@/components/analysis/NarrativeSection'
import TechnicalDetailsPanel from '@/components/analysis/TechnicalDetailsPanel'

import SectionCard     from '@/design-system/primitives/SectionCard'
import ChartContainer  from '@/design-system/primitives/ChartContainer'
import EmptyState      from '@/design-system/primitives/EmptyState'

// ── Action tag styles (V2 tokens) ───────────────────────────────────────────
const ACTION_STYLES: Record<string, { bg: string; text: string }> = {
  strong_buy:    { bg: 'bg-v2-positive-bg', text: 'text-v2-positive' },
  defensive_buy: { bg: 'bg-v2-accent-soft',  text: 'text-v2-accent' },
  hold_watch:    { bg: 'bg-v2-caution-bg',  text: 'text-v2-caution' },
  reduce:        { bg: 'bg-v2-caution-bg',  text: 'text-v2-caution' },
  stop_loss:     { bg: 'bg-v2-negative-bg', text: 'text-v2-negative' },
}

const ACTION_LABELS: Record<string, { en: string; zh: string }> = {
  strong_buy:    { en: 'STRONG BUY',    zh: '强烈买入' },
  defensive_buy: { en: 'DEFENSIVE BUY', zh: '防御买入' },
  hold_watch:    { en: 'HOLD / WATCH',  zh: '持有观望' },
  reduce:        { en: 'REDUCE',        zh: '减仓' },
  stop_loss:     { en: 'STOP LOSS',     zh: '止损' },
}

const GRADE_STYLES: Record<string, string> = {
  A: 'text-v2-positive bg-v2-positive-bg',
  B: 'text-v2-accent bg-v2-accent-soft',
  C: 'text-v2-caution bg-v2-caution-bg',
  D: 'text-v2-negative bg-v2-negative-bg',
}

// ── Structured panel skeletons ──────────────────────────────────────────────
function AnalysisPageSkeleton() {
  return (
    <div className="space-y-5">
      {/* Hero skeleton */}
      <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm p-6 animate-pulse">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="h-5 w-24 bg-v2-surface-alt rounded-v2-sm" />
            <div className="h-10 w-40 bg-v2-surface-alt rounded-v2-sm" />
            <div className="h-3 w-60 bg-v2-surface-alt rounded-v2-sm" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-7 w-20 bg-v2-surface-alt rounded-md" />
            <div className="h-7 w-16 bg-v2-surface-alt rounded-md" />
          </div>
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 space-y-5">
          {/* Chart skeleton */}
          <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm overflow-hidden animate-pulse">
            <div className="px-5 pt-4 pb-2 h-5 w-40 bg-v2-surface-alt rounded-v2-sm" />
            <div className="h-80 mx-5 mb-4 bg-v2-surface-alt rounded-v2-md" />
          </div>
          {/* Battle report skeleton */}
          <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm p-5 animate-pulse space-y-3">
            <div className="h-4 w-32 bg-v2-surface-alt rounded-v2-sm" />
            <div className="h-3 w-full bg-v2-surface-alt rounded-v2-sm" />
            <div className="h-3 w-3/4 bg-v2-surface-alt rounded-v2-sm" />
            <div className="h-24 bg-v2-surface-alt rounded-v2-md" />
          </div>
        </div>
        <div className="xl:col-span-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-v2-surface rounded-v2-lg shadow-v2-sm p-5 animate-pulse">
              <div className="h-4 w-24 bg-v2-surface-alt rounded-v2-sm mb-3" />
              <div className="space-y-2">
                {[1, 2, 3].map((j) => <div key={j} className="h-3 bg-v2-surface-alt rounded-v2-sm" />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Levels Panel ────────────────────────────────────────────────────────────
function LevelsPanel({ result, isEn }: { result: AnalysisResult; isEn: boolean }) {
  const supports = result.technical.support_zones ?? []
  const resistances = result.technical.resistance_zones ?? []
  const price = result.quote?.price ?? 0

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Key Levels' : '关键价位'} />
      <SectionCard.Body>
        <div className="space-y-4">
          {/* Resistance ladder */}
          {resistances.length > 0 && (
            <div>
              <div className="text-ds-caption uppercase text-v2-negative font-bold mb-2">
                {isEn ? 'Resistance' : '阻力'}
              </div>
              <div className="space-y-1.5">
                {resistances.slice(0, 4).map((z, i) => {
                  const pctAway = price > 0 ? ((z.center - price) / price * 100).toFixed(1) : '—'
                  return (
                    <div key={i} className="flex items-center justify-between text-ds-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-v2-negative shrink-0" />
                        <span className="tnum font-bold text-v2-text-1">${z.center.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {z.zone_type && (
                          <span className="text-ds-caption text-v2-text-3">{z.zone_type}</span>
                        )}
                        <span className="tnum text-v2-negative text-ds-sm">+{pctAway}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Current price marker */}
          <div className="flex items-center gap-2 py-1.5 border-y border-v2-border">
            <span className="w-2 h-2 rounded-full bg-v2-accent shrink-0" />
            <span className="text-ds-body-r font-bold tnum text-v2-text-1">
              ${price.toFixed(2)}
            </span>
            <span className="text-ds-caption text-v2-text-3 ml-auto">
              {isEn ? 'Current' : '当前'}
            </span>
          </div>

          {/* Support ladder */}
          {supports.length > 0 && (
            <div>
              <div className="text-ds-caption uppercase text-v2-positive font-bold mb-2">
                {isEn ? 'Support' : '支撑'}
              </div>
              <div className="space-y-1.5">
                {supports.slice(0, 4).map((z, i) => {
                  const pctAway = price > 0 ? ((z.center - price) / price * 100).toFixed(1) : '—'
                  return (
                    <div key={i} className="flex items-center justify-between text-ds-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-v2-positive shrink-0" />
                        <span className="tnum font-bold text-v2-text-1">${z.center.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {z.zone_type && (
                          <span className="text-ds-caption text-v2-text-3">{z.zone_type}</span>
                        )}
                        <span className="tnum text-v2-positive text-ds-sm">{pctAway}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {supports.length === 0 && resistances.length === 0 && (
            <p className="text-ds-sm text-v2-text-3 text-center py-4">
              {isEn ? 'No levels detected' : '未检测到关键价位'}
            </p>
          )}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
}

// ── Macro Context Sidebar ───────────────────────────────────────────────────
function MacroContextCard({ result, isEn }: { result: AnalysisResult; isEn: boolean }) {
  const macro = result.macro
  const REGIME_STYLES: Record<string, string> = {
    calm:     'text-v2-positive',
    normal:   'text-v2-text-1',
    elevated: 'text-v2-caution',
    crisis:   'text-v2-negative',
  }
  const RATE_STYLES: Record<string, string> = {
    supportive:  'text-v2-positive',
    neutral:     'text-v2-text-1',
    restrictive: 'text-v2-caution',
    hostile:     'text-v2-negative',
  }

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Macro Context' : '宏观环境'} />
      <SectionCard.Body>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-ds-sm">
            <span className="text-v2-text-3">VIX</span>
            <span className={`font-bold tnum ${REGIME_STYLES[macro.vix_regime] ?? 'text-v2-text-1'}`}>
              {macro.vix_level != null ? macro.vix_level.toFixed(1) : '—'}
              <span className="text-ds-caption text-v2-text-3 ml-1">({macro.vix_regime})</span>
            </span>
          </div>
          <div className="flex items-center justify-between text-ds-sm">
            <span className="text-v2-text-3">{isEn ? '10Y Treasury' : '10年期国债'}</span>
            <span className={`font-bold tnum ${RATE_STYLES[macro.rate_pressure_regime] ?? 'text-v2-text-1'}`}>
              {macro.treasury_10y != null ? `${macro.treasury_10y.toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-ds-sm">
            <span className="text-v2-text-3">{isEn ? 'Rate Pressure' : '利率压力'}</span>
            <span className={`font-bold ${RATE_STYLES[macro.rate_pressure_regime] ?? 'text-v2-text-1'}`}>
              {macro.rate_pressure_regime}
            </span>
          </div>
          <div className="flex items-center justify-between text-ds-sm">
            <span className="text-v2-text-3">{isEn ? 'Haircut' : '折扣'}</span>
            <span className="font-bold tnum text-v2-text-1">
              {macro.recommended_haircut_pct}%
            </span>
          </div>

          {macro.alerts.length > 0 && (
            <div className="border-t border-v2-border pt-2 space-y-1.5">
              {macro.alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-2 text-ds-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-v2-caution shrink-0 mt-1" />
                  <span className="text-v2-text-2">{alert}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
}

// ── Scenario Narrative Panel ────────────────────────────────────────────────
function ScenarioNarrativePanel({ result, isEn }: { result: AnalysisResult; isEn: boolean }) {
  const scenario = result.scenario
  const bias = result.playbook.bias_tag
  const upside = result.battle_report.upside_pct
  const downside = result.battle_report.downside_pct

  const biasColor = bias === 'bullish' ? 'text-v2-positive' : bias === 'bearish' ? 'text-v2-negative' : 'text-v2-text-2'

  return (
    <SectionCard>
      <SectionCard.Header title={isEn ? 'Scenario Framing' : '情景分析'} />
      <SectionCard.Body>
        <div className="space-y-4">
          {/* Scenario + Regime */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-ds-body-r font-bold ${biasColor}`}>
              {scenario.bias.replace(/_/g, ' ')}
            </span>
            <span className="text-ds-sm px-2 py-0.5 rounded-md bg-v2-surface-alt text-v2-text-3 font-bold">
              {scenario.scenario.replace(/_/g, ' ')}
            </span>
            <span className="text-ds-sm px-2 py-0.5 rounded-md bg-v2-surface-alt text-v2-text-3 font-bold">
              {scenario.confidence}
            </span>
          </div>

          {/* Setup description */}
          <p className="text-ds-sm text-v2-text-2 leading-relaxed">
            {scenario.setup}
          </p>

          {/* Upside / Downside */}
          {(upside != null || downside != null) && (
            <div className="grid grid-cols-2 gap-3">
              {upside != null && (
                <div className="bg-v2-positive-bg rounded-v2-md p-3 text-center">
                  <div className="text-ds-caption text-v2-positive uppercaser font-bold mb-1">
                    {isEn ? 'Upside' : '上涨空间'}
                  </div>
                  <div className="text-ds-h2 font-bold tnum text-v2-positive">
                    +{upside.toFixed(1)}%
                  </div>
                </div>
              )}
              {downside != null && (
                <div className="bg-v2-negative-bg rounded-v2-md p-3 text-center">
                  <div className="text-ds-caption text-v2-negative uppercaser font-bold mb-1">
                    {isEn ? 'Downside' : '下跌风险'}
                  </div>
                  <div className="text-ds-h2 font-bold tnum text-v2-negative">
                    {downside.toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Constraints */}
          {scenario.constraints.length > 0 && (
            <div className="border-t border-v2-border pt-3">
              <div className="text-ds-caption text-v2-text-3 uppercaser font-bold mb-2">
                {isEn ? 'Constraints' : '约束条件'}
              </div>
              <div className="space-y-1">
                {scenario.constraints.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-ds-sm">
                    <span className="text-v2-text-3 shrink-0">-</span>
                    <span className="text-v2-text-2">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard.Body>
    </SectionCard>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AnalysisPageV2() {
  const { lang, t } = useLanguage()
  const isEn = lang !== 'zh'
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lastSymbolRef = useRef<string | null>(null)

  const handleSearch = useCallback(
    async (symbol: string) => {
      lastSymbolRef.current = symbol
      setLoading(true)
      setError(null)
      try {
        const data = await fetchAnalysis(symbol, lang)
        setResult(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(msg)
        setResult(null)
      } finally {
        setLoading(false)
      }
    },
    [lang],
  )

  // Refetch when language changes
  useEffect(() => {
    if (lastSymbolRef.current && result) {
      handleSearch(lastSymbolRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const price = result?.quote?.price ?? 0
  const changePct = result?.quote?.change_pct ?? 0
  const actionTag = result?.playbook.action_tag ?? ''
  const actionStyle = ACTION_STYLES[actionTag] ?? { bg: 'bg-v2-surface-alt', text: 'text-v2-text-3' }
  const actionLabel = ACTION_LABELS[actionTag]
  const gradeStyle = GRADE_STYLES[result?.confidence.grade ?? ''] ?? 'text-v2-text-3 bg-v2-surface-alt'

  return (
    <div className="space-y-5">
      {/* ── Header + Search ──────────────────────────────────── */}
      <div>
        <h2 className="text-ds-h2 font-bold text-v2-text-1">
          {isEn ? 'Analysis' : '深度分析'}
        </h2>
        <p className="text-ds-sm text-v2-text-3 mt-0.5">
          {isEn ? 'Build conviction through structured intelligence' : '通过结构化情报建立信心'}
        </p>
      </div>

      <SymbolSearchBar onSearch={handleSearch} loading={loading} />

      {/* ── Error ────────────────────────────────────────────── */}
      {error && (
        <div className="bg-v2-negative-bg border border-v2-negative/20 rounded-v2-md px-4 py-3 text-v2-negative text-sm">
          {error}
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────── */}
      {loading && <AnalysisPageSkeleton />}

      {/* ── Results ──────────────────────────────────────────── */}
      {result && !loading && (
        <>
          {/* ── Analysis Hero ──────────────────────────────── */}
          <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm p-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-ds-body-r font-bold text-v2-text-2">
                    {result.symbol}
                  </span>
                  {result.quote?.name && (
                    <span className="text-ds-sm text-v2-text-3">{result.quote.name}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-ds-display font-bold tnum leading-none text-v2-text-1">
                    {fmtPrice(price)}
                  </span>
                  <span className={`text-ds-body-r font-bold tnum ${changePct >= 0 ? 'text-v2-positive' : 'text-v2-negative'}`}>
                    {fmtPctSigned(changePct)}
                  </span>
                </div>
                {result.narrative?.summary && (
                  <p className="text-ds-sm text-v2-text-2 mt-2 max-w-xl leading-relaxed">
                    {result.narrative.summary}
                  </p>
                )}
              </div>

              {/* Action + Confidence badges */}
              <div className="flex items-center gap-2 shrink-0">
                {actionLabel && (
                  <span className={`text-ds-sm font-bold px-2.5 py-1 rounded-md ${actionStyle.bg} ${actionStyle.text}`}>
                    {isEn ? actionLabel.en : actionLabel.zh}
                  </span>
                )}
                <span className={`text-ds-sm font-bold px-2 py-1 rounded-md ${gradeStyle}`}>
                  {result.confidence.grade}
                </span>
              </div>
            </div>
          </div>

          {/* ── 12-col grid ────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* ── Main column (8/12) ──────────────────────── */}
            <div className="xl:col-span-8 space-y-5">
              {/* Chart Intelligence — reuses ChartContainer + RhinoChart */}
              <ChartContainer
                title={isEn ? 'Market Structure' : '市场结构'}
                height="h-80"
                action={
                  result.chart.market_state ? (
                    <span className="text-ds-caption px-1.5 py-0.5 rounded-md bg-v2-surface-alt text-v2-text-3 font-bold">
                      {result.chart.market_state}
                    </span>
                  ) : undefined
                }
              >
                <RhinoChart
                  chart={result.chart}
                  price={price}
                  fairValue={result.valuation.raw_fair_value ?? undefined}
                />
              </ChartContainer>

              {/* Battle Report */}
              <SectionCard>
                <SectionCard.Header title={isEn ? 'Battle Report' : '战报分析'} />
                <SectionCard.Body>
                  <RhinoBattleReport report={result.battle_report} />
                </SectionCard.Body>
              </SectionCard>

              {/* Scenario Narrative */}
              <ScenarioNarrativePanel result={result} isEn={isEn} />

              {/* Full Narrative */}
              <SectionCard>
                <SectionCard.Header title={isEn ? 'Narrative Intelligence' : '叙事情报'} />
                <SectionCard.Body>
                  <NarrativeSection narrative={result.narrative} sections={result.text.sections} />
                </SectionCard.Body>
              </SectionCard>
            </div>

            {/* ── Right panel (4/12) ──────────────────────── */}
            <div className="xl:col-span-4 space-y-4">
              {/* Key Levels */}
              <LevelsPanel result={result} isEn={isEn} />

              {/* Macro Context */}
              <MacroContextCard result={result} isEn={isEn} />

              {/* Technical Details */}
              <SectionCard>
                <SectionCard.Header title={isEn ? 'Technical Details' : '技术细节'} />
                <SectionCard.Body>
                  <TechnicalDetailsPanel technical={result.technical} price={price} />
                </SectionCard.Body>
              </SectionCard>

              {/* Confidence breakdown */}
              <SectionCard>
                <SectionCard.Header title={isEn ? 'Confidence' : '置信度'} />
                <SectionCard.Body>
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-ds-h2 font-bold tnum ${gradeStyle} px-2.5 py-1 rounded-md`}>
                      {result.confidence.grade}
                    </span>
                    <span className="text-ds-body-r font-bold tnum text-v2-text-1">
                      {result.confidence.score}/100
                    </span>
                  </div>
                  <div className="space-y-1">
                    {result.confidence.reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-ds-sm">
                        <span className="text-v2-text-3 shrink-0">-</span>
                        <span className="text-v2-text-2">{r}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard.Body>
              </SectionCard>
            </div>
          </div>

          {/* ── Data quality footer ────────────────────────── */}
          <p className="text-ds-caption text-v2-text-3 text-right tnum">
            {isEn ? 'as of' : '截至'} {new Date(result.as_of).toLocaleString()}
            {' · '}
            {isEn ? 'history' : '历史'}: {result.data_quality.history_days}d
          </p>
        </>
      )}

      {/* ── Empty state ──────────────────────────────────── */}
      {!result && !loading && !error && (
        <SectionCard minHeight="300px">
          <EmptyState
            message={isEn ? 'Search a symbol to begin' : '搜索标的开始分析'}
            hint={isEn ? 'Enter a ticker to get structured intelligence — valuation, structure, macro, playbook' : '输入代码获取结构化情报 — 估值、结构、宏观、操作手册'}
            icon={
              <svg className="w-12 h-12 text-v2-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
        </SectionCard>
      )}
    </div>
  )
}
