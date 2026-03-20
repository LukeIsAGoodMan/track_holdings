/**
 * TopNavV2 — Context anchor + control surface.
 *
 * Layout: h-14, flex items-center justify-between px-6
 * Left:  Brand + dynamic page title
 * Right: WS status (tactical, inline reconnect) + portfolio name + lang + user
 *
 * Consistent height across all pages. No layout jump.
 */
import { useLocation } from 'react-router-dom'
import { useAuth }      from '@/context/AuthContext'
import { useLanguage }  from '@/context/LanguageContext'
import { usePortfolio } from '@/context/PortfolioContext'
import { useWebSocket } from '@/context/WebSocketContext'

// ── Page titles derived from route ──────────────────────────────────────────
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
  const { user, logout } = useAuth()
  const { socketState, connected } = useWebSocket()
  const { portfolios, selectedPortfolioId } = usePortfolio()

  const isEn = lang === 'en'
  const pageTitle = usePageTitle(location.pathname, isEn)

  // Find selected portfolio name
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

  // WS status
  const isLive = socketState === 'ready'
  const isReconnecting = socketState === 'reconnecting' || socketState === 'connecting'
  const isOffline = !connected && !isReconnecting

  const statusColor = isLive ? 'bg-v2-positive' : isReconnecting ? 'bg-v2-caution' : 'bg-v2-negative'
  const statusLabel = isLive ? 'Live' : isReconnecting ? (isEn ? 'Reconnecting...' : '重连中...') : (isEn ? 'Disconnected' : '已断开')

  return (
    <header
      className="sticky top-0 h-14 bg-v2-surface/80 backdrop-blur-xl
                 flex items-center justify-between px-6
                 border-b border-v2-border select-none"
      style={{ zIndex: 30 }}
    >
      {/* ── Left: Brand + Page Title ────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-v2-sm bg-v2-accent flex items-center justify-center text-white shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.5" />
              <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.75" />
              <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
          </div>
          <span className="text-ds-body text-v2-text-1 hidden sm:inline">
            Track Holdings
          </span>
        </div>

        {/* Page title + portfolio breadcrumb */}
        {pageTitle && (
          <>
            <span className="text-v2-border hidden sm:inline">/</span>
            <span className="text-ds-body-r text-v2-text-2">
              {pageTitle}
            </span>
            {selectedName && (
              <>
                <span className="text-v2-border text-ds-sm">/</span>
                <span className="text-ds-sm text-v2-text-3 max-w-[120px] truncate">
                  {selectedName}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Right: Status + Controls ──────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* WS status — tactical, inline */}
        <div
          className={`flex items-center gap-1.5 text-ds-sm font-bold px-2 py-1 rounded-v2-sm transition-colors duration-200
            ${isOffline ? 'bg-v2-negative-bg text-v2-negative' : 'text-v2-text-3'}
          `}
          title={`WebSocket: ${socketState}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${isLive ? '' : isReconnecting ? 'animate-pulse' : ''}`} />
          <span className="hidden sm:inline">{statusLabel}</span>
        </div>

        {/* Language toggle */}
        <button
          onClick={toggle}
          className="text-ds-sm text-v2-text-3 hover:text-v2-text-1
                     px-2 py-1 rounded-v2-sm hover:bg-v2-surface-alt transition-colors duration-150"
        >
          <span className={lang === 'en' ? 'text-v2-accent font-bold' : ''}>EN</span>
          <span className="text-v2-border mx-0.5">/</span>
          <span className={lang === 'zh' ? 'text-v2-accent font-bold' : ''}>中</span>
        </button>

        {/* User avatar + logout */}
        {user && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-v2-accent-soft flex items-center justify-center
                            text-ds-caption text-v2-accent uppercase">
              {user.username.charAt(0)}
            </div>
            <span className="text-ds-sm text-v2-text-2 max-w-[70px] truncate hidden md:inline">
              {user.username}
            </span>
            <button
              onClick={logout}
              className="text-ds-sm text-v2-text-3 hover:text-v2-negative transition-colors duration-150
                         px-1.5 py-0.5 rounded-v2-sm hover:bg-v2-negative-bg"
            >
              {isEn ? 'Logout' : '退出'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
