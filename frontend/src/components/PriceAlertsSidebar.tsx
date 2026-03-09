/**
 * PriceAlertsSidebar — Alert CRUD panel for the 520px sidebar.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Active alerts list  (scrollable, flex-1)           │
 *   ├─────────────────────────────────────────────────────┤
 *   │  Add alert form  (3-col grid, wide layout)          │
 *   └─────────────────────────────────────────────────────┘
 *
 * Adapted from AlertsPanel.tsx but designed for 520px sidebar width.
 * Form is always shown (auto-open). prefillSymbol/prefillPrice seed it.
 */
import { useState, useEffect, useRef } from 'react'
import { useWebSocket }  from '@/context/WebSocketContext'
import { useLanguage }   from '@/context/LanguageContext'
import { fetchAlerts, createAlert, updateAlert, deleteAlert } from '@/api/holdings'
import type { Alert, AlertType } from '@/types'
import type { AlertPrefill } from '@/context/SidebarContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  TRIGGERED: 'bg-amber-50 text-amber-700 border border-amber-200',
  DISABLED:  'bg-slate-100 text-slate-400 border border-slate-200',
}

const TYPE_LABELS_EN: Record<string, string> = {
  PRICE_ABOVE:     'Price above',
  PRICE_BELOW:     'Price below',
  PCT_CHANGE_UP:   '% change up',
  PCT_CHANGE_DOWN: '% change down',
}
const TYPE_LABELS_ZH: Record<string, string> = {
  PRICE_ABOVE:     '高于价格',
  PRICE_BELOW:     '低于价格',
  PCT_CHANGE_UP:   '涨幅%',
  PCT_CHANGE_DOWN: '跌幅%',
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconTrash = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

const IconPlus = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  prefill?: AlertPrefill | null
}

export default function PriceAlertsSidebar({ prefill }: Props) {
  const { t, lang }           = useLanguage()
  const { lastAlertTriggered } = useWebSocket()

  const [alerts,    setAlerts]    = useState<Alert[]>([])
  const [loading,   setLoading]   = useState(true)
  const [flashId,   setFlashId]   = useState<number | null>(null)

  // Form
  const [symbol,    setSymbol]    = useState(prefill?.symbol ?? '')
  const [alertType, setAlertType] = useState<AlertType>('PRICE_BELOW')
  const [threshold, setThreshold] = useState(
    prefill?.price ? (prefill.price * 0.95).toFixed(2) : ''
  )
  const [note,      setNote]      = useState('')
  const [submitting, setSubmitting] = useState(false)

  const formRef = useRef<HTMLDivElement>(null)

  // ── Load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchAlerts()
      .then(setAlerts)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Sync prefill when context changes ────────────────────────────────
  useEffect(() => {
    if (!prefill) return
    setSymbol(prefill.symbol)
    if (prefill.price) {
      setThreshold((prefill.price * 0.95).toFixed(2))
      setAlertType('PRICE_BELOW')
    }
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
  }, [prefill])

  // ── Flash on WS trigger ──────────────────────────────────────────────
  useEffect(() => {
    if (!lastAlertTriggered) return
    setFlashId(lastAlertTriggered.alert_id)
    fetchAlerts().then(setAlerts).catch(() => {})
    const t = setTimeout(() => setFlashId(null), 3000)
    return () => clearTimeout(t)
  }, [lastAlertTriggered])

  // ── CRUD ─────────────────────────────────────────────────────────────
  async function handleCreate() {
    if (!symbol.trim() || !threshold.trim()) return
    setSubmitting(true)
    try {
      const created = await createAlert({
        symbol:     symbol.toUpperCase().trim(),
        alert_type: alertType,
        threshold,
        note:       note.trim() || undefined,
      })
      setAlerts(prev => [created, ...prev])
      setSymbol('')
      setThreshold('')
      setNote('')
    } catch { /* silent */ }
    finally { setSubmitting(false) }
  }

  async function handleToggle(a: Alert) {
    const newStatus = a.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      const updated = await updateAlert(a.id, { status: newStatus })
      setAlerts(prev => prev.map(x => x.id === updated.id ? updated : x))
    } catch { /* silent */ }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAlert(id)
      setAlerts(prev => prev.filter(x => x.id !== id))
    } catch { /* silent */ }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const typeLabels = lang === 'zh' ? TYPE_LABELS_ZH : TYPE_LABELS_EN
  const activeCount = alerts.filter(a => a.status === 'ACTIVE').length

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Alert list ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* Section header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-400">
            {lang === 'zh' ? '活跃警报' : 'Active Alerts'}
          </span>
          {activeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700
                             border border-amber-200 font-bold tabular-nums">
              {activeCount}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2 px-4 pt-1">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            {t('alert_none')}
          </div>
        ) : (
          <div className="px-3 pb-2 space-y-1">
            {alerts.map(a => {
              const isPct   = a.alert_type.startsWith('PCT_')
              const target  = isPct ? `${a.threshold}%` : `$${parseFloat(a.threshold).toFixed(2)}`
              const isFlash = flashId === a.id

              return (
                <div
                  key={a.id}
                  className={[
                    'flex items-center justify-between rounded-xl px-3 py-2.5 text-xs transition-colors',
                    isFlash ? 'bg-amber-50 animate-pulse' : 'bg-slate-50 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {/* Left: symbol + condition */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-900 text-[13px] shrink-0">{a.symbol}</span>
                    <span className="text-slate-500 shrink-0">{typeLabels[a.alert_type]}</span>
                    <span className="font-semibold text-amber-700 tabular-nums shrink-0">{target}</span>
                    {a.note && (
                      <span className="text-slate-400 truncate min-w-0" title={a.note}>{a.note}</span>
                    )}
                  </div>

                  {/* Right: trigger count + status + actions */}
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {a.trigger_count > 0 && (
                      <span className="text-[10px] text-slate-400 tabular-nums">×{a.trigger_count}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_STYLE[a.status]}`}>
                      {a.status === 'ACTIVE'
                        ? t('alert_enable')
                        : a.status === 'TRIGGERED'
                          ? t('alert_triggered')
                          : t('alert_disable')}
                    </span>
                    {a.status !== 'TRIGGERED' && (
                      <button
                        onClick={() => handleToggle(a)}
                        className="text-slate-400 hover:text-sky-600 text-[10px] transition-colors whitespace-nowrap"
                      >
                        {a.status === 'ACTIVE' ? t('alert_disable') : t('alert_enable')}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="text-slate-400 hover:text-rose-600 transition-colors"
                      title={t('alert_delete')}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="mx-4 h-px bg-slate-100 shrink-0" />

      {/* ── Add alert form ───────────────────────────────────────────────── */}
      <div ref={formRef} className="px-4 pt-3 pb-4 shrink-0 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-400">
          {lang === 'zh' ? '新建警报' : 'New Alert'}
        </div>

        {/* Row 1: Symbol · Type · Threshold (3-col, uses full 520px width) */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              {t('alert_symbol')}
            </label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="AAPL"
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]
                         text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:bg-white
                         outline-none transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              {lang === 'zh' ? '条件' : 'Condition'}
            </label>
            <select
              value={alertType}
              onChange={e => setAlertType(e.target.value as AlertType)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]
                         text-slate-800 focus:border-sky-400 focus:bg-white outline-none
                         transition-colors"
            >
              <option value="PRICE_ABOVE">{TYPE_LABELS_EN.PRICE_ABOVE}</option>
              <option value="PRICE_BELOW">{TYPE_LABELS_EN.PRICE_BELOW}</option>
              <option value="PCT_CHANGE_UP">{TYPE_LABELS_EN.PCT_CHANGE_UP}</option>
              <option value="PCT_CHANGE_DOWN">{TYPE_LABELS_EN.PCT_CHANGE_DOWN}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              {alertType.startsWith('PCT_')
                ? (lang === 'zh' ? '百分比' : 'Percent %')
                : (lang === 'zh' ? '目标价' : 'Target $')}
            </label>
            <input
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              placeholder={alertType.startsWith('PCT_') ? '5.00' : '150.00'}
              type="number"
              step="any"
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]
                         text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:bg-white
                         outline-none transition-colors tabular-nums"
            />
          </div>
        </div>

        {/* Row 2: Note + Submit */}
        <div className="flex gap-2">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t('alert_note')}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]
                       text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:bg-white
                       outline-none transition-colors"
          />
          <button
            onClick={handleCreate}
            disabled={submitting || !symbol.trim() || !threshold.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-semibold
                       bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors shrink-0"
          >
            <IconPlus />
            {submitting
              ? (lang === 'zh' ? '创建中…' : 'Adding…')
              : (lang === 'zh' ? '添加' : 'Add')}
          </button>
        </div>
      </div>
    </div>
  )
}
