/**
 * ScenarioStressPanel — V2 stress test with Taylor expansion.
 *
 * Reuses the same computeScenarioPnL logic from V1 — passed in as a prop.
 * Two sliders (price ±20%, IV ±50pp), IV skew toggle, per-symbol breakdown.
 */
import { useState, useMemo, memo } from 'react'
import type { HoldingGroup } from '@/types'
import SectionCard from '../primitives/SectionCard'

interface ScenarioResult {
  total: number
  bySymbol: { symbol: string; pnl: number }[]
  effectiveIvShift: number
}

type ComputeFn = (
  holdings: HoldingGroup[],
  priceShiftPct: number,
  ivShiftPpt: number,
  ivSkewEnabled?: boolean,
) => ScenarioResult

interface Props {
  holdings: HoldingGroup[]
  computeScenarioPnL: ComputeFn
  isEn: boolean
}

export default memo(function ScenarioStressPanel({ holdings, computeScenarioPnL, isEn }: Props) {
  const [priceShiftPct, setPriceShiftPct] = useState(0)
  const [ivShiftPpt, setIvShiftPpt] = useState(0)
  const [ivSkewEnabled, setIvSkewEnabled] = useState(false)

  const result = useMemo(
    () => computeScenarioPnL(holdings, priceShiftPct / 100, ivShiftPpt, ivSkewEnabled),
    [holdings, priceShiftPct, ivShiftPpt, ivSkewEnabled, computeScenarioPnL],
  )

  const pnlColor = result.total >= 0 ? 'text-v2-positive' : 'text-v2-negative'

  return (
    <SectionCard noPadding>
      <div className="px-5 py-3 border-b border-v2-border-sub flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-v2-text-1 tracking-tight">
          {isEn ? 'Scenario Simulation' : '情景模拟'}
        </h3>
        <span className="text-[10px] text-v2-text-3 font-mono">
          PnL = delta*dP + 0.5*gamma*dP^2 + vega*dIV
        </span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sliders */}
        <div className="space-y-5">
          {/* Price Shift */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] text-v2-text-2 font-medium">
                {isEn ? 'Price Shift' : '价格变动'}
              </label>
              <span className={`text-[13px] font-bold tnum ${
                priceShiftPct > 0 ? 'text-v2-positive' : priceShiftPct < 0 ? 'text-v2-negative' : 'text-v2-text-3'
              }`}>
                {priceShiftPct > 0 ? '+' : ''}{priceShiftPct}%
              </span>
            </div>
            <input
              type="range" min={-20} max={20} step={1}
              value={priceShiftPct}
              onChange={(e) => setPriceShiftPct(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                         bg-v2-border-sub accent-v2-accent"
            />
            <div className="flex justify-between text-[10px] text-v2-text-3 mt-1">
              <span>-20%</span><span>0</span><span>+20%</span>
            </div>
          </div>

          {/* IV Shift */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] text-v2-text-2 font-medium">
                {isEn ? 'IV Shift' : 'IV变动'}
              </label>
              <span className={`text-[13px] font-bold tnum ${
                ivShiftPpt > 0 ? 'text-v2-negative' : ivShiftPpt < 0 ? 'text-v2-positive' : 'text-v2-text-3'
              }`}>
                {ivShiftPpt > 0 ? '+' : ''}{ivShiftPpt}pp
              </span>
            </div>
            <input
              type="range" min={-50} max={50} step={5}
              value={ivShiftPpt}
              onChange={(e) => setIvShiftPpt(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                         bg-v2-border-sub accent-v2-accent"
            />
            <div className="flex justify-between text-[10px] text-v2-text-3 mt-1">
              <span>-50pp</span><span>0</span><span>+50pp</span>
            </div>
          </div>

          {/* IV Skew toggle */}
          <div className="flex items-start gap-3 pt-3 border-t border-v2-border-sub">
            <button
              type="button"
              onClick={() => setIvSkewEnabled((p) => !p)}
              className={`mt-0.5 w-9 h-5 rounded-full relative transition-colors shrink-0
                ${ivSkewEnabled ? 'bg-v2-accent' : 'bg-v2-border-sub'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                ${ivSkewEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <div>
              <div className="text-[12px] text-v2-text-1 font-medium">
                {isEn ? 'IV Skew (Panic Vol)' : 'IV偏斜 (恐慌波动)'}
              </div>
              {ivSkewEnabled && priceShiftPct < 0 && (
                <div className="text-[10px] text-v2-accent mt-0.5">
                  +{(Math.abs(priceShiftPct) * 0.5).toFixed(1)}pp panic vol
                  → effective: {result.effectiveIvShift.toFixed(1)}pp
                </div>
              )}
              {!ivSkewEnabled && (
                <div className="text-[10px] text-v2-text-3">
                  {isEn ? 'Simulate sell-off vol spike' : '模拟抛售波动率飙升'}
                </div>
              )}
            </div>
          </div>

          {/* Reset */}
          {(priceShiftPct !== 0 || ivShiftPpt !== 0) && (
            <button
              onClick={() => { setPriceShiftPct(0); setIvShiftPpt(0) }}
              className="text-[12px] text-v2-text-3 hover:text-v2-text-1 transition-colors"
            >
              Reset to baseline
            </button>
          )}
        </div>

        {/* Result */}
        <div className="flex flex-col justify-between">
          <div className="bg-v2-surface-alt rounded-v2-lg border border-v2-border-sub p-5 text-center mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-v2-text-3 mb-2">
              {isEn ? 'Estimated P&L' : '预估损益'}
            </div>
            <div className={`text-[2rem] font-bold tnum ${pnlColor}`}>
              {result.total >= 0 ? '+' : ''}${Math.abs(result.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {result.bySymbol.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-v2-text-3 font-semibold mb-2">
                {isEn ? 'By Symbol' : '按标的'}
              </div>
              <div className="space-y-1.5">
                {result.bySymbol.slice(0, 8).map(({ symbol, pnl }) => {
                  const isPos = pnl >= 0
                  return (
                    <div key={symbol} className="flex items-center justify-between text-[12px]">
                      <span className="text-v2-text-2 font-medium w-16">{symbol}</span>
                      <div className="flex-1 mx-3 h-1 rounded-full bg-v2-border-sub overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isPos ? 'bg-v2-positive/50' : 'bg-v2-negative/50'}`}
                          style={{ width: `${Math.min(Math.abs(pnl) / Math.abs(result.total || 1) * 100, 100)}%` }}
                        />
                      </div>
                      <span className={`tnum font-semibold w-20 text-right ${isPos ? 'text-v2-positive' : 'text-v2-negative'}`}>
                        {isPos ? '+' : ''}${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
})
