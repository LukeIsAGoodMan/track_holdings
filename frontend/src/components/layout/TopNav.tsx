/**
 * TopNav — horizontal top navigation bar (light chrome shell)
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ [▣] Track Holdings │ Holdings ▼  Risk  Opportunities │ ● Live │ EN·中 │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Holdings nav item is a dropdown showing three sub-routes:
 *   Overview · Details · Records
 */
import { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth }     from '@/context/AuthContext'
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

// ── Chevron icon ───────────────────────────────────────────────────────────────
const ChevronDown = ({ open }: { open: boolean }) => (
  <svg
    className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    viewBox="0 0 12 12" fill="none" aria-hidden="true"
  >
    <path d="M2 4.5L6 8l4-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ── Holdings sub-routes ────────────────────────────────────────────────────────
const HOLDINGS_SUBITEMS = [
  { to: '/holdings/overview', en: 'Overview', zh: '总览' },
  { to: '/holdings/details',  en: 'Details',  zh: '持仓明细' },
  { to: '/holdings/records',  en: 'Records',  zh: '交易记录' },
]

// ── Other top-level nav items ──────────────────────────────────────────────────
const OTHER_NAV = [
  { to: '/risk',          en: 'Risk',          zh: '风险看板' },
  { to: '/opportunities', en: 'Opportunities', zh: '机会扫描' },
  { to: '/analysis',      en: 'Analysis',      zh: '分析' },
]

// ── TopNav ────────────────────────────────────────────────────────────────────
export default function TopNav() {
  const { lang, toggle } = useLanguage()
  const { user, logout } = useAuth()
  const { connected, socketState } = useWebSocket()
  const location         = useLocation()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isHoldingsActive = location.pathname.startsWith('/holdings')

  // Close dropdown when clicking outside
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  // Close dropdown on route change
  useEffect(() => { setDropdownOpen(false) }, [location.pathname])

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

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-0.5 flex-1" aria-label="Main navigation">

        {/* Holdings dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium
                        transition-all duration-150 ${
              isHoldingsActive
                ? 'bg-primary/10 text-primary'
                : 'text-chrome-muted hover:text-chrome-text hover:bg-chrome-subtle'
            }`}
            aria-haspopup="true"
            aria-expanded={dropdownOpen}
          >
            {lang === 'zh' ? '持仓' : 'Holdings'}
            <ChevronDown open={dropdownOpen} />
          </button>

          {/* Dropdown panel */}
          {dropdownOpen && (
            <div
              className="absolute top-full left-0 mt-1.5 w-44 bg-white border border-slate-200
                         rounded-xl shadow-lg py-1 z-50"
              role="menu"
            >
              {HOLDINGS_SUBITEMS.map(({ to, en, zh }) => (
                <NavLink
                  key={to}
                  to={to}
                  role="menuitem"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  {/* Active dot */}
                  {({ isActive }: { isActive: boolean }) => (
                    <>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-primary' : 'bg-transparent'}`} />
                      {lang === 'zh' ? zh : en}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {/* Other nav items */}
        {OTHER_NAV.map(({ to, en, zh }) => (
          <NavLink
            key={to}
            to={to}
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
          title={`WebSocket: ${socketState}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              socketState === 'ready'
                ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.7)] animate-pulse'
                : socketState === 'reconnecting' || socketState === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : connected
                    ? 'bg-green-400'
                    : 'bg-red-400'
            }`}
          />
          <span className={connected ? 'text-green-600' : socketState === 'reconnecting' ? 'text-amber-600' : 'text-red-500'}>
            {socketState === 'ready' ? 'Live' : socketState === 'reconnecting' ? 'Reconnecting' : connected ? 'Syncing' : 'Offline'}
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
