/**
 * AlertsPanel — CRUD management for price alerts, embedded in RiskPage.
 * Light theme
 */
import { useState, useEffect, useRef } from 'react'
import { useWebSocket } from '@/context/WebSocketContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetchAlerts, createAlert, updateAlert, deleteAlert } from '@/api/holdings'
import type { Alert, AlertType } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  TRIGGERED: 'bg-amber-50 text-amber-700 border border-amber-200',
  DISABLED:  'bg-slate-100 text-slate-400 border border-slate-200',
}

const TYPE_LABELS_EN: Record<string, string> = {
  PRICE_ABOVE:     'Above',
  PRICE_BELOW:     'Below',
  PCT_CHANGE_UP:   '% Up',
  PCT_CHANGE_DOWN: '% Down',
}
const TYPE_LABELS_ZH: Record<string, string> = {
  PRICE_ABOVE:     '高于',
  PRICE_BELOW:     '低于',
  PCT_CHANGE_UP:   '涨幅%',
  PCT_CHANGE_DOWN: '跌幅%',
}

interface Props {
  prefillSymbol?: string | null
  prefillSpot?: string | null
}

// ── Icons ────────────────────────────────────────────────────────────────────

const IconBell = () => (
  <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

const IconPlus = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const IconTrash = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

// ── Component ────────────────────────────────────────────────────────────────

export default function AlertsPanel({ prefillSymbol, prefillSpot }: Props) {
  const { t, lang } = useLanguage()
  const { lastAlertTriggered } = useWebSocket()

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [flashId, setFlashId] = useState<number | null>(null)

  // Form state
  const [symbol, setSymbol] = useState('')
  const [alertType, setAlertType] = useState<AlertType>('PRICE_BELOW')
  const [threshold, setThreshold] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const formRef = useRef<HTMLDivElement>(null)

  // ── Load alerts ──────────────────────────────────────────────────────

  useEffect(() => {
    fetchAlerts()
      .then(setAlerts)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Prefill from HoldingsPage navigation ─────────────────────────────

  useEffect(() => {
    if (prefillSymbol) {
      setSymbol(prefillSymbol)
      setShowForm(true)
      if (prefillSpot) {
        const spot = parseFloat(prefillSpot)
        if (isFinite(spot)) {
          setThreshold((spot * 0.95).toFixed(2))
          setAlertType('PRICE_BELOW')
        }
      }
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
    }
  }, [prefillSymbol, prefillSpot])

  // ── Flash on trigger ─────────────────────────────────────────────────

  useEffect(() => {
    if (!lastAlertTriggered) return
    setFlashId(lastAlertTriggered.alert_id)
    fetchAlerts().then(setAlerts).catch(() => {})
    const timer = setTimeout(() => setFlashId(null), 3000)
    return () => clearTimeout(timer)
  }, [lastAlertTriggered])

  // ── CRUD handlers ────────────────────────────────────────────────────

  async function handleCreate() {
    if (!symbol.trim() || !threshold.trim()) return
    setSubmitting(true)
    try {
      const body = {
        symbol: symbol.toUpperCase().trim(),
        alert_type: alertType,
        threshold,
        note: note.trim() || undefined,
      }
      const created = await createAlert(body)
      setAlerts((prev) => [created, ...prev])
      setSymbol('')
      setThreshold('')
      setNote('')
      setShowForm(false)
    } catch {
      // silent
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggle(a: Alert) {
    const newStatus = a.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      const updated = await updateAlert(a.id, { status: newStatus })
      setAlerts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch {
      // silent
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAlert(id)
      setAlerts((prev) => prev.filter((x) => x.id !== id))
    } catch {
      // silent
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  const typeLabels = lang === 'zh' ? TYPE_LABELS_ZH : TYPE_LABELS_EN

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <IconBell />
          <span className="font-semibold text-sm text-slate-800">{t('alerts_title')}</span>
          {alerts.filter((a) => a.status === 'ACTIVE').length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold">
              {alerts.filter((a) => a.status === 'ACTIVE').length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-primary hover:bg-primary/5 transition-colors"
        >
          <IconPlus />
          {t('alert_add')}
        </button>
      </div>

      {/* Inline add form */}
      {showForm && (
        <div ref={formRef} className="px-5 py-3 border-b border-slate-100 bg-slate-50/80 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={t('alert_symbol')}
              className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs
                         text-slate-800 placeholder-slate-400 focus:border-primary/50 outline-none"
            />
            <select
              value={alertType}
              onChange={(e) => setAlertType(e.target.value as AlertType)}
              className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs
                         text-slate-800 focus:border-primary/50 outline-none"
            >
              <option value="PRICE_ABOVE">{typeLabels.PRICE_ABOVE}</option>
              <option value="PRICE_BELOW">{typeLabels.PRICE_BELOW}</option>
              <option value="PCT_CHANGE_UP">{typeLabels.PCT_CHANGE_UP}</option>
              <option value="PCT_CHANGE_DOWN">{typeLabels.PCT_CHANGE_DOWN}</option>
            </select>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={alertType.startsWith('PCT_') ? t('alert_pct_threshold') : t('alert_threshold')}
              type="number"
              step="any"
              className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs
                         text-slate-800 placeholder-slate-400 focus:border-primary/50 outline-none"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('alert_note')}
              className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs
                         text-slate-800 placeholder-slate-400 focus:border-primary/50 outline-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={submitting || !symbol.trim() || !threshold.trim()}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-primary/10 text-primary
                         hover:bg-primary/20 disabled:opacity-40 transition-colors"
            >
              {submitting ? t('alert_creating') : t('alert_create')}
            </button>
          </div>
        </div>
      )}

      {/* Alert list */}
      <div className="divide-y divide-slate-100">
        {loading ? (
          <div className="px-5 py-6 text-center text-xs text-slate-400 animate-pulse">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-slate-400">{t('alert_none')}</div>
        ) : (
          alerts.map((a) => {
            const isPct = a.alert_type.startsWith('PCT_')
            const target = isPct ? `${a.threshold}%` : `$${parseFloat(a.threshold).toFixed(2)}`
            const isFlash = flashId === a.id

            return (
              <div
                key={a.id}
                className={[
                  'flex items-center justify-between px-5 py-2.5 text-xs transition-colors',
                  isFlash ? 'bg-amber-50 animate-pulse' : 'hover:bg-slate-50',
                ].join(' ')}
              >
                {/* Left: symbol + type + target */}
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-slate-900 text-sm">{a.symbol}</span>
                  <span className="text-slate-500">{typeLabels[a.alert_type]}</span>
                  <span className="font-semibold text-amber-700 tabular-nums">{target}</span>
                  {a.note && (
                    <span className="text-slate-400 truncate max-w-[120px]" title={a.note}>
                      {a.note}
                    </span>
                  )}
                </div>

                {/* Right: status + actions */}
                <div className="flex items-center gap-2">
                  {a.trigger_count > 0 && (
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      x{a.trigger_count}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_STYLE[a.status]}`}>
                    {a.status === 'ACTIVE' ? t('alert_enable') : a.status === 'TRIGGERED' ? t('alert_triggered') : t('alert_disable')}
                  </span>

                  {a.status !== 'TRIGGERED' && (
                    <button
                      onClick={() => handleToggle(a)}
                      className="text-slate-400 hover:text-primary text-[10px] transition-colors"
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
          })
        )}
      </div>
    </div>
  )
}
