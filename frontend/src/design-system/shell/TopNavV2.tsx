/**
 * TopNavV2 — Metallic silver navigation frame.
 *
 * Typography hierarchy:
 *   Brand: text-lg font-semibold tracking-tight — product identity anchor
 *   Page:  text-sm font-medium text-white/60
 *   Portfolio: text-xs text-white/40
 *   Status/Lang: text-xs
 *
 * Icon: 18px, strokeWidth 2
 * Gradient: 3-stop zinc metallic (#52525b → #27272a → #18181b)
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
                 flex items-center justify-between px-10
                 select-none"
      style={{
        zIndex: 30,
        background: 'linear-gradient(135deg, #8a8a90 0%, #6e6e74 24%, #515158 58%, #3f3f45 100%)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* ═══ LEFT: Brand unit + Breadcrumb ═══════════════════════ */}
      <div className="flex items-center">
        {/* Brand unit — icon + name as one cohesive identity mark */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center text-white/85 shrink-0" style={{ width: '20px', height: '28px' }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.4" />
              <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.65" />
              <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
          </div>
          <span className="text-white hidden sm:inline font-semibold" style={{ fontSize: '20px', letterSpacing: '-0.02em', lineHeight: '1' }}>
            Track Holdings
          </span>
        </div>

        {/* Breadcrumb — faint context, distant from brand */}
        {pageTitle && (
          <div className="flex items-center ml-8 gap-2">
            <span className="text-white/10 hidden sm:inline" style={{ fontSize: '11px' }}>/</span>
            <span className="font-medium text-white/45" style={{ fontSize: '14px' }}>
              {pageTitle}
            </span>
            {selectedName && (
              <>
                <span className="text-white/10" style={{ fontSize: '11px' }}>/</span>
                <span className="text-white/28 max-w-[120px] truncate" style={{ fontSize: '12px' }}>
                  {selectedName}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══ RIGHT: Status + Language (recessive) ════════════════ */}
      <div className="flex items-center gap-4">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-v2-sm transition-colors duration-200
            ${isOffline ? 'bg-v2-negative/20 text-v2-negative' : 'text-white/30'}
          `}
          style={{ fontSize: '11px' }}
          title={`WebSocket: ${socketState}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${isReconnecting ? 'animate-pulse' : ''}`} />
          <span className="hidden sm:inline">{statusLabel}</span>
        </div>

        <button
          onClick={toggle}
          className="text-white/30 hover:text-white/60
                     px-2 py-1 rounded-v2-sm hover:bg-white/[0.04] transition-colors duration-150"
          style={{ fontSize: '11px' }}
        >
          <span className={lang === 'en' ? 'text-white/60' : ''}>EN</span>
          <span className="text-white/10 mx-0.5">/</span>
          <span className={lang === 'zh' ? 'text-white/60' : ''}>中</span>
        </button>
      </div>
    </header>
  )
}
