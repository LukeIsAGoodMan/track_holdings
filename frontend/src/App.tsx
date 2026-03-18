import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider }      from '@/context/AuthContext'
import { PortfolioProvider } from '@/context/PortfolioContext'
import { LanguageProvider }  from '@/context/LanguageContext'
import { WebSocketProvider } from '@/context/WebSocketContext'
import { SidebarProvider }   from '@/context/SidebarContext'
import ProtectedRoute from '@/components/common/ProtectedRoute'
import AlertToastListener from '@/components/AlertToastListener'
import Layout from '@/components/layout/Layout'
import AppShellV2 from '@/design-system/shell/AppShellV2'
import LoginPage    from '@/pages/Login/LoginPage'
import HoldingsPage   from '@/pages/Holdings/HoldingsPage'
import HoldingsPageV2 from '@/pages/Holdings/HoldingsPageV2'
import RiskPage       from '@/pages/Risk/RiskPage'
import ScannerPage    from '@/pages/Scanner/ScannerPage'
import AnalysisPage   from '@/pages/Analysis/AnalysisPage'

/**
 * Design version flag — A/B toggle for V1 vs V2 shell.
 *
 * Set to 'v2' to activate the new design system shell.
 * V1 remains intact for easy rollback.
 *
 * Read from localStorage to allow per-user toggling:
 *   localStorage.setItem('th_design', 'v2')
 *   localStorage.setItem('th_design', 'v1')
 */
function useDesignVersion(): 'v1' | 'v2' {
  try {
    const stored = localStorage.getItem('th_design')
    if (stored === 'v2') return 'v2'
  } catch { /* SSR or blocked storage */ }
  return 'v1'
}

/** Shared page routes — V2 swaps HoldingsPage for HoldingsPageV2 */
function PageRoutes({ designVersion }: { designVersion: 'v1' | 'v2' }) {
  const Holdings = designVersion === 'v2' ? HoldingsPageV2 : HoldingsPage
  return (
    <>
      <Route index element={<Navigate to="/holdings/overview" replace />} />
      <Route path="holdings" element={<Holdings />}>
        <Route index          element={<Navigate to="overview" replace />} />
        <Route path="overview" />
        <Route path="details" />
        <Route path="records" />
      </Route>
      <Route path="risk"          element={<RiskPage />}     />
      <Route path="opportunities" element={<ScannerPage />}  />
      <Route path="analysis"      element={<AnalysisPage />} />
    </>
  )
}

export default function App() {
  const designVersion = useDesignVersion()

  const ShellLayout = designVersion === 'v2' ? AppShellV2 : Layout

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 6000,
          style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
        }}
      />
      <AuthProvider>
        <LanguageProvider>
          <Routes>
            {/* Public route */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={
                <PortfolioProvider>
                  <WebSocketProvider>
                    <SidebarProvider>
                      <AlertToastListener />
                      <ShellLayout />
                    </SidebarProvider>
                  </WebSocketProvider>
                </PortfolioProvider>
              }>
                {PageRoutes({ designVersion })}
              </Route>
            </Route>
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
