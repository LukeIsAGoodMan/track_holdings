/**
 * WebSocketContext — manages a single WS connection to /api/ws
 *
 * Auto-connects when authenticated, auto-subscribes to the selected portfolio,
 * and dispatches live updates (spot_update, holdings_update, risk_update) to
 * consuming pages via React context.
 *
 * Reconnect: exponential backoff (1s → 2s → 4s → … → 30s max).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useLanguage } from './LanguageContext'
import { usePortfolio } from './PortfolioContext'
import type { HoldingGroup, RiskDashboard, MarketOpportunity, AlertTriggered, PnlSnapshot, AiInsightData, MacroTickerData } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface WebSocketContextValue {
  connected: boolean
  lastSpotUpdate: Record<string, string> | null
  lastHoldingsUpdate: { portfolioId: number; data: HoldingGroup[] } | null
  lastRiskUpdate: { portfolioId: number; data: Partial<RiskDashboard> } | null
  lastOpportunitiesUpdate: MarketOpportunity[] | null
  lastAlertTriggered: AlertTriggered | null
  lastPnlSnapshot: PnlSnapshot | null
  lastAiInsight: { portfolioId: number; data: AiInsightData } | null
  lastMacroTicker: MacroTickerData | null
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

const INITIAL_DELAY = 1000
const MAX_DELAY = 30000
const BACKOFF_FACTOR = 2

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const { lang } = useLanguage()
  const { selectedPortfolioId } = usePortfolio()

  const [connected, setConnected] = useState(false)
  const [lastSpotUpdate, setLastSpotUpdate] = useState<Record<string, string> | null>(null)
  const [lastHoldingsUpdate, setLastHoldingsUpdate] = useState<{
    portfolioId: number
    data: HoldingGroup[]
  } | null>(null)
  const [lastRiskUpdate, setLastRiskUpdate] = useState<{
    portfolioId: number
    data: Partial<RiskDashboard>
  } | null>(null)
  const [lastOpportunitiesUpdate, setLastOpportunitiesUpdate] = useState<MarketOpportunity[] | null>(null)
  const [lastAlertTriggered, setLastAlertTriggered] = useState<AlertTriggered | null>(null)
  const [lastPnlSnapshot, setLastPnlSnapshot] = useState<PnlSnapshot | null>(null)
  const [lastAiInsight, setLastAiInsight] = useState<{
    portfolioId: number
    data: AiInsightData
  } | null>(null)
  const [lastMacroTicker, setLastMacroTicker] = useState<MacroTickerData | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayRef = useRef(INITIAL_DELAY)
  const subscribedPidRef = useRef<number | null>(null)
  const intentionalClose = useRef(false)

  // ── Connect ──────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!token) return

    // Build WS URL
    // Dev:  Vite proxy on same host → ws://localhost:5173/api/ws
    // Prod: VITE_API_URL → wss://track-holdings-api.onrender.com/api/ws
    const apiUrl = import.meta.env.VITE_API_URL
    let url: string
    if (apiUrl) {
      const wsProto = apiUrl.startsWith('https') ? 'wss:' : 'ws:'
      const host = apiUrl.replace(/^https?:\/\//, '')
      url = `${wsProto}//${host}/api/ws?token=${encodeURIComponent(token)}&lang=${lang}`
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      url = `${proto}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}&lang=${lang}`
    }

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      delayRef.current = INITIAL_DELAY // reset backoff on success

      // Auto-subscribe if a portfolio is already selected
      if (selectedPortfolioId != null) {
        ws.send(JSON.stringify({ type: 'subscribe', portfolio_id: selectedPortfolioId }))
        subscribedPidRef.current = selectedPortfolioId
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'spot_update':
            setLastSpotUpdate(msg.data)
            break
          case 'holdings_update':
            setLastHoldingsUpdate({ portfolioId: msg.portfolio_id, data: msg.data })
            break
          case 'risk_update':
            setLastRiskUpdate({ portfolioId: msg.portfolio_id, data: msg.data })
            break
          case 'market_opportunity':
            setLastOpportunitiesUpdate(msg.data)
            break
          case 'alert_triggered':
            setLastAlertTriggered(msg.data)
            break
          case 'pnl_snapshot':
            setLastPnlSnapshot({
              portfolioId: msg.portfolio_id,
              current: msg.data.current,
              prevCloseNlv: msg.data.prev_close_nlv,
              dayPnlPct: msg.data.day_pnl_pct,
              series: msg.data.series,
            })
            break
          case 'ai_insight':
            setLastAiInsight({ portfolioId: msg.portfolio_id, data: msg.data })
            break
          case 'macro_ticker':
            setLastMacroTicker(msg.data)
            break
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }))
            break
          case 'subscribed':
          case 'error':
            // Logged for debugging, no state action needed
            if (msg.type === 'error') console.warn('[WS] Server error:', msg.message)
            break
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = (event) => {
      setConnected(false)
      wsRef.current = null
      subscribedPidRef.current = null

      // 4001 = auth failure from backend → don't reconnect
      if (event.code === 4001) return

      // Don't reconnect if we closed intentionally (logout, unmount)
      if (intentionalClose.current) {
        intentionalClose.current = false
        return
      }

      // Exponential backoff reconnect
      const delay = delayRef.current
      delayRef.current = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY)
      reconnectTimer.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      // onerror always fires before onclose; onclose handles reconnect
    }
  }, [token, selectedPortfolioId, lang])

  // ── Effect: connect/disconnect when auth changes ─────────────────────────

  useEffect(() => {
    if (!token) {
      // Logged out → close existing connection
      if (wsRef.current) {
        intentionalClose.current = true
        wsRef.current.close()
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      setConnected(false)
      return
    }

    // Connect
    connect()

    return () => {
      intentionalClose.current = true
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // ── Effect: reconnect when language changes (Phase 11) ──────────────────

  useEffect(() => {
    // On language change, close existing WS so it reconnects with new lang param
    if (!token) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    // Intentional close — onclose handler will reconnect with new lang
    ws.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // ── Effect: resubscribe when portfolio selection changes ─────────────────

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (selectedPortfolioId == null) return

    // Unsubscribe from old portfolio
    if (subscribedPidRef.current != null && subscribedPidRef.current !== selectedPortfolioId) {
      ws.send(JSON.stringify({ type: 'unsubscribe', portfolio_id: subscribedPidRef.current }))
    }

    // Subscribe to new portfolio
    ws.send(JSON.stringify({ type: 'subscribe', portfolio_id: selectedPortfolioId }))
    subscribedPidRef.current = selectedPortfolioId
  }, [selectedPortfolioId, connected])

  // ── Provide ──────────────────────────────────────────────────────────────

  return (
    <WebSocketContext.Provider
      value={{ connected, lastSpotUpdate, lastHoldingsUpdate, lastRiskUpdate, lastOpportunitiesUpdate, lastAlertTriggered, lastPnlSnapshot, lastAiInsight, lastMacroTicker }}
    >
      {children}
    </WebSocketContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error('useWebSocket must be used inside <WebSocketProvider>')
  return ctx
}
