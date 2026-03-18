/**
 * HoldingsActionBar — context-aware execution toolbar.
 *
 * Turns Holdings from an observation dashboard into a command center.
 * Actions: New Trade, Hedge, Alerts, Rebalance hint.
 * Uses SidebarContext to open trade entry / price alerts panels.
 */
import { memo } from 'react'
import { useSidebar } from '@/context/SidebarContext'
import Toolbar from '../primitives/Toolbar'

interface Props {
  isEn: boolean
  hasPositions: boolean
}

export default memo(function HoldingsActionBar({ isEn, hasPositions }: Props) {
  const { openTradeEntry, openPriceAlerts } = useSidebar()

  return (
    <Toolbar
      left={
        <>
          <button
            onClick={() => openTradeEntry()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-v2-sm
                       bg-v2-accent text-white text-[13px] font-medium
                       hover:bg-v2-accent/90 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {isEn ? 'New Trade' : '新建交易'}
          </button>

          {hasPositions && (
            <>
              <button
                onClick={() => openPriceAlerts()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-v2-sm
                           text-v2-text-2 text-[13px] font-medium
                           hover:bg-v2-surface-alt transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {isEn ? 'Alerts' : '警报'}
              </button>

              <button
                onClick={() => openTradeEntry()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-v2-sm
                           text-v2-text-2 text-[13px] font-medium
                           hover:bg-v2-surface-alt transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                {isEn ? 'Hedge' : '对冲'}
              </button>
            </>
          )}
        </>
      }
      right={
        hasPositions ? (
          <span className="text-[11px] text-v2-text-3 font-medium">
            {isEn ? 'Select positions for batch actions' : '选择持仓进行批量操作'}
          </span>
        ) : null
      }
    />
  )
})
