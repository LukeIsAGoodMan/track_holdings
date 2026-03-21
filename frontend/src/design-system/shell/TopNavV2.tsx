/**
 * TopNavV2 — Premium dark metallic frame.
 *
 * Feels like a frame, not a toolbar.
 * Typography: brand ~16px font-medium, breadcrumb ~13px reduced opacity.
 * Spacious gaps, minimal controls.
 */
import { useLocation } from 'react-router-dom'
import { useLanguage }  from '@/context/LanguageContext'
import { usePortfolio } from '@/context/PortfolioContext'
import { useWebSocket } from '@/context/WebSocketContext'

const PAGE_TITLES: Record<string, { en: string; zh: string }> = {
  '/holdings':      { en: 'Holdings',      zh: '持仓' },
  '/risk':          { en: 'Risk',          zh: '风险' },
  '/opportunities': { en: 'Opportunities', zh: '机会' },
  '/analysis':      { en: 'Analysis',      zh: '分析' },
}

function usePageTitle(pathname: string, isEn: boolean): string {
  for (const [prefix, labels] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(prefix)) return isEn ? labels.en : labels.zh
  }
  return ''
}

export default function TopNavV2() {
  const location = useLocation()
  const { lang, toggle } = useLanguage()
  const { socketState, connected } = useWebSocket()
  const { portfolios, selectedPortfolioId } = usePortfolio()

  const isEn = lang === 'en'
  const pageTitle = usePageTitle(location.pathname, isEn)

  const selectedName = (() => {
    const walk = (nodes: typeof portfolios): string | null => {
      for (const p of nodes) {
        if (p.id === selectedPortfolioId) return p.name
        const found = walk(p.children)
        if (found) return found
      }
      return null
    }
    return walk(portfolios)
  })()

  const isLive = socketState === 'ready'
  const isReconnecting = socketState === 'reconnecting' || socketState === 'connecting'
  const isOffline = !connected && !isReconnecting

  const statusColor = isLive ? 'bg-v2-positive' : isReconnecting ? 'bg-v2-caution' : 'bg-v2-negative'
  const statusLabel = isLive ? 'Live' : isReconnecting ? (isEn ? 'Reconnecting...' : '重连中...') : (isEn ? 'Disconnected' : '已断开')

  return (
    <header
      className="sticky top-0 h-14 backdrop-blur-xl
                 flex items-center justify-between px-8
                 border-b border-white/6 select-none"
      style={{
        zIndex: 30,
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
      }}
    >
      {/* ── Left: Brand + Context ──────────────────────────────── */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-v2-sm bg-white/8 flex items-center justify-center text-white shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.5" />
              <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.75" />
              <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
          </div>
          <span className="text-base font-medium text-white hidden sm:inline" style={{ letterSpacing: '-0.01em' }}>
            Track Holdings
          </span>
        </div>

        {pageTitle && (
          <>
            <span className="text-white/15 hidden sm:inline">/</span>
            <span className="text-sm font-medium text-white/60">
              {pageTitle}
            </span>
            {selectedName && (
              <>
                <span className="text-white/15 text-xs">/</span>
                <span className="text-xs text-white/40 max-w-[120px] truncate">
                  {selectedName}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Right: Status + Language ───────────────────────────── */}
      <div className="flex items-center gap-4">
        {/* WS status — minimal */}
        <div
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-v2-sm transition-colors duration-200
            ${isOffline ? 'bg-v2-negative/20 text-v2-negative' : 'text-white/40'}
          `}
          title={`WebSocket: ${socketState}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${isReconnecting ? 'animate-pulse' : ''}`} />
          <span className="hidden sm:inline">{statusLabel}</span>
        </div>

        {/* Language toggle */}
        <button
          onClick={toggle}
          className="text-xs text-white/40 hover:text-white/80
                     px-2 py-1 rounded-v2-sm hover:bg-white/5 transition-colors duration-150"
        >
          <span className={lang === 'en' ? 'text-white/80' : ''}>EN</span>
          <span className="text-white/15 mx-0.5">/</span>
          <span className={lang === 'zh' ? 'text-white/80' : ''}>中</span>
        </button>
      </div>
    </header>
  )
}
