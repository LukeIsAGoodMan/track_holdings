/**
 * TradeEntryForm — compact trade entry form for the sidebar.
 *
 * Shares all business logic with TradeEntryPage.
 * Optimized for ~240–288px sidebar width:
 *   - Tighter spacing and font sizes
 *   - Clipboard import collapsible (closed by default)
 *   - Trade reason / tags collapsible (closed by default)
 *   - onSuccess callback replaces page navigation
 */
import { useState } from 'react'
import { createTrade }  from '@/api/holdings'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import type {
  TradeAction, InstrumentType, OptionType, ClosePositionState,
} from '@/types'
import { fmtUSDSigned, fmtNum } from '@/utils/format'
import { parseClipboard } from '@/utils/clipboardParser'
import type { ParsedTrade } from '@/utils/clipboardParser'

// ── Types ─────────────────────────────────────────────────────────────────────
type FormState = {
  symbol:         string
  instrumentType: InstrumentType
  optionType:     OptionType
  strike:         string
  expiry:         string
  action:         TradeAction
  quantity:       string
  price:          string
  notes:          string
  tradeReason:    string
  strategyTags:   string[]
}

const STRATEGY_TAGS = [
  'Hedge', 'Speculative', 'Earnings', 'Income',
  'Momentum', 'Wheel', 'Volatility', 'Mean Reversion',
] as const

const ACTION_LABELS: Record<TradeAction, string> = {
  SELL_OPEN:  'Sell Open',
  BUY_OPEN:   'Buy Open',
  BUY_CLOSE:  'Buy Close',
  SELL_CLOSE: 'Sell Close',
}

const INITIAL: FormState = {
  symbol: '', instrumentType: 'OPTION', optionType: 'PUT',
  strike: '', expiry: '', action: 'SELL_OPEN',
  quantity: '1', price: '', notes: '',
  tradeReason: '', strategyTags: [],
}

function fromClose(cs: ClosePositionState): FormState {
  return {
    ...INITIAL,
    symbol:         cs.symbol,
    instrumentType: cs.instrumentType,
    optionType:     cs.optionType ?? 'PUT',
    strike:         cs.strike  ?? '',
    expiry:         cs.expiry  ?? '',
    action:         cs.action,
    quantity:       cs.quantity,
    tradeReason:    `Closing ${cs.symbol}`,
  }
}

// ── Shared input class ────────────────────────────────────────────────────────
const INP = [
  'w-full text-xs rounded-lg border border-slate-200 bg-white',
  'px-2.5 py-1.5 text-slate-700 placeholder-slate-300',
  'focus:outline-none focus:ring-1 focus:ring-primary/30',
].join(' ')

// ── Compact toggle group ──────────────────────────────────────────────────────
function CToggle<T extends string>({
  options, value, onChange, labelMap,
}: {
  options: T[]; value: T; onChange: (v: T) => void; labelMap?: Record<string, string>
}) {
  return (
    <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-slate-50 text-[11px]">
      {options.map((opt) => (
        <button
          key={opt} type="button" onClick={() => onChange(opt)}
          className={[
            'flex-1 py-1.5 font-semibold transition-colors',
            value === opt
              ? 'bg-primary-soft text-primary'
              : 'text-slate-500 hover:text-slate-700 hover:bg-white',
          ].join(' ')}
        >
          {labelMap?.[opt] ?? opt}
        </button>
      ))}
    </div>
  )
}

// ── Compact tag picker ────────────────────────────────────────────────────────
function TagPicker({
  selected, onChange,
}: {
  selected: string[]; onChange: (t: string[]) => void
}) {
  const toggle = (tag: string) =>
    onChange(selected.includes(tag)
      ? selected.filter(t => t !== tag)
      : [...selected, tag])
  return (
    <div className="flex flex-wrap gap-1">
      {STRATEGY_TAGS.map((tag) => (
        <button
          key={tag} type="button" onClick={() => toggle(tag)}
          className={[
            'px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors',
            selected.includes(tag)
              ? 'bg-primary-soft border-primary/30 text-primary'
              : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600',
          ].join(' ')}
        >{tag}</button>
      ))}
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────
function CollapseSection({
  label, color = 'text-slate-400', open, onToggle, children,
}: {
  label: string; color?: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border-t border-slate-100 pt-2">
      <button
        type="button" onClick={onToggle}
        className={`w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wider py-1 hover:opacity-80 transition-opacity ${color}`}
      >
        <span>{label}</span>
        <span className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="mt-1.5 space-y-2">{children}</div>}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TradeEntryForm({
  closeState,
  onSuccess,
}: {
  closeState?: ClosePositionState | null
  onSuccess?: () => void
}) {
  const { selectedPortfolioId, triggerRefresh } = usePortfolio()
  const { t } = useLanguage()

  const [form,      setForm]     = useState<FormState>(() =>
    closeState ? fromClose(closeState) : INITIAL)
  const [loading,   setLoading]  = useState(false)
  const [error,     setError]    = useState<string | null>(null)
  const [impact,    setImpact]   = useState<string | null>(null)
  const [clipOpen,  setClipOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(!!closeState)
  const [clipText,  setClipText] = useState('')
  const [parsed,    setParsed]   = useState<ParsedTrade | null>(null)

  const isOption = form.instrumentType === 'OPTION'
  const isSell   = form.action === 'SELL_OPEN' || form.action === 'SELL_CLOSE'
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }))

  function handleClip(text: string) {
    setClipText(text)
    if (!text.trim()) { setParsed(null); return }
    const r = parseClipboard(text)
    setParsed(r.matched.length > 0 ? r : { ...r, matched: [] })
  }

  function applyClip() {
    if (!parsed) return
    setForm(prev => ({
      ...prev,
      ...(parsed.symbol         && { symbol:         parsed.symbol }),
      ...(parsed.instrumentType && { instrumentType: parsed.instrumentType }),
      ...(parsed.optionType     && { optionType:     parsed.optionType }),
      ...(parsed.strike         && { strike:         parsed.strike }),
      ...(parsed.expiry         && { expiry:         parsed.expiry }),
      ...(parsed.action         && { action:         parsed.action }),
      ...(parsed.quantity       && { quantity:       parsed.quantity }),
      ...(parsed.price          && { price:          parsed.price }),
    }))
    setClipText(''); setParsed(null); setClipOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPortfolioId) { setError('Select a portfolio first.'); return }
    setLoading(true); setError(null); setImpact(null)
    try {
      const res = await createTrade({
        portfolio_id:     selectedPortfolioId,
        symbol:           form.symbol.trim().toUpperCase(),
        instrument_type:  form.instrumentType,
        option_type:      isOption ? form.optionType : null,
        strike:           isOption && form.strike ? form.strike : null,
        expiry:           isOption && form.expiry  ? form.expiry  : null,
        action:           form.action,
        quantity:         parseInt(form.quantity, 10),
        price:            form.price,
        notes:            form.notes || null,
        confidence_score: 3,
        trade_reason:     form.tradeReason || null,
        strategy_tags:    form.strategyTags.length > 0 ? form.strategyTags : null,
      })
      setImpact(res.cash_impact)
      triggerRefresh()
      setForm(prev => ({ ...prev, price: '', quantity: '1', notes: '', tradeReason: '', strategyTags: [] }))
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const cashPreview = form.symbol && form.price && form.quantity
    ? parseFloat(form.price || '0') * parseInt(form.quantity || '0', 10) * (isOption ? 100 : 1)
    : null

  return (
    <div className="flex flex-col gap-2.5 font-sans">

      {/* Closing mode banner */}
      {closeState && (
        <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px]">
          <div className="font-bold uppercase tracking-wider text-amber-700 mb-0.5">
            Closing Position
          </div>
          <div className="text-amber-600">
            {closeState.quantity} × <span className="font-bold text-amber-800">{closeState.symbol}</span>
            {closeState.instrumentType === 'OPTION' && (
              <span> {closeState.optionType} ${fmtNum(closeState.strike ?? '0')} ({closeState.expiry})</span>
            )}
          </div>
        </div>
      )}

      {/* Success */}
      {impact && (
        <div className={[
          'flex items-center justify-between px-3 py-2 rounded-xl border text-[11px] font-semibold',
          parseFloat(impact) >= 0
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-rose-50 border-rose-200 text-rose-700',
        ].join(' ')}>
          <span>Recorded · {fmtUSDSigned(impact)}</span>
          <button type="button" onClick={() => setImpact(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-[11px]">
          {error}
        </div>
      )}

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-2.5">

        {/* Action */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {t('action')}
          </label>
          <select
            value={form.action}
            onChange={e => set('action', e.target.value as TradeAction)}
            className={INP}
          >
            {(Object.keys(ACTION_LABELS) as TradeAction[]).map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>

        {/* Instrument type */}
        <CToggle
          options={['OPTION', 'STOCK'] as InstrumentType[]}
          value={form.instrumentType}
          onChange={v => set('instrumentType', v)}
          labelMap={{ OPTION: 'Option', STOCK: 'Stock' }}
        />

        {/* Symbol */}
        <input
          type="text" placeholder="Symbol (e.g. NVDA)" value={form.symbol}
          onChange={e => set('symbol', e.target.value.toUpperCase())} required
          className={`${INP} font-mono font-bold uppercase`}
        />

        {/* Option-specific fields */}
        {isOption && (
          <>
            <CToggle
              options={['PUT', 'CALL'] as OptionType[]}
              value={form.optionType}
              onChange={v => set('optionType', v)}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Strike
                </label>
                <input
                  type="number" step="0.01" min="0" placeholder="600"
                  value={form.strike} onChange={e => set('strike', e.target.value)}
                  required={isOption} className={INP}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Expiry
                </label>
                <input
                  type="date" value={form.expiry}
                  onChange={e => set('expiry', e.target.value)}
                  required={isOption} className={INP}
                />
              </div>
            </div>
          </>
        )}

        {/* Qty + Price */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              {isOption ? 'Contracts' : 'Shares'}
            </label>
            <input
              type="number" min="1" step="1" value={form.quantity}
              onChange={e => set('quantity', e.target.value)} required
              className={INP}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              {isOption ? 'Premium' : 'Price'}
            </label>
            <input
              type="number" step="0.01" min="0"
              placeholder={isOption ? '5.00' : '195.00'}
              value={form.price} onChange={e => set('price', e.target.value)}
              required className={INP}
            />
          </div>
        </div>

        {/* Notes */}
        <input
          type="text" placeholder={`${t('notes')} (optional)`} value={form.notes}
          onChange={e => set('notes', e.target.value)} className={INP}
        />

        {/* Cash preview */}
        {cashPreview !== null && (
          <div className={[
            'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold tabular-nums border',
            isSell
              ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
              : 'bg-rose-50 border-rose-100 text-rose-600',
          ].join(' ')}>
            {isSell ? '+' : '−'}${cashPreview.toLocaleString('en-US', { minimumFractionDigits: 2 })} cash impact
          </div>
        )}

        {/* Submit */}
        <button
          type="submit" disabled={loading}
          className="w-full py-2 rounded-xl bg-primary text-white text-xs font-bold
                     hover:bg-primary/90 transition-colors shadow-sm
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('recording') : t('record_trade')}
        </button>
      </form>

      {/* ── Clipboard import (collapsible) ─────────────────────────────── */}
      <CollapseSection
        label="Clipboard Import"
        open={clipOpen}
        onToggle={() => setClipOpen(v => !v)}
      >
        <textarea
          rows={3} value={clipText}
          onChange={e => handleClip(e.target.value)}
          onPaste={e => handleClip(e.clipboardData.getData('text'))}
          placeholder={t('clipboard_ph')}
          className="w-full font-mono text-[10px] rounded-lg border border-slate-200 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        {clipText.trim() && parsed && parsed.matched.length > 0 && (
          <div className="flex gap-1.5">
            <button
              type="button" onClick={applyClip}
              className="flex-1 py-1 rounded-lg bg-primary-soft text-primary border border-primary/20 text-[10px] font-semibold hover:bg-primary/15 transition-colors"
            >
              Apply {parsed.matched.length} fields
            </button>
            <button
              type="button" onClick={() => { setClipText(''); setParsed(null) }}
              className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-500 text-[10px] font-semibold hover:bg-slate-50 transition-colors"
            >
              Clear
            </button>
          </div>
        )}
        {clipText.trim() && parsed && parsed.matched.length === 0 && (
          <p className="text-[10px] text-rose-500">{t('clipboard_no_match')}</p>
        )}
      </CollapseSection>

      {/* ── Trade reason + tags (collapsible) ──────────────────────────── */}
      <CollapseSection
        label="Trade Reason"
        color="text-amber-500"
        open={reasonOpen}
        onToggle={() => setReasonOpen(v => !v)}
      >
        <textarea
          rows={2} placeholder={t('coach_reason_ph')} value={form.tradeReason}
          onChange={e => set('tradeReason', e.target.value)}
          className="w-full text-[10px] rounded-lg border border-slate-200 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <TagPicker
          selected={form.strategyTags}
          onChange={tags => set('strategyTags', tags)}
        />
      </CollapseSection>
    </div>
  )
}
