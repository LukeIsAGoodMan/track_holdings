/**
 * TopNavV2 — Apple-minimal top navigation bar.
 *
 * Layout: h-14, flex items-center justify-between px-6
 * Left:  Page context (title or breadcrumb)
 * Right: Status + controls
 *
 * NO heavy separators. NO clutter. Breathing room only.
 */
import { useAuth }      from '@/context/AuthContext'
import { useLanguage }  from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'

export default function TopNavV2() {
  const { lang, toggle } = useLanguage()
  const { user, logout } = useAuth()
  const { socketState, connected } = useWebSocket()

  const statusColor =
    socketState === 'ready'       ? 'bg-v2-positive' :
    socketState === 'reconnecting' || socketState === 'connecting'
                                   ? 'bg-v2-caution' :
    connected                      ? 'bg-green-400' : 'bg-v2-negative'

  const statusLabel =
    socketState === 'ready'       ? 'Live' :
    socketState === 'reconnecting' ? 'Reconnecting' :
    connected                      ? 'Syncing' : 'Offline'

  return (
    <header
      className="sticky top-0 z-30 h-14 bg-v2-surface
                 flex items-center justify-between px-6
                 border-b border-v2-border-sub select-none"
    >
      {/* ── Left: Brand ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-v2-md bg-v2-accent flex items-center justify-center text-white shrink-0">
          <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.75" />
            <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
          </svg>
        </div>
        <span className="text-[15px] font-semibold text-v2-text-1 tracking-tight">
          Track Holdings
        </span>
      </div>

      {/* ── Right: Status + Controls ─────────────────────────────────── */}
      <div className="flex items-center gap-4">
        {/* WebSocket status — minimal pill */}
        <div
          className="flex items-center gap-1.5 text-xs font-medium text-v2-text-3"
          title={`WebSocket: ${socketState}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor} ${socketState === 'ready' ? 'animate-pulse' : ''}`} />
          {statusLabel}
        </div>

        {/* Language toggle — understated */}
        <button
          onClick={toggle}
          className="text-xs font-medium text-v2-text-3 hover:text-v2-text-1
                     px-2 py-1 rounded-v2-sm hover:bg-v2-surface-alt transition-colors"
        >
          <span className={lang === 'en' ? 'text-v2-accent font-semibold' : ''}>EN</span>
          <span className="text-v2-border mx-1">/</span>
          <span className={lang === 'zh' ? 'text-v2-accent font-semibold' : ''}>中</span>
        </button>

        {/* User — avatar + name */}
        {user && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-v2-accent-soft flex items-center justify-center
                            text-[11px] font-semibold text-v2-accent uppercase">
              {user.username.charAt(0)}
            </div>
            <span className="text-xs font-medium text-v2-text-2 max-w-[80px] truncate hidden sm:inline">
              {user.username}
            </span>
            <button
              onClick={logout}
              className="text-xs text-v2-text-3 hover:text-v2-negative transition-colors
                         font-medium px-1.5 py-0.5 rounded-v2-sm hover:bg-v2-negative-bg"
            >
              {lang === 'zh' ? '退出' : 'Logout'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
