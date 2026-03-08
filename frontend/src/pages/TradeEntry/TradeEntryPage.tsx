/**
 * Trade Entry Page — light professional theme
 */
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { createTrade } from '@/api/holdings'
import { usePortfolio } from '@/context/PortfolioContext'
import { useLanguage }  from '@/context/LanguageContext'
import type { TradeAction, InstrumentType, OptionType, ClosePositionState } from '@/types'
import { fmtUSDSigned, fmtNum } from '@/utils/format'
import { parseClipboard, fieldLabel } from '@/utils/clipboardParser'
import type { ParsedTrade } from '@/utils/clipboardParser'

type FormState = {
  symbol: string; instrumentType: InstrumentType; optionType: OptionType
  strike: string; expiry: string; action: TradeAction
  quantity: string; price: string; notes: string
  confidenceScore: number; tradeReason: string; nearSupport: boolean; strategyTags: string[]
}

const STRATEGY_TAGS = [
  'Hedge', 'Speculative', 'Earnings', 'Income',
  'Momentum', 'Mean Reversion', 'Wheel', 'Volatility',
] as const

const ACTION_LABELS: Record<TradeAction, string> = {
  SELL_OPEN:  'Sell Open  (short)',
  BUY_OPEN:   'Buy Open   (long)',
  BUY_CLOSE:  'Buy Close  (cover short)',
  SELL_CLOSE: 'Sell Close (exit long)',
}

const INITIAL: FormState = {
  symbol: '', instrumentType: 'OPTION', optionType: 'PUT',
  strike: '', expiry: '', action: 'SELL_OPEN',
  quantity: '1', price: '', notes: '',
  confidenceScore: 3, tradeReason: '', nearSupport: false, strategyTags: [],
}

function fromCloseState(cs: ClosePositionState): FormState {
  return {
    ...INITIAL, symbol: cs.symbol, instrumentType: cs.instrumentType,
    optionType: cs.optionType ?? INITIAL.optionType,
    strike: cs.strike ?? '', expiry: cs.expiry ?? '',
    action: cs.action, quantity: cs.quantity, price: '',
    tradeReason: `Closing position for ${cs.symbol}`, strategyTags: [],
  }
}

// ── Toggle button group ───────────────────────────────────────────────────────
function Toggle<T extends string>({
  label, options, value, onChange, labelMap,
}: {
  label: string; options: T[]; value: T; onChange: (v: T) => void
  labelMap?: Record<string, string>
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
        {options.map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={['flex-1 px-3 py-2 text-xs font-semibold transition-colors',
              value === opt
                ? 'bg-primary-soft text-primary'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white',
            ].join(' ')}
          >
            {labelMap?.[opt] ?? opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Star rating ───────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button"
          onMouseEnter={() => setHovered(star)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className={`text-xl transition-colors ${
            star <= (hovered || value) ? 'text-amber-400' : 'text-slate-200 hover:text-amber-300'
          }`}>★</button>
      ))}
      <span className="text-xs text-slate-400 ml-2">{value}/5</span>
    </div>
  )
}

// ── Tag picker ────────────────────────────────────────────────────────────────
function TagPicker({ selected, onChange, tags }: {
  selected: string[]; onChange: (tags: string[]) => void; tags: readonly string[]
}) {
  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag])
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const active = selected.includes(tag)
        return (
          <button key={tag} type="button" onClick={() => toggle(tag)}
            className={[
              'px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors',
              active
                ? 'bg-primary-soft border-primary/30 text-primary'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
            ].join(' ')}>{tag}</button>
        )
      })}
    </div>
  )
}

// ── Cash notification ─────────────────────────────────────────────────────────
function CashNotification({ impact, onDismiss }: { impact: string; onDismiss: () => void }) {
  const n = parseFloat(impact)
  return (
    <div className={['flex items-center justify-between px-4 py-3 rounded-2xl border text-sm font-semibold',
      n >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
             : 'bg-rose-50 border-rose-200 text-rose-700'].join(' ')}>
      <span>Trade recorded — Cash impact: {fmtUSDSigned(impact)}</span>
      <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600 ml-4">✕</button>
    </div>
  )
}

// ── Confidence bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ score }: { score: number }) {
  const pct   = Math.round(score * 100)
  const color = score >= 0.7 ? 'bg-emerald-500' : score >= 0.4 ? 'bg-amber-500' : 'bg-rose-500'
  const label = score >= 0.7 ? 'text-emerald-600' : score >= 0.4 ? 'text-amber-600' : 'text-rose-600'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${label}`}>{pct}%</span>
    </div>
  )
}

// ── Field chip ────────────────────────────────────────────────────────────────
function FieldChip({ field, value }: { field: string; value: string }) {
  const FIELD_COLORS: Record<string, string> = {
    action:         'bg-primary-soft text-primary border-primary/20',
    symbol:         'bg-violet-50 text-violet-700 border-violet-200',
    instrumentType: 'bg-slate-100 text-slate-600 border-slate-200',
    optionType:     'bg-amber-50 text-amber-700 border-amber-200',
    strike:         'bg-cyan-50 text-cyan-700 border-cyan-200',
    expiry:         'bg-indigo-50 text-indigo-700 border-indigo-200',
    quantity:       'bg-emerald-50 text-emerald-700 border-emerald-200',
    price:          'bg-teal-50 text-teal-700 border-teal-200',
  }
  const cls = FIELD_COLORS[field] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-mono ${cls}`}>
      <span className="opacity-50 text-[10px]">{field}</span>
      {fieldLabel(field, value)}
    </span>
  )
}

// ── Parse preview ─────────────────────────────────────────────────────────────
function ParsePreview({ parsed, onApply, onClear, t }: {
  parsed: ParsedTrade; onApply: () => void; onClear: () => void; t: (key: string) => string
}) {
  const FIELD_ORDER = ['action', 'symbol', 'instrumentType', 'optionType', 'strike', 'expiry', 'quantity', 'price'] as const
  if (!parsed.matched.length) {
    return (
      <div className="text-xs text-rose-600 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl">
        {t('clipboard_no_match')}
      </div>
    )
  }
  const valueFor: Record<string, string> = {
    action: parsed.action ?? '', symbol: parsed.symbol ?? '',
    instrumentType: parsed.instrumentType ?? '', optionType: parsed.optionType ?? '',
    strike: parsed.strike ?? '', expiry: parsed.expiry ?? '',
    quantity: parsed.quantity ?? '', price: parsed.price ?? '',
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400 uppercase tracking-wider">{t('clipboard_confidence')}</span>
        <div className="flex-1"><ConfidenceBar score={parsed.confidence} /></div>
      </div>
      {parsed.confidence < 0.4 && (
        <p className="text-[11px] text-amber-600">{t('clipboard_low')}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {FIELD_ORDER
          .filter((f) => parsed.matched.includes(f) && valueFor[f])
          .map((f) => <FieldChip key={f} field={f} value={valueFor[f]} />)}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onApply}
          className="flex-1 py-1.5 rounded-xl bg-primary-soft border border-primary/20 text-primary
                     text-xs font-semibold hover:bg-primary/15 transition-colors">
          {t('clipboard_apply')}
        </button>
        <button type="button" onClick={onClear}
          className="px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-500
                     text-xs font-semibold hover:bg-slate-50 transition-colors">
          {t('clipboard_clear')}
        </button>
      </div>
    </div>
  )
}

// ── Closing mode banner ───────────────────────────────────────────────────────
function ClosingModeBanner({ cs, t }: { cs: ClosePositionState; t: (k: string) => string }) {
  const dirLabel = cs.action === 'BUY_CLOSE' ? 'Buy to Close' : 'Sell to Close'
  const typeTag  = cs.instrumentType === 'OPTION'
    ? `${cs.optionType} $${fmtNum(cs.strike ?? '0')} (${cs.expiry})`
    : 'STOCK'
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200">
      <span className="text-amber-500 text-lg leading-none mt-0.5">⚠</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700">{t('closing_mode')}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200 font-semibold">
            {dirLabel}
          </span>
        </div>
        <p className="text-xs text-amber-600">
          {cs.quantity} × <span className="font-bold text-amber-800">{cs.symbol}</span>{' '}
          {typeTag} — {t('closing_mode_desc')}
        </p>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function TradeEntryPage() {
  const { selectedPortfolioId, triggerRefresh } = usePortfolio()
  const { t } = useLanguage()
  const location = useLocation()

  const closeState = (location.state as { closePosition?: ClosePositionState } | null)?.closePosition
  const [form,        setForm]        = useState<FormState>(() => closeState ? fromCloseState(closeState) : INITIAL)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [lastImpact,  setLastImpact]  = useState<string | null>(null)
  const [clipText,    setClipText]    = useState('')
  const [parsedTrade, setParsedTrade] = useState<ParsedTrade | null>(null)

  const isOption = form.instrumentType === 'OPTION'

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  function handleClipChange(text: string) {
    setClipText(text)
    if (!text.trim()) { setParsedTrade(null); return }
    const result = parseClipboard(text)
    setParsedTrade(result.matched.length > 0 ? result : { ...result, matched: [] })
  }

  function handleApply() {
    if (!parsedTrade) return
    setForm((prev) => ({
      ...prev,
      ...(parsedTrade.symbol         && { symbol:         parsedTrade.symbol }),
      ...(parsedTrade.instrumentType && { instrumentType: parsedTrade.instrumentType }),
      ...(parsedTrade.optionType     && { optionType:     parsedTrade.optionType }),
      ...(parsedTrade.strike         && { strike:         parsedTrade.strike }),
      ...(parsedTrade.expiry         && { expiry:         parsedTrade.expiry }),
      ...(parsedTrade.action         && { action:         parsedTrade.action }),
      ...(parsedTrade.quantity       && { quantity:       parsedTrade.quantity }),
      ...(parsedTrade.price          && { price:          parsedTrade.price }),
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPortfolioId) { setError('Select a portfolio in the sidebar first.'); return }
    setLoading(true); setError(null); setLastImpact(null)
    let reasonFull = form.tradeReason.trim()
    if (form.nearSupport) reasonFull = reasonFull ? `[Near support] ${reasonFull}` : '[Near support]'
    try {
      const res = await createTrade({
        portfolio_id:    selectedPortfolioId,
        symbol:          form.symbol.trim().toUpperCase(),
        instrument_type: form.instrumentType,
        option_type:     isOption ? form.optionType : null,
        strike:          isOption && form.strike ? form.strike : null,
        expiry:          isOption && form.expiry  ? form.expiry  : null,
        action:          form.action,
        quantity:        parseInt(form.quantity, 10),
        price:           form.price,
        notes:           form.notes || null,
        confidence_score: form.confidenceScore,
        trade_reason:    reasonFull || null,
        strategy_tags:   form.strategyTags.length > 0 ? form.strategyTags : null,
      })
      setLastImpact(res.cash_impact)
      triggerRefresh()
      setForm((prev) => ({ ...prev, price: '', quantity: '1', notes: '', tradeReason: '', nearSupport: false, strategyTags: [] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5 font-sans">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('trade_title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('trade_sub')}</p>
      </div>

      {closeState && <ClosingModeBanner cs={closeState} t={t as (k: string) => string} />}
      {lastImpact && <CashNotification impact={lastImpact} onDismiss={() => setLastImpact(null)} />}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-rose-700 text-sm">{error}</div>
      )}

      {/* Clipboard import */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            {t('clipboard_import')}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary-soft text-primary font-semibold">
            smart parse
          </span>
        </div>
        <p className="text-[11px] text-slate-400">{t('clipboard_hint')}</p>
        <textarea
          rows={3}
          value={clipText}
          onChange={(e) => handleClipChange(e.target.value)}
          onPaste={(e) => { const pasted = e.clipboardData.getData('text'); handleClipChange(pasted) }}
          placeholder={t('clipboard_ph')}
          spellCheck={false}
          className="font-mono text-xs"
        />
        {clipText.trim() && parsedTrade !== null && (
          <ParsePreview
            parsed={parsedTrade} onApply={handleApply} onClear={() => { setClipText(''); setParsedTrade(null) }}
            t={t as (key: string) => string}
          />
        )}
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
        {/* Action */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{t('action')}</label>
          <select value={form.action} onChange={(e) => setField('action', e.target.value as TradeAction)}>
            {(Object.keys(ACTION_LABELS) as TradeAction[]).map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>

        <Toggle label={t('instrument')} options={['OPTION', 'STOCK'] as InstrumentType[]}
          value={form.instrumentType} onChange={(v) => setField('instrumentType', v)}
          labelMap={{ OPTION: 'Option', STOCK: 'Stock / ETF' }} />

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{t('symbol')}</label>
          <input type="text" placeholder="e.g. NVDA" value={form.symbol}
            onChange={(e) => setField('symbol', e.target.value.toUpperCase())} required />
        </div>

        {isOption && (
          <>
            <Toggle label={t('option_type')} options={['PUT', 'CALL'] as OptionType[]}
              value={form.optionType} onChange={(v) => setField('optionType', v)} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{t('strike')}</label>
                <input type="number" step="0.01" min="0" placeholder="600.00"
                  value={form.strike} onChange={(e) => setField('strike', e.target.value)} required={isOption} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{t('expiry')}</label>
                <input type="date" value={form.expiry}
                  onChange={(e) => setField('expiry', e.target.value)} required={isOption} />
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              {t('quantity')} ({isOption ? 'contracts' : 'shares'})
            </label>
            <input type="number" min="1" step="1" value={form.quantity}
              onChange={(e) => setField('quantity', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              {isOption ? 'Premium / share ($)' : `${t('price')} ($)`}
            </label>
            <input type="number" step="0.01" min="0"
              placeholder={isOption ? '500.00' : '195.00'}
              value={form.price} onChange={(e) => setField('price', e.target.value)} required />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            {t('notes')} (optional)
          </label>
          <input type="text" placeholder="e.g. Wheel strategy leg 1"
            value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
        </div>

        {/* Trading Coach */}
        <div className="border-t border-slate-100 pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
              {t('coach_section')}
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">
              — optional · saved to trade_metadata
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('coach_confidence')}
            </label>
            <StarRating value={form.confidenceScore} onChange={(v) => setField('confidenceScore', v)} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('coach_tags')}
            </label>
            <TagPicker selected={form.strategyTags} onChange={(tags) => setField('strategyTags', tags)} tags={STRATEGY_TAGS} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              {t('coach_reason')}
            </label>
            <textarea rows={2} placeholder={t('coach_reason_ph')}
              value={form.tradeReason} onChange={(e) => setField('tradeReason', e.target.value)} />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={form.nearSupport}
              onChange={(e) => setField('nearSupport', e.target.checked)}
              className="accent-amber-500 w-3.5 h-3.5" />
            <span className="text-xs text-slate-600">{t('coach_support')}</span>
          </label>
        </div>

        {/* Preview */}
        {form.symbol && form.price && form.quantity && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 tabular-nums">
            Preview — Cash impact:{' '}
            <span className={form.action === 'SELL_OPEN' || form.action === 'SELL_CLOSE'
              ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
              {form.action === 'SELL_OPEN' || form.action === 'SELL_CLOSE' ? '+' : '-'}$
              {(parseFloat(form.price || '0') * parseInt(form.quantity || '0', 10) * (isOption ? 100 : 1))
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full py-2.5 rounded-xl bg-primary text-white
                     text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm
                     disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? t('recording') : t('record_trade')}
        </button>
      </form>
    </div>
  )
}
