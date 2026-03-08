/**
 * TopNav — horizontal top navigation bar (light chrome shell)
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ [▣] Track Holdings │ Holdings  Trade Entry  Risk  Opportunities │ ● Live │ EN·中 │ user  Logout │
 * └─────────────────────────────────────────────────────────────────┘
 */
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useLanguage } from '@/context/LanguageContext'
import { useWebSocket } from '@/context/WebSocketContext'

// ── Brand icon — portfolio bars ────────────────────────────────────────────────
const BrandIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="1" y="11" width="4" height="7" rx="1" fill="currentColor" opacity="0.5" />
    <rect x="7" y="6"  width="4" height="12" rx="1" fill="currentColor" opacity="0.75" />
    <rect x="13" y="2" width="4" height="16" rx="1" fill="currentColor" />
    <path d="M3 10 L9 6 L15 2" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
  </svg>
)

// ── Navigation items ──────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/',              end: true,  en: 'Holdings',      zh: '持仓' },
  { to: '/trade',         end: false, en: 'Trade Entry',   zh: '交易录入' },
  { to: '/risk',          end: false, en: 'Risk',          zh: '风险看板' },
  { to: '/opportunities', end: false, en: 'Opportunities', zh: '机会扫描' },
]

// ── TopNav ────────────────────────────────────────────────────────────────────
export default function TopNav() {
  const { lang, toggle } = useLanguage()
  const { user, logout } = useAuth()
  const { connected } = useWebSocket()

  return (
    <header
      className="sticky top-0 z-30 h-14 bg-chrome border-b border-chrome-border
                 flex items-center px-5 gap-3 font-sans select-none"
      style={{ boxShadow: '0 1px 3px 0 rgba(0,0,0,0.06)' }}
    >
      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-white">
          <BrandIcon />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[14px] font-bold text-chrome-text tracking-tight">
            Track Holdings
          </span>
          <span className="text-[10px] text-chrome-muted font-medium mt-px">
            Options Portfolio
          </span>
        </div>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div className="w-px h-7 bg-chrome-border mx-1 shrink-0" />

      {/* ── Nav tabs ─────────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-0.5 flex-1" aria-label="Main navigation">
        {NAV_ITEMS.map(({ to, end, en, zh }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle'
              }`
            }
          >
            {lang === 'zh' ? zh : en}
          </NavLink>
        ))}
      </nav>

      {/* ── Right controls ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        {/* WS status */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                     border border-chrome-border bg-chrome-subtle"
          title={connected ? 'WebSocket connected' : 'WebSocket disconnected'}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected
                ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.7)] animate-pulse'
                : 'bg-red-400'
            }`}
          />
          <span className={connected ? 'text-green-600' : 'text-red-500'}>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-chrome-border" />

        {/* Language toggle */}
        <button
          onClick={toggle}
          title={lang === 'en' ? 'Switch to Chinese' : '切换为英文'}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold
                     text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle
                     transition-colors border border-transparent hover:border-chrome-border"
        >
          <span className={lang === 'en' ? 'text-primary font-bold' : ''}>EN</span>
          <span className="text-chrome-border px-0.5">·</span>
          <span className={lang === 'zh' ? 'text-primary font-bold' : ''}>中</span>
        </button>

        {/* Divider */}
        {user && <div className="w-px h-5 bg-chrome-border" />}

        {/* User info + logout */}
        {user && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center
                           text-[10px] font-bold text-primary uppercase"
              >
                {user.username.charAt(0)}
              </div>
              <span className="text-xs font-medium text-chrome-muted max-w-[80px] truncate">
                {user.username}
              </span>
            </div>
            <button
              onClick={logout}
              className="text-xs text-chrome-muted hover:text-red-500 transition-colors
                         font-medium px-1.5 py-0.5 rounded hover:bg-red-50"
            >
              {lang === 'zh' ? '退出' : 'Logout'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
