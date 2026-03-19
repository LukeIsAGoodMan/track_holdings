/**
 * ActivityPanel — compact recent-trades widget for the right panel stack.
 *
 * Shows the most recent 5 trades in a mini timeline format.
 * Not a full transaction history — just a quick-glance activity feed.
 */
import { useState, useEffect, memo } from 'react'
import { fetchTransactionHistory } from '@/api/holdings'
import type { Transaction } from '@/types'
import { fmtNum } from '@/utils/format'
import SectionCard from '../primitives/SectionCard'

const ACTION_DOT: Record<string, string> = {
  SELL_OPEN:  'bg-v2-negative',
  BUY_OPEN:   'bg-v2-accent',
  BUY_CLOSE:  'bg-v2-positive',
  SELL_CLOSE: 'bg-v2-caution',
}

interface Props {
  portfolioId: number | null | undefined
  isEn: boolean
}

export default memo(function ActivityPanel({ portfolioId, isEn }: Props) {
  const [trades, setTrades] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (portfolioId == null) { setLoading(false); return }
    setLoading(true)
    fetchTransactionHistory(portfolioId)
      .then(txs => setTrades(txs.slice(0, 5)))
      .catch(() => setTrades([]))
      .finally(() => setLoading(false))
  }, [portfolioId])

  return (
    <SectionCard isLoading={loading} minHeight="120px">
      <SectionCard.Header title={isEn ? 'Recent Activity' : '最近动态'} />
      <SectionCard.Body>
        {trades.length === 0 ? (
          <div className="py-3 text-center">
            <div className="text-ds-sm text-v2-text-3">{isEn ? 'No recent trades' : '暂无交易'}</div>
            <div className="text-ds-sm text-v2-text-3/60 mt-0.5">{isEn ? 'New trades will appear here' : '新交易将显示在此处'}</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {trades.map((tx) => {
              const dotColor = ACTION_DOT[tx.action] ?? 'bg-v2-text-3'
              const isOption = tx.option_type != null
              const timeStr = tx.trade_date
                ? tx.trade_date.slice(5, 16).replace('T', ' ')
                : ''
              return (
                <div key={tx.id} className="flex items-start gap-2.5">
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center pt-1.5">
                    <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                    <span className="w-px flex-1 bg-v2-surface-alt mt-1" />
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-ds-sm text-v2-text-1">{tx.symbol}</span>
                      <span className="text-ds-caption text-v2-text-3">{tx.action.replace('_', ' ')}</span>
                      <span className="text-ds-caption tnum text-v2-text-3 ml-auto shrink-0">{timeStr}</span>
                    </div>
                    <div className="text-ds-sm text-v2-text-3 tnum">
                      {tx.quantity}x @ ${fmtNum(tx.price)}
                      {isOption && tx.option_type && (
                        <span className="ml-1">
                          {tx.option_type} ${fmtNum(tx.strike ?? '0')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard.Body>
    </SectionCard>
  )
})
