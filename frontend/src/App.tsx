import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PortfolioProvider } from '@/context/PortfolioContext'
import { LanguageProvider }  from '@/context/LanguageContext'
import Layout from '@/components/layout/Layout'
import HoldingsPage   from '@/pages/Holdings/HoldingsPage'
import TradeEntryPage from '@/pages/TradeEntry/TradeEntryPage'
import RiskPage        from '@/pages/Risk/RiskPage'

export default function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <PortfolioProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index        element={<HoldingsPage />}   />
              <Route path="trade" element={<TradeEntryPage />} />
              <Route path="risk"  element={<RiskPage />}       />
            </Route>
          </Routes>
        </PortfolioProvider>
      </LanguageProvider>
    </BrowserRouter>
  )
}
