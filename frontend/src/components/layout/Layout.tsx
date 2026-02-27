/**
 * Layout — responsive shell: fixed sidebar (md+) + scrollable main area.
 */
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useLanguage } from '@/context/LanguageContext'

export default function Layout() {
  const { lang, toggle } = useLanguage()

  return (
    <div className="flex min-h-screen bg-app">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <Sidebar />

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between
                           px-6 py-3 bg-card/80 backdrop-blur border-b border-line">
          <span className="text-slate-500 text-xs">
            Powered by Black-Scholes · live via yfinance
          </span>

          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={toggle}
              title={lang === 'en' ? 'Switch to Chinese' : '切换为英文'}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md
                         border border-line text-xs font-semibold
                         text-slate-400 hover:text-slate-200 hover:border-slate-500
                         transition-colors select-none"
            >
              <span className={lang === 'en' ? 'text-info' : 'text-slate-600'}>EN</span>
              <span className="text-slate-700">|</span>
              <span className={lang === 'zh' ? 'text-info' : 'text-slate-600'}>中</span>
            </button>

            <span className="text-xs text-slate-600 tabular-nums">
              {new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
