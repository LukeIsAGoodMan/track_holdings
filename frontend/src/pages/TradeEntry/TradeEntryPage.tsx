/**
 * Trade Entry Page
 *
 * Smart form:
 *  · Defaults to SELL_OPEN
 *  · Strike / Expiry visible only when instrument_type = OPTION
 *  · Trading Coach section: star rating (1-5), trade reason, support-level check
 *  · Smart Clipboard Parser: paste any trade confirmation → auto-fills form
 *  · One-Click Close: accepts navigation state from HoldingsPage → pre-fills for close
 *  · On success: shows signed cash impact notification
 *  · Atomic — backend guarantees TradeEvent + CashLedger in one transaction
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
  symbol:          string
  instrumentType:  InstrumentType
  optionType:      OptionType
  strike:          string
  expiry:          string
  action:          TradeAction
  quantity:        string
  price:           string
  notes:           string
  confidenceScore: number   // 1-5
  tradeReason:     string
  nearSupport:     boolean
  strategyTags:    string[]
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
  confidenceScore: 3, tradeReason: '', nearSupport: false,
  strategyTags: [],
}

/** Build initial form from a ClosePositionState passed via react-router navigation state. */
function fromCloseState(cs: ClosePositionState): FormState {
  return {
    ...INITIAL,
    symbol:         cs.symbol,
    instrumentType: cs.instrumentType,
    optionType:     cs.optionType ?? INITIAL.optionType,
    strike:         cs.strike     ?? '',
    expiry:         cs.expiry     ?? '',
    action:         cs.action,
    quantity:       cs.quantity,
    price:          '',   // user must enter market price
    tradeReason:    `Closing position for ${cs.symbol}`,
    strategyTags:   [],
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
      <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      <div className="flex rounded-md border border-line overflow-hidden">
        {options.map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={['flex-1 px-3 py-2 text-xs font-semibold transition-colors',
              value === opt ? 'bg-info/20 text-info' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
            ].join(' ')}
          >
            {labelMap?.[opt] ?? opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Star rating ──────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star} type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className={`text-xl transition-colors ${
            star <= (hovered || value) ? 'text-amber-400' : 'text-slate-700 hover:text-amber-600'
          }`}
        >★</button>
      ))}
      <span className="text-xs text-slate-500 ml-2">{value}/5</span>
    </div>
  )
}

// ── Tag picker ───────────────────────────────────────────────────────────
function TagPicker({
  selected, onChange, tags,
}: {
  selected: string[]
  onChange: (tags: string[]) => void
  tags: readonly string[]
}) {
  function toggle(tag: string) {
    onChange(
      selected.includes(tag)
        ? selected.filter((t) => t !== tag)
        : [...selected, tag]
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const active = selected.includes(tag)
        return (
          <button
            key={tag} type="button" onClick={() => toggle(tag)}
            className={[
              'px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors',
              active
                ? 'bg-info/20 border-info/40 text-info'
                : 'bg-transparent border-line text-slate-500 hover:border-slate-400 hover:text-slate-300',
            ].join(' ')}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}

// ── Notification ──────────────────────────────────────────────────────────────
function CashNotification({ impact, onDismiss }: { impact: string; onDismiss: () => void }) {
  const n = parseFloat(impact)
  return (
    <div className={['flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold',
      n >= 0 ? 'bg-green-500/10 border-green-500/30 text-green-400'
             : 'bg-red-500/10 border-red-500/30 text-red-400'].join(' ')}>
      <span>Trade recorded — Cash impact: {fmtUSDSigned(impact)}</span>
      <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 ml-4">✕</button>
    </div>
  )
}

// ── Confidence bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ score }: { score: number }) {
  const pct   = Math.round(score * 100)
  const color = score >= 0.7 ? 'bg-bull' : score >= 0.4 ? 'bg-warn' : 'bg-bear'
  const label = score >= 0.7 ? 'text-bull' : score >= 0.4 ? 'text-warn' : 'text-bear'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${label}`}>{pct}%</span>
    </div>
  )
}

// ── Parsed field chip ─────────────────────────────────────────────────────────
function FieldChip({ field, value }: { field: string; value: string }) {
  const FIELD_COLORS: Record<string, string> = {
    action:         'bg-info/15 text-info border-info/30',
    symbol:         'bg-purple-500/15 text-purple-300 border-purple-500/30',
    instrumentType: 'bg-slate-700 text-slate-300 border-slate-600',
    optionType:     'bg-amber-500/15 text-amber-300 border-amber-500/30',
    strike:         'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    expiry:         'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    quantity:       'bg-green-500/15 text-green-300 border-green-500/30',
    price:          'bg-bull/15 text-bull border-bull/30',
  }
  const cls = FIELD_COLORS[field] ?? 'bg-slate-700 text-slate-300 border-slate-600'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono ${cls}`}>
      <span className="opacity-60 text-[10px]">{field}</span>
      {fieldLabel(field, value)}
    </span>
  )
}

// ── Parse result preview card ─────────────────────────────────────────────────
function ParsePreview({
  parsed, onApply, onClear, t,
}: {
  parsed: ParsedTrade
  onApply: () => void
  onClear: () => void
  t: (key: string) => string
}) {
  const FIELD_ORDER = ['action', 'symbol', 'instrumentType', 'optionType', 'strike', 'expiry', 'quantity', 'price'] as const
  const hasAny = parsed.matched.length > 0

  if (!hasAny) {
    return (
      <div className="text-xs text-bear px-3 py-2 bg-bear/10 border border-bear/20 rounded-lg">
        {t('clipboard_no_match')}
      </div>
    )
  }

  // Collect values for each matched field
  const valueFor: Record<string, string> = {
    action:         parsed.action         ?? '',
    symbol:         parsed.symbol         ?? '',
    instrumentType: parsed.instrumentType ?? '',
    optionType:     parsed.optionType     ?? '',
    strike:         parsed.strike         ?? '',
    expiry:         parsed.expiry         ?? '',
    quantity:       parsed.quantity       ?? '',
    price:          parsed.price          ?? '',
  }

  return (
    <div className="space-y-3">
      {/* Confidence */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider">
          {t('clipboard_confidence')}
        </span>
        <div className="flex-1">
          <ConfidenceBar score={parsed.confidence} />
        </div>
      </div>

      {/* Low-confidence warning */}
      {parsed.confidence < 0.4 && (
        <p className="text-[11px] text-warn">{t('clipboard_low')}</p>
      )}

      {/* Field chips */}
      <div className="flex flex-wrap gap-1.5">
        {FIELD_ORDER
          .filter((f) => parsed.matched.includes(f) && valueFor[f])
          .map((f) => (
            <FieldChip key={f} field={f} value={valueFor[f]} />
          ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onApply}
          className="flex-1 py-1.5 rounded-lg bg-info/20 border border-info/40 text-info
                     text-xs font-semibold hover:bg-info/30 transition-colors"
        >
          {t('clipboard_apply')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="px-4 py-1.5 rounded-lg bg-slate-700/50 border border-line text-slate-400
                     text-xs font-semibold hover:bg-slate-700 transition-colors"
        >
          {t('clipboard_clear')}
        </button>
      </div>
    </div>
  )
}

// ── Closing Mode banner ───────────────────────────────────────────────────────
function ClosingModeBanner({
  cs, t,
}: {
  cs: ClosePositionState
  t: (k: string) => string
}) {
  const dirLabel = cs.action === 'BUY_CLOSE' ? 'Buy to Close' : 'Sell to Close'
  const typeTag  = cs.instrumentType === 'OPTION'
    ? `${cs.optionType} $${fmtNum(cs.strike ?? '0')} (${cs.expiry})`
    : 'STOCK'

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl
                    bg-amber-500/10 border border-amber-500/30">
      {/* Icon */}
      <span className="text-amber-400 text-lg leading-none mt-0.5">⚠</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            {t('closing_mode')}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
            {dirLabel}
          </span>
        </div>
        <p className="text-xs text-amber-300/80">
          {cs.quantity} × <span className="font-bold text-amber-200">{cs.symbol}</span>{' '}
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

  // Detect one-click close navigation state from HoldingsPage
  const closeState = (location.state as { closePosition?: ClosePositionState } | null)
    ?.closePosition

  const [form,          setForm]          = useState<FormState>(() =>
    closeState ? fromCloseState(closeState) : INITIAL
  )
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [lastImpact,    setLastImpact]    = useState<string | null>(null)

  // Clipboard parser state
  const [clipText,      setClipText]      = useState('')
  const [parsedTrade,   setParsedTrade]   = useState<ParsedTrade | null>(null)

  const isOption = form.instrumentType === 'OPTION'

  function setField<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  // ── Clipboard handlers ──────────────────────────────────────────────────────
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
    // Keep clipboard panel open so user can see what was applied
  }

  function handleClearClip() {
    setClipText('')
    setParsedTrade(null)
  }

  // ── Form submit ─────────────────────────────────────────────────────────────
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
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">{t('trade_title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('trade_sub')}</p>
      </div>

      {/* ── Closing Mode banner (one-click close from HoldingsPage) ──────────── */}
      {closeState && (
        <ClosingModeBanner cs={closeState} t={t as (k: string) => string} />
      )}

      {lastImpact && <CashNotification impact={lastImpact} onDismiss={() => setLastImpact(null)} />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ── Clipboard Import (Smart Parser) ─────────────────────────────────── */}
      <div className="bg-card border border-line rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            {t('clipboard_import')}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info font-semibold">
            smart parse
          </span>
        </div>

        <p className="text-[11px] text-slate-600">{t('clipboard_hint')}</p>

        <textarea
          rows={3}
          value={clipText}
          onChange={(e) => handleClipChange(e.target.value)}
          onPaste={(e) => {
            // Let the event propagate naturally; onChange fires after state update
            // For instant feedback on paste, read from event directly
            const pasted = e.clipboardData.getData('text')
            handleClipChange(pasted)
          }}
          placeholder={t('clipboard_ph')}
          spellCheck={false}
          className="w-full bg-app border border-line rounded-md px-3 py-2 text-xs
                     text-slate-200 placeholder-slate-700 resize-none font-mono
                     focus:outline-none focus:border-info/50 transition-colors"
        />

        {/* Result preview — shown only when there's parsed output */}
        {clipText.trim() && parsedTrade !== null && (
          <ParsePreview
            parsed={parsedTrade}
            onApply={handleApply}
            onClear={handleClearClip}
            t={t as (key: string) => string}
          />
        )}
      </div>

      <form onSubmit={handleSubmit} className="bg-card border border-line rounded-xl p-6 space-y-5">

        {/* Action */}
        <div>
          <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">{t('action')}</label>
          <select value={form.action} onChange={(e) => setField('action', e.target.value as TradeAction)}>
            {(Object.keys(ACTION_LABELS) as TradeAction[]).map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>

        <Toggle label={t('instrument')} options={['OPTION', 'STOCK'] as InstrumentType[]}
          value={form.instrumentType} onChange={(v) => setField('instrumentType', v)}
          labelMap={{ OPTION: 'Option', STOCK: 'Stock / ETF' }} />

        {/* Symbol */}
        <div>
          <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">{t('symbol')}</label>
          <input type="text" placeholder="e.g. NVDA" value={form.symbol}
            onChange={(e) => setField('symbol', e.target.value.toUpperCase())} required />
        </div>

        {/* Option-specific */}
        {isOption && (
          <>
            <Toggle label={t('option_type')} options={['PUT', 'CALL'] as OptionType[]}
              value={form.optionType} onChange={(v) => setField('optionType', v)} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">{t('strike')}</label>
                <input type="number" step="0.01" min="0" placeholder="600.00"
                  value={form.strike} onChange={(e) => setField('strike', e.target.value)} required={isOption} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">{t('expiry')}</label>
                <input type="date" value={form.expiry}
                  onChange={(e) => setField('expiry', e.target.value)} required={isOption} />
              </div>
            </div>
          </>
        )}

        {/* Qty + Price */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
              {t('quantity')} ({isOption ? 'contracts' : 'shares'})
            </label>
            <input type="number" min="1" step="1" value={form.quantity}
              onChange={(e) => setField('quantity', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
              {isOption ? 'Premium / share ($)' : `${t('price')} ($)`}
            </label>
            <input type="number" step="0.01" min="0"
              placeholder={isOption ? '500.00' : '195.00'}
              value={form.price} onChange={(e) => setField('price', e.target.value)} required />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
            {t('notes')} (optional)
          </label>
          <input type="text" placeholder="e.g. Wheel strategy leg 1"
            value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
        </div>

        {/* ── Trading Coach ─────────────────────────────────────────────── */}
        <div className="border-t border-line pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              {t('coach_section')}
            </span>
            <span className="text-[10px] text-slate-600 uppercase tracking-wider">
              — optional · saved to trade_metadata
            </span>
          </div>

          {/* Confidence */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
              {t('coach_confidence')}
            </label>
            <StarRating value={form.confidenceScore} onChange={(v) => setField('confidenceScore', v)} />
          </div>

          {/* Strategy Tags */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
              {t('coach_tags')}
            </label>
            <TagPicker
              selected={form.strategyTags}
              onChange={(tags) => setField('strategyTags', tags)}
              tags={STRATEGY_TAGS}
            />
          </div>

          {/* Trade reason */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
              {t('coach_reason')}
            </label>
            <textarea rows={2} placeholder={t('coach_reason_ph')}
              value={form.tradeReason}
              onChange={(e) => setField('tradeReason', e.target.value)}
              className="w-full bg-app border border-line rounded-md px-3 py-2 text-sm
                         text-slate-200 placeholder-slate-600 resize-none
                         focus:outline-none focus:border-info/50"
            />
          </div>

          {/* Near support checkbox */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={form.nearSupport}
              onChange={(e) => setField('nearSupport', e.target.checked)}
              className="accent-amber-400 w-3.5 h-3.5" />
            <span className="text-xs text-slate-400">{t('coach_support')}</span>
          </label>
        </div>

        {/* Preview */}
        {form.symbol && form.price && form.quantity && (
          <div className="text-xs text-slate-500 bg-row rounded-lg px-3 py-2 tabular-nums">
            Preview — Cash impact:{' '}
            <span className={form.action === 'SELL_OPEN' || form.action === 'SELL_CLOSE'
              ? 'text-green-400' : 'text-red-400'}>
              {form.action === 'SELL_OPEN' || form.action === 'SELL_CLOSE' ? '+' : '-'}$
              {(parseFloat(form.price || '0') * parseInt(form.quantity || '0', 10) * (isOption ? 100 : 1))
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full py-2.5 rounded-lg bg-info/20 border border-info/40 text-info
                     text-sm font-semibold hover:bg-info/30 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? t('recording') : t('record_trade')}
        </button>
      </form>
    </div>
  )
}
