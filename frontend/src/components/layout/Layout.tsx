/**
 * Layout — app shell: sticky TopNav + fixed Sidebar + scrollable dark main area.
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  TopNav (white, h-14, sticky)                        │
 * ├──────────┬───────────────────────────────────────────┤
 * │ Sidebar  │  main (dark bg-app, scrollable)           │
 * │ (white,  │    <Outlet />                             │
 * │  w-60)   │                                           │
 * └──────────┴───────────────────────────────────────────┘
 */
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopNav from './TopNav'

export default function Layout() {
  return (
    <div className="flex flex-col min-h-screen bg-app">
      {/* ── Top navigation bar ──────────────────────────────────────────── */}
      <TopNav />

      {/* ── Content row ─────────────────────────────────────────────────── */}
      <div className="flex flex-1">
        {/* Light chrome sidebar */}
        <Sidebar />

        {/* Dark main content area */}
        <main className="flex-1 min-w-0 bg-app">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
