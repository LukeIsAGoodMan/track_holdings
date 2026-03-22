/**
 * TradeEntryForm — Phase 15.8 refactor.
 *
 * Three labelled sections: Asset Context · Execution Details · Analysis & Review.
 * Star-rating conviction selector with hover preview.
 * Technical Levels moved to Analysis section.
 * gap-y-6 breathing between sections; mb-1.5 label → input spacing throughout.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Star } from 'lucide-react'
import { createTrade, searchSymbols, validateSymbol } from '@/api/holdings'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import type {
  TradeAction, InstrumentType, OptionType, ClosePositionState, SymbolSuggestion,
} from '@/types'
import { fmtUSDSigned, fmtNum } from '@/utils/format'
import { parseClipboard } from '@/utils/clipboardParser'
import type { ParsedTrade } from '@/utils/clipboardParser'

// ── Types ─────────────────────────────────────────────────────────────────────
type FormState = {
  symbol:          string
  instrumentType:  InstrumentType
  optionType:      OptionType
  strike:          string
  expiry:          string
  action:          TradeAction
  quantity:        string
  price:           string
  support:         string
  resistance:      string
  notes:           string
  tradeReason:     string
  strategyTags:    string[]
  confidenceScore: number
}

type SubmitState = 'idle' | 'loading' | 'success'

const STRATEGY_TAGS = [
  'Hedge', 'Speculative', 'Earnings', 'Income',
  'Momentum', 'Wheel', 'Volatility', 'Mean Reversion',
] as const

// Smart action: only BUY and SELL exposed to user
// Backend resolves to OPEN/CLOSE based on current position
const SMART_ACTIONS: TradeAction[] = ['BUY', 'SELL']

const STAR_LABELS: Record<number, string> = {
  1: 'Minimal',
  2: 'Low',
  3: 'Neutral',
  4: 'Strong Setup',
  5: 'High Conviction',
}

const INITIAL: FormState = {
  symbol: '', instrumentType: 'OPTION', optionType: 'PUT',
  strike: '', expiry: '', action: 'SELL',
  quantity: '1', price: '',
  support: '', resistance: '',
  notes: '', tradeReason: '', strategyTags: [],
  confidenceScore: 3,
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

// ── V3.5 Warm aluminum input styling ─────────────────────────────────────────
const INP = [
  'w-full text-xs rounded-v2-md bg-white/60',
  'px-3 py-2 text-stone-800',
  'placeholder:text-stone-500/65',
  'focus:outline-none focus:ring-1 focus:ring-stone-400/30 focus:bg-white/95 focus:border-stone-400/30',
  'ds-bg',
].join(' ')
const INP_BORDER = 'border border-stone-400/[0.06]'

// Label — readable from a distance
const LBL = 'block text-[10px] font-medium uppercase tracking-wider mb-1.5'
const LBL_COLOR = { color: 'rgba(68, 64, 60, 0.72)' } as const

// ── Section wrapper — warm aluminum surface, no heavy box ────────────────────
function Section({
  title, children,
}: {
  title: string; accent?: string; children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-widest mb-3"
           style={{ color: 'rgba(68, 64, 60, 0.56)' }}>
        {title}
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

// ── Compact toggle — neutral color-only, no blue boxes ───────────────────────
function CToggle<T extends string>({
  options, value, onChange, labelMap,
}: {
  options: T[]; value: T; onChange: (v: T) => void; labelMap?: Record<string, string>
}) {
  return (
    <div className={`flex rounded-v2-md overflow-hidden bg-stone-100/50 text-[11px] ${INP_BORDER}`}>
      {options.map((opt) => (
        <button
          key={opt} type="button" onClick={() => onChange(opt)}
          className={[
            'flex-1 py-1.5 font-medium ds-color',
            value === opt
              ? 'bg-white text-stone-700 shadow-sm'
              : 'text-stone-400 hover:text-stone-600',
          ].join(' ')}
        >
          {labelMap?.[opt] ?? opt}
        </button>
      ))}
    </div>
  )
}

// ── Star Rating (replaces numeric conviction buttons) ─────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const display = hovered ?? value

  return (
    <div>
      <label className={LBL}>Conviction</label>
      {/* Single row — whitespace-nowrap on label prevents wrap at any sidebar width */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center gap-1.5 shrink-0"
          onMouseLeave={() => setHovered(null)}
        >
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              onMouseEnter={() => setHovered(n)}
              className="p-0 leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded-sm"
            >
              <Star
                size={18}
                strokeWidth={1.5}
                className={`ds-color duration-100 ${
                  n <= display
                    ? 'text-amber-400 fill-amber-400'
                    : 'text-stone-200 fill-stone-200 hover:text-stone-300 hover:fill-stone-300'
                }`}
              />
            </button>
          ))}
        </div>
        {display > 0 && (
          <span className="text-[11px] text-stone-500 whitespace-nowrap shrink-0">
            {STAR_LABELS[display]}
          </span>
        )}
      </div>
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
    <div className="flex flex-wrap gap-1.5">
      {STRATEGY_TAGS.map((tag) => (
        <button
          key={tag} type="button" onClick={() => toggle(tag)}
          className={[
            'px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ds-color',
            selected.includes(tag)
              ? 'bg-primary-soft border-primary/30 text-primary'
              : 'bg-white border-stone-400/[0.06] text-stone-400 hover:border-stone-300 hover:text-stone-600',
          ].join(' ')}
        >{tag}</button>
      ))}
    </div>
  )
}

// ── Collapsible section (Clipboard Import) ────────────────────────────────────
// Padding on the wrapper ensures the toggle label is never flush against an edge.
function CollapseSection({
  label, color = 'text-stone-400', open, onToggle, children,
}: {
  label: string; color?: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border-t border-stone-400/[0.04] pt-2 px-1">
      <button
        type="button" onClick={onToggle}
        className={`w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wider px-1 py-1.5 hover:opacity-80 transition-opacity ${color}`}
      >
        <span>{label}</span>
        <span className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="mt-2 space-y-2 px-1">{children}</div>}
    </div>
  )
}

// ── Asset class badge colours ─────────────────────────────────────────────────
const ASSET_CLASS_STYLE: Record<string, string> = {
  stock:  'bg-blue-50    text-blue-600    border-blue-200',
  etf:    'bg-emerald-50 text-emerald-600 border-emerald-200',
  index:  'bg-amber-50   text-amber-600   border-amber-200',
  crypto: 'bg-violet-50  text-violet-600  border-violet-200',
  option: 'bg-rose-50    text-rose-600    border-rose-200',
}
const ASSET_CLASS_LABEL: Record<string, string> = {
  stock: 'Stock', etf: 'ETF', index: 'Index', crypto: 'Crypto', option: 'Option',
}

// ── Symbol autocomplete ───────────────────────────────────────────────────────
function SymbolAutocomplete({
  value, onChange, onValidChange, onSelectSuggestion, disabled,
}: {
  value:               string
  onChange:            (v: string) => void
  onValidChange:       (valid: boolean | null) => void
  onSelectSuggestion:  (s: SymbolSuggestion | null) => void
  disabled?:           boolean
}) {
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([])
  const [open,        setOpen]        = useState(false)
  const debounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef                  = useRef<HTMLDivElement>(null)

  const handleInput = useCallback((raw: string) => {
    const upper = raw.toUpperCase()
    onChange(upper)
    onValidChange(null)
    onSelectSuggestion(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (upper.length < 2) { setSuggestions([]); setOpen(false); return }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchSymbols(upper)
        setSuggestions(res)
        setOpen(res.length > 0)
      } catch {
        setSuggestions([]); setOpen(false)
      }
    }, 220)
  }, [onChange, onValidChange, onSelectSuggestion])

  const handleBlur = useCallback(async () => {
    await new Promise(r => setTimeout(r, 120))
    setOpen(false)
    if (!value || value.length < 1) { onValidChange(null); return }
    try {
      const res = await validateSymbol(value)
      onValidChange(res.valid)
      if (res.valid) {
        onSelectSuggestion({ symbol: res.symbol, type: res.type, name: res.name })
      }
    } catch {
      onValidChange(null)
    }
  }, [value, onValidChange, onSelectSuggestion])

  const select = (sym: SymbolSuggestion) => {
    onChange(sym.symbol)
    onValidChange(true)
    onSelectSuggestion(sym)
    setSuggestions([])
    setOpen(false)
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        placeholder="Ticker symbol (e.g. NVDA)"
        value={value}
        onChange={e => handleInput(e.target.value)}
        onBlur={handleBlur}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        required
        disabled={disabled}
        className={`${INP} font-mono font-bold uppercase`}
        autoComplete="off"
        spellCheck={false}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-stone-400/[0.06] rounded-v2-md shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.symbol}
              type="button"
              onMouseDown={e => { e.preventDefault(); select(s) }}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-stone-100/50 ds-color first:rounded-t-xl last:rounded-b-xl"
            >
              <div className="min-w-0 mr-2">
                <div className="font-mono font-bold text-[12px] text-stone-800">{s.symbol}</div>
                {s.name && (
                  <div className="text-[10px] text-stone-400 truncate max-w-[200px]">{s.name}</div>
                )}
              </div>
              <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ASSET_CLASS_STYLE[s.type] ?? 'bg-stone-100/50 text-stone-500 border-stone-400/[0.06]'}`}>
                {ASSET_CLASS_LABEL[s.type] ?? s.type}
              </span>
            </button>
          ))}
        </div>
      )}
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

  const [form,        setForm]       = useState<FormState>(() =>
    closeState ? fromClose(closeState) : INITIAL)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [error,       setError]      = useState<string | null>(null)
  const [impact,      setImpact]     = useState<string | null>(null)
  const [clipOpen,    setClipOpen]   = useState(false)
  const [clipText,    setClipText]   = useState('')
  const [parsed,      setParsed]     = useState<ParsedTrade | null>(null)
  const [symbolValid,        setSymbolValid]        = useState<boolean | null>(closeState ? true : null)
  const [selectedSuggestion, setSelectedSuggestion] = useState<SymbolSuggestion | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isOption = form.instrumentType === 'OPTION'
  const isSell   = form.action === 'SELL' || form.action === 'SELL_OPEN' || form.action === 'SELL_CLOSE'
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
    if (parsed.symbol) setSymbolValid(null)
    setClipText(''); setParsed(null); setClipOpen(false)
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedPortfolioId) { setError('Select a portfolio first.'); return }
    setSubmitState('loading'); setError(null); setImpact(null)
    try {
      let notes = form.notes || null
      if (form.support || form.resistance) {
        const levels = [
          form.support    && `S: $${form.support}`,
          form.resistance && `R: $${form.resistance}`,
        ].filter(Boolean).join(' / ')
        notes = [levels, form.notes].filter(Boolean).join(' — ') || null
      }

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
        notes,
        confidence_score: form.confidenceScore,
        trade_reason:     form.tradeReason || null,
        strategy_tags:    form.strategyTags.length > 0 ? form.strategyTags : null,
      })

      setImpact(res.cash_impact)
      setSubmitState('success')
      triggerRefresh()
      setForm(prev => ({
        ...prev,
        price: '', quantity: '1', notes: '',
        support: '', resistance: '',
        tradeReason: '', strategyTags: [],
      }))
      onSuccess?.()

      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSubmitState('idle'), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSubmitState('idle')
    }
  }

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
  }, [])

  const cashPreview = form.symbol && form.price && form.quantity
    ? parseFloat(form.price || '0') * parseInt(form.quantity || '0', 10) * (isOption ? 100 : 1)
    : null

  return (
    // flex-col + gap-y-6 for breathing; no overflow-hidden at any level
    <div className="flex flex-col gap-y-6 font-sans w-full">

      {/* Closing mode banner */}
      {closeState && (
        <div className="px-4 py-2.5 rounded-v2-md bg-amber-50 border border-amber-200 text-[11px]">
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

      {/* Error */}
      {error && (
        <div className="px-4 py-2.5 rounded-v2-md bg-rose-50 border border-rose-200 text-rose-600 text-[11px]">
          {error}
        </div>
      )}

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-y-6 w-full">

        {/* ══ ASSET CONTEXT ══════════════════════════════════════════════ */}
        <Section title="Asset Context" accent="text-blue-500">

          {/* Instrument type */}
          <CToggle
            options={['OPTION', 'STOCK'] as InstrumentType[]}
            value={form.instrumentType}
            onChange={v => set('instrumentType', v)}
            labelMap={{ OPTION: 'Option', STOCK: 'Stock / ETF' }}
          />

          {/* Symbol */}
          <div>
            <label className={LBL}>Symbol</label>
            <SymbolAutocomplete
              value={form.symbol}
              onChange={v => { set('symbol', v); setSymbolValid(null); setSelectedSuggestion(null) }}
              onValidChange={setSymbolValid}
              onSelectSuggestion={s => {
                setSelectedSuggestion(s)
                // Do NOT override instrumentType — user's tab choice is authoritative
              }}
            />
            {selectedSuggestion && symbolValid === true && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {selectedSuggestion.name && (
                  <span className="text-[11px] text-stone-500">
                    {selectedSuggestion.name}
                  </span>
                )}
                <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ASSET_CLASS_STYLE[selectedSuggestion.type] ?? 'bg-stone-100/50 text-stone-500 border-stone-400/[0.06]'}`}>
                  {ASSET_CLASS_LABEL[selectedSuggestion.type] ?? selectedSuggestion.type}
                </span>
              </div>
            )}
            {symbolValid === false && form.symbol.length > 0 && (
              <p className="mt-1.5 text-[10px] text-rose-500 font-medium">
                ⚠ Unknown symbol — check ticker before recording
              </p>
            )}
          </div>

          {/* Option-only fields */}
          {isOption && (
            <>
              <CToggle
                options={['PUT', 'CALL'] as OptionType[]}
                value={form.optionType}
                onChange={v => set('optionType', v)}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LBL}>Strike</label>
                  <input
                    type="number" step="0.01" min="0" placeholder="600"
                    value={form.strike} onChange={e => set('strike', e.target.value)}
                    required={isOption} className={INP}
                  />
                </div>
                <div>
                  <label className={LBL}>Expiry</label>
                  <input
                    type="date" value={form.expiry}
                    onChange={e => set('expiry', e.target.value)}
                    required={isOption} className={INP}
                  />
                </div>
              </div>
            </>
          )}
        </Section>

        {/* ══ EXECUTION DETAILS ══════════════════════════════════════════ */}
        <Section title="Execution Details" accent="text-stone-500">

          {/* Action — Smart BUY/SELL (server resolves OPEN/CLOSE) */}
          <div>
            <label className={LBL} style={LBL_COLOR}>{t('action')}</label>
            <CToggle
              options={SMART_ACTIONS}
              value={form.action as 'BUY' | 'SELL'}
              onChange={v => set('action', v)}
            />
          </div>

          {/* Qty + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LBL}>{isOption ? 'Contracts' : 'Shares'}</label>
              <input
                type="number" min="1" step="1" value={form.quantity}
                onChange={e => set('quantity', e.target.value)} required
                className={INP}
              />
            </div>
            <div>
              <label className={LBL}>{isOption ? 'Premium' : 'Price'}</label>
              <input
                type="number" step="0.01" min="0"
                placeholder={isOption ? '5.00' : '195.00'}
                value={form.price} onChange={e => set('price', e.target.value)}
                required className={INP}
              />
            </div>
          </div>

          {/* Cash preview */}
          {cashPreview !== null && (
            <div className={[
              'px-3 py-2 rounded-lg text-[11px] font-semibold tabular-nums border',
              isSell
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : 'bg-rose-50 border-rose-100 text-rose-600',
            ].join(' ')}>
              {isSell ? '+' : '−'}${cashPreview.toLocaleString('en-US', { minimumFractionDigits: 2 })} cash impact
            </div>
          )}
        </Section>

        {/* ══ ANALYSIS & REVIEW ══════════════════════════════════════════ */}
        <Section title="Analysis & Review" accent="text-amber-500">

          {/* Conviction — 5-star rating with hover preview */}
          <StarRating
            value={form.confidenceScore}
            onChange={v => set('confidenceScore', v)}
          />

          {/* Technical Levels */}
          <div>
            <label className={LBL}>
              Technical Levels
              <span className="ml-1 normal-case font-normal text-stone-300">(optional)</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-500">S</span>
                <input
                  type="number" step="0.01" min="0" placeholder="Support"
                  value={form.support} onChange={e => set('support', e.target.value)}
                  className={`${INP} pl-7`}
                />
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-rose-500">R</span>
                <input
                  type="number" step="0.01" min="0" placeholder="Resistance"
                  value={form.resistance} onChange={e => set('resistance', e.target.value)}
                  className={`${INP} pl-7`}
                />
              </div>
            </div>
          </div>

          {/* Trade Reason — always visible, auto-height, min 3 rows */}
          <div>
            <label className={LBL}>
              Trade Reason
              <span className="ml-1 normal-case font-normal text-stone-300">(optional)</span>
            </label>
            <textarea
              rows={3}
              placeholder={t('coach_reason_ph')}
              value={form.tradeReason}
              onChange={e => set('tradeReason', e.target.value)}
              className="w-full text-xs rounded-lg border border-stone-400/[0.06] bg-white/60 px-3 py-2 text-stone-700 placeholder:text-stone-400/60 focus:outline-none focus:ring-1 focus:ring-stone-400/20 resize-none"
            />
          </div>

          {/* Strategy Tags */}
          <div>
            <label className={LBL}>Strategy Tags</label>
            <TagPicker
              selected={form.strategyTags}
              onChange={tags => set('strategyTags', tags)}
            />
          </div>
        </Section>

        {/* ── Submit ──────────────────────────────────────────────────── */}
        <button
          type="submit"
          disabled={submitState !== 'idle' || symbolValid === false}
          className={[
            'w-full py-3 rounded-v2-md text-sm font-bold ds-color shadow-sm select-none',
            submitState === 'success'
              ? 'bg-emerald-500 text-white scale-[0.98] cursor-default'
              : submitState === 'loading'
              ? 'bg-primary text-white opacity-70 cursor-wait'
              : symbolValid === false
              ? 'bg-primary text-white opacity-50 cursor-not-allowed'
              : 'bg-primary text-white hover:bg-primary/90 active:scale-[0.98]',
          ].join(' ')}
        >
          {submitState === 'success' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="text-base leading-none">✓</span>
              <span>Recorded{impact ? ` · ${fmtUSDSigned(impact)}` : ''}</span>
            </span>
          ) : submitState === 'loading' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block animate-spin text-base leading-none">⟳</span>
              <span>Recording…</span>
            </span>
          ) : (
            t('record_trade')
          )}
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
          className="w-full font-mono text-[10px] rounded-lg border border-stone-400/[0.06] px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-stone-400/20"
        />
        {clipText.trim() && parsed && parsed.matched.length > 0 && (
          <div className="flex gap-1.5">
            <button
              type="button" onClick={applyClip}
              className="flex-1 py-1.5 rounded-lg bg-white text-stone-700 shadow-sm border border-primary/20 text-[10px] font-semibold hover:bg-primary/15 ds-color"
            >
              Apply {parsed.matched.length} fields
            </button>
            <button
              type="button" onClick={() => { setClipText(''); setParsed(null) }}
              className="px-3 py-1.5 rounded-lg bg-white border border-stone-400/[0.06] text-stone-500 text-[10px] font-semibold hover:bg-stone-100/50 ds-color"
            >
              Clear
            </button>
          </div>
        )}
        {clipText.trim() && parsed && parsed.matched.length === 0 && (
          <p className="text-[10px] text-rose-500">{t('clipboard_no_match')}</p>
        )}
      </CollapseSection>
    </div>
  )
}
