/**
 * AlertToastListener — watches for alert_triggered WS events and fires toasts.
 *
 * Must be rendered inside <WebSocketProvider>.
 */
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useWebSocket } from '@/context/WebSocketContext'
import { useLanguage } from '@/context/LanguageContext'

const TYPE_LABELS_EN: Record<string, string> = {
  PRICE_ABOVE: 'crossed above',
  PRICE_BELOW: 'dropped below',
  PCT_CHANGE_UP: 'rose past',
  PCT_CHANGE_DOWN: 'fell past',
}
const TYPE_LABELS_ZH: Record<string, string> = {
  PRICE_ABOVE: '突破',
  PRICE_BELOW: '跌破',
  PCT_CHANGE_UP: '涨超',
  PCT_CHANGE_DOWN: '跌超',
}

export default function AlertToastListener() {
  const { lastAlertTriggered } = useWebSocket()
  const { lang } = useLanguage()

  useEffect(() => {
    if (!lastAlertTriggered) return
    const { symbol, alert_type, threshold, spot_price, note } = lastAlertTriggered
    const labels = lang === 'zh' ? TYPE_LABELS_ZH : TYPE_LABELS_EN
    const action = labels[alert_type] ?? alert_type

    const isPct = alert_type.startsWith('PCT_')
    const target = isPct ? `${threshold}%` : `$${threshold}`
    const title = `${symbol} ${action} ${target}`
    const subtitle = `${lang === 'zh' ? '当前' : 'Now'} $${spot_price}`
    const full = note ? `${title}\n${subtitle}\n${note}` : `${title}\n${subtitle}`

    toast(full, {
      icon: '\uD83D\uDD14',
      duration: 8000,
      style: {
        background: '#1e293b',
        color: '#fbbf24',
        border: '1px solid rgba(245, 158, 11, 0.2)',
        whiteSpace: 'pre-line',
        fontSize: '13px',
        maxWidth: '360px',
      },
    })
  }, [lastAlertTriggered, lang])

  return null
}
