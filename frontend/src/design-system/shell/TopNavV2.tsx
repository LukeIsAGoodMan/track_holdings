/**
 * TopNavV2 — Product facade.
 *
 * Reads as a premium product surface, not a navigation toolbar.
 *
 * Composition:
 *   LEFT:  Brand unit (icon mark + product name) — tight, cohesive identity
 *          ···gap···
 *          Breadcrumb context (page / portfolio) — faint, secondary
 *   RIGHT: Live status + language — minimal, recessive
 *
 * Typography:
 *   Brand:     20px / semibold / -0.02em — product identity anchor
 *   Page:      14px / medium / white-50 — operating context
 *   Portfolio: 12px / white-30 — secondary context
 *   Controls:  11px / white-35 — recessive utilities
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
      {/* ═══ LEFT: Brand unit + Breadcrumb context ═══════════════ */}
      <div className="flex items-center">

        {/* ── Brand unit (icon + name as one mark) ──────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Precision mark — elongated container, monochrome, architectural */}
          <div
            className="flex items-center justify-center text-white/90 shrink-0"
            style={{ width: '22px', height: '28px' }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.45" />
              <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.7" />
              <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
          </div>
          <span
            className="text-white hidden sm:inline font-semibold"
            style={{ fontSize: '20px', letterSpacing: '-0.02em', lineHeight: '1' }}
          >
            Track Holdings
          </span>
        </div>

        {/* ── Breadcrumb context (faint, distant) ──────────────── */}
        {pageTitle && (
          <div className="flex items-center ml-8 gap-2">
            <span className="text-white/12 hidden sm:inline" style={{ fontSize: '11px' }}>
              /
            </span>
            <span
              className="font-medium text-white/50"
              style={{ fontSize: '14px', letterSpacing: '-0.005em' }}
            >
              {pageTitle}
            </span>
            {selectedName && (
              <>
                <span className="text-white/12" style={{ fontSize: '11px' }}>
                  /
                </span>
                <span
                  className="text-white/30 max-w-[120px] truncate"
                  style={{ fontSize: '12px' }}
                >
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
            ${isOffline ? 'bg-v2-negative/20 text-v2-negative' : 'text-white/35'}
          `}
          style={{ fontSize: '11px' }}
          title={`WebSocket: ${socketState}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${isReconnecting ? 'animate-pulse' : ''}`} />
          <span className="hidden sm:inline">{statusLabel}</span>
        </div>

        <button
          onClick={toggle}
          className="text-white/35 hover:text-white/70
                     px-2 py-1 rounded-v2-sm hover:bg-white/5 transition-colors duration-150"
          style={{ fontSize: '11px' }}
        >
          <span className={lang === 'en' ? 'text-white/70' : ''}>EN</span>
          <span className="text-white/12 mx-0.5">/</span>
          <span className={lang === 'zh' ? 'text-white/70' : ''}>中</span>
        </button>
      </div>
    </header>
  )
}
