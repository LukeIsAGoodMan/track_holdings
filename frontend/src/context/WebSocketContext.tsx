/**
 * WebSocketContext — Phase 10: state-driven WS lifecycle.
 *
 * State machine:
 *   idle → connecting → open → subscribed → snapshot_loading → ready
 *                         ↑                                       |
 *                         └──── reconnecting ←────────────────────┘
 *                                                (on close)
 *   error / closed — terminal states (auth failure, intentional close)
 *
 * Snapshot readiness gate:
 *   Components should check `snapshotReady` before rendering data-dependent UI.
 *   This prevents blank/loading flicker during the snapshot pipeline.
 *
 * Reconnect strategy:
 *   - Exponential backoff: 1s → 2s → 4s → … → 30s cap
 *   - Jitter: ±25% randomization
 *   - Auth failure (code 4001) → NO reconnect
 *   - Intentional close (logout, unmount) → NO reconnect
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

// ── Socket State Machine ────────────────────────────────────────────────────

export type SocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'subscribed'
  | 'snapshot_loading'
  | 'ready'
  | 'reconnecting'
  | 'error'
  | 'closed'

// ── Types ────────────────────────────────────────────────────────────────────

interface WebSocketContextValue {
  /** @deprecated Use socketState instead for granular lifecycle tracking */
  connected: boolean
  socketState: SocketState
  snapshotReady: boolean
  lastSpotUpdate: Record<string, string> | null
  lastSpotChange: Record<string, string> | null
  lastSpotChangePct: Record<string, string> | null
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
const JITTER_PCT = 0.25

function jitteredDelay(base: number): number {
  const jitter = base * JITTER_PCT * (Math.random() * 2 - 1)
  return Math.max(100, Math.round(base + jitter))
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const { lang } = useLanguage()
  const { selectedPortfolioId } = usePortfolio()

  // ── State machine ──────────────────────────────────────────────────────
  const [socketState, setSocketState] = useState<SocketState>('idle')
  const [snapshotReady, setSnapshotReady] = useState(false)

  // Backward compat: derived from socketState
  const connected = socketState === 'open' || socketState === 'subscribed'
    || socketState === 'snapshot_loading' || socketState === 'ready'

  // ── Data slices ────────────────────────────────────────────────────────
  const [lastSpotUpdate, setLastSpotUpdate] = useState<Record<string, string> | null>(null)
  const [lastSpotChange, setLastSpotChange] = useState<Record<string, string> | null>(null)
  const [lastSpotChangePct, setLastSpotChangePct] = useState<Record<string, string> | null>(null)
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

  // ── Refs ───────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayRef = useRef(INITIAL_DELAY)
  const subscribedPidRef = useRef<number | null>(null)
  const intentionalClose = useRef(false)

  // ── Connect ────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!token) return

    // Prevent duplicate connections
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    setSocketState('connecting')
    setSnapshotReady(false)

    // Build WS URL
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
      setSocketState('open')
      delayRef.current = INITIAL_DELAY

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
          // ── Phase 10: lifecycle messages ────────────────────────────
          case 'subscribed_ack':
            setSocketState('subscribed')
            break

          case 'snapshot_status':
            if (msg.status === 'starting') {
              setSocketState('snapshot_loading')
              setSnapshotReady(false)
            } else if (msg.status === 'complete') {
              setSocketState('ready')
              setSnapshotReady(true)
            }
            break

          case 'snapshot_error':
            // Log but don't crash — partial data is acceptable
            console.warn('[WS] Snapshot step failed:', msg.step, msg.message)
            break

          // ── Data messages (unchanged) ──────────────────────────────
          case 'spot_update':
            setLastSpotUpdate(msg.data)
            if (msg.change)    setLastSpotChange(msg.change)
            if (msg.changepct) setLastSpotChangePct(msg.changepct)
            break
          case 'holdings_update':
            setLastHoldingsUpdate({ portfolioId: msg.portfolio_id, data: msg.data })
            // If we receive holdings before snapshot_status:complete, mark ready
            // (backward compat with servers that don't send snapshot_status yet)
            setSnapshotReady(true)
            if (socketState === 'snapshot_loading' || socketState === 'subscribed') {
              setSocketState('ready')
            }
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

          // ── Control messages ───────────────────────────────────────
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }))
            break
          case 'subscribed':
            // Legacy ack — handled by subscribed_ack now, keep for compat
            break
          case 'error':
            console.warn('[WS] Server error:', msg.message)
            break
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = (event) => {
      wsRef.current = null
      subscribedPidRef.current = null

      // 4001 = auth failure → terminal, no reconnect
      if (event.code === 4001) {
        setSocketState('error')
        setSnapshotReady(false)
        return
      }

      // 4008 = pong timeout from server
      // Intentional close → terminal
      if (intentionalClose.current) {
        intentionalClose.current = false
        setSocketState('closed')
        setSnapshotReady(false)
        return
      }

      // Reconnect with jittered exponential backoff
      setSocketState('reconnecting')
      setSnapshotReady(false)
      const delay = jitteredDelay(delayRef.current)
      delayRef.current = Math.min(delayRef.current * BACKOFF_FACTOR, MAX_DELAY)
      reconnectTimer.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      // onerror always fires before onclose; onclose handles reconnect
    }
  }, [token, selectedPortfolioId, lang])

  // ── Effect: connect/disconnect when auth changes ───────────────────────

  useEffect(() => {
    if (!token) {
      if (wsRef.current) {
        intentionalClose.current = true
        wsRef.current.close()
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      setSocketState('idle')
      setSnapshotReady(false)
      return
    }

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

  // ── Effect: reconnect when language changes ────────────────────────────

  useEffect(() => {
    if (!token) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // ── Effect: resubscribe when portfolio selection changes ───────────────

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (selectedPortfolioId == null) return

    // Unsubscribe from old portfolio
    if (subscribedPidRef.current != null && subscribedPidRef.current !== selectedPortfolioId) {
      ws.send(JSON.stringify({ type: 'unsubscribe', portfolio_id: subscribedPidRef.current }))
      setSnapshotReady(false)
    }

    // Subscribe to new portfolio
    ws.send(JSON.stringify({ type: 'subscribe', portfolio_id: selectedPortfolioId }))
    subscribedPidRef.current = selectedPortfolioId
  }, [selectedPortfolioId, connected])

  // ── Provide ────────────────────────────────────────────────────────────

  return (
    <WebSocketContext.Provider
      value={{
        connected,
        socketState,
        snapshotReady,
        lastSpotUpdate,
        lastSpotChange,
        lastSpotChangePct,
        lastHoldingsUpdate,
        lastRiskUpdate,
        lastOpportunitiesUpdate,
        lastAlertTriggered,
        lastPnlSnapshot,
        lastAiInsight,
        lastMacroTicker,
      }}
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
