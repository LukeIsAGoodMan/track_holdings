/**
 * TopNavV2 — Warm silver metal cap.
 *
 * Material: warm aluminum (#d6d3d1 base) with subtle tonal modeling.
 * Form: cap feel via micro-chamfer lower edge (pseudo-element gradient).
 * Text: deep warm stone (#44403c) with micro text-shadow for engraved feel.
 * No visible gradient bands, no border-bottom lines, no flat fill.
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

/** Engraved text style — warm stone on warm metal */
const engraved: React.CSSProperties = {
  color: '#44403c',
  textShadow: '0 0.5px 0 rgba(255, 255, 255, 0.15)',
}

const engSub: React.CSSProperties = {
  color: 'rgba(68, 64, 60, 0.72)',
  textShadow: '0 0.5px 0 rgba(255, 255, 255, 0.12)',
}

const engMuted: React.CSSProperties = {
  color: 'rgba(68, 64, 60, 0.48)',
  textShadow: '0 0.5px 0 rgba(255, 255, 255, 0.10)',
}

const engRecessive: React.CSSProperties = {
  color: 'rgba(68, 64, 60, 0.42)',
  textShadow: '0 0.5px 0 rgba(255, 255, 255, 0.08)',
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
      className="sticky top-0 h-14 relative
                 flex items-center justify-between px-10
                 select-none"
      style={{
        zIndex: 30,
        background: 'linear-gradient(180deg, #e7e5e4 0%, #d6d3d1 60%, #ccc9c6 100%)',
      }}
    >
      {/* Chamfer edge — micro gradient at bottom simulating machined edge light */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: '1px',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.08) 100%)',
        }}
      />

      {/* ═══ LEFT: Brand + Breadcrumb ═══════════════════════════ */}
      <div className="flex items-center">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center shrink-0" style={{ width: '20px', height: '28px', ...engSub }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.4" />
              <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.65" />
              <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
          </div>
          <span
            className="hidden sm:inline font-semibold"
            style={{ fontSize: '20px', letterSpacing: '-0.02em', lineHeight: '1', ...engraved }}
          >
            Track Holdings
          </span>
        </div>

        {pageTitle && (
          <div className="flex items-center ml-8 gap-2">
            <span className="hidden sm:inline" style={{ fontSize: '11px', ...engMuted }}>/</span>
            <span className="font-medium" style={{ fontSize: '14px', ...engSub }}>
              {pageTitle}
            </span>
            {selectedName && (
              <>
                <span style={{ fontSize: '11px', ...engMuted }}>/</span>
                <span className="max-w-[120px] truncate" style={{ fontSize: '12px', ...engMuted }}>
                  {selectedName}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ═══ RIGHT: Status + Language ═══════════════════════════ */}
      <div className="flex items-center gap-4">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-v2-sm transition-colors duration-200
            ${isOffline ? 'bg-v2-negative/20 text-v2-negative' : ''}
          `}
          style={{ fontSize: '11px', ...(isOffline ? {} : engRecessive) }}
          title={`WebSocket: ${socketState}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${isReconnecting ? 'animate-pulse' : ''}`} />
          <span className="hidden sm:inline">{statusLabel}</span>
        </div>

        <button
          onClick={toggle}
          className="px-2 py-1 rounded-v2-sm hover:bg-black/[0.03] transition-colors duration-150"
          style={{ fontSize: '11px' }}
        >
          <span style={lang === 'en' ? engSub : engRecessive}>EN</span>
          <span style={{ ...engMuted, margin: '0 2px' }}>/</span>
          <span style={lang === 'zh' ? engSub : engRecessive}>中</span>
        </button>
      </div>
    </header>
  )
}
