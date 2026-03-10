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
import LoginPage    from '@/pages/Login/LoginPage'
import HoldingsPage from '@/pages/Holdings/HoldingsPage'
import RiskPage     from '@/pages/Risk/RiskPage'
import ScannerPage  from '@/pages/Scanner/ScannerPage'

export default function App() {
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
                      <Layout />
                    </SidebarProvider>
                  </WebSocketProvider>
                </PortfolioProvider>
              }>
                {/* / → /holdings/overview */}
                <Route index element={<Navigate to="/holdings/overview" replace />} />

                {/* Holdings — parent route keeps HoldingsPage mounted across tab switches */}
                <Route path="holdings" element={<HoldingsPage />}>
                  <Route index                element={<Navigate to="overview" replace />} />
                  <Route path="overview" />
                  <Route path="details" />
                  <Route path="records" />
                </Route>

                <Route path="risk"          element={<RiskPage />}     />
                <Route path="opportunities" element={<ScannerPage />}  />
              </Route>
            </Route>
          </Routes>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
