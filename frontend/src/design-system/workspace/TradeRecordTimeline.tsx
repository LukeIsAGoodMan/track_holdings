/**
 * TradeRecordTimeline — chronological trade history + settled trades.
 *
 * Records tab content for HoldingsPageV2.
 * Combines transaction history and settled trades into a single audit view.
 * Zero new data hooks — uses existing fetchTransactionHistory + fetchSettledTrades.
 */
import { useState, useEffect, useMemo, memo } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { fetchTransactionHistory, fetchSettledTrades } from '@/api/holdings'
import type { Transaction, SettledTrade } from '@/types'
import { fmtUSD, fmtNum } from '@/utils/format'
import SectionCard from '../primitives/SectionCard'
import EmptyState from '../primitives/EmptyState'

// ── Action badge colors ─────────────────────────────────────────────────────
const ACTION_COLORS: Record<string, string> = {
  SELL_OPEN:  'bg-v2-negative-bg text-v2-negative',
  BUY_OPEN:   'bg-v2-accent-soft text-v2-accent',
  BUY_CLOSE:  'bg-v2-positive-bg text-v2-positive',
  SELL_CLOSE: 'bg-v2-caution-bg text-v2-caution',
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:   'text-v2-positive',
  EXPIRED:  'text-v2-text-3',
  ASSIGNED: 'text-v2-caution',
  CLOSED:   'text-v2-text-2',
}

// ── Sort helpers ────────────────────────────────────────────────────────────
type SortField = 'date' | 'symbol' | 'action' | 'price'
type SortDir = 'asc' | 'desc'

interface Props {
  portfolioId: number | null | undefined
  isFolder: boolean
}

export default memo(function TradeRecordTimeline({ portfolioId, isFolder }: Props) {
  const { lang } = useLanguage()
  const isEn = lang !== 'zh'

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [settled, setSettled]           = useState<SettledTrade[]>([])
  const [loading, setLoading]           = useState(true)
  const [field, setField]               = useState<SortField>('date')
  const [dir, setDir]                   = useState<SortDir>('desc')
  const [showSettled, setShowSettled]    = useState(false)

  // Fetch on mount
  useEffect(() => {
    if (portfolioId == null) return
    setLoading(true)
    Promise.all([
      fetchTransactionHistory(portfolioId),
      fetchSettledTrades(portfolioId).then(r => r.trades).catch(() => []),
    ])
      .then(([txs, stl]) => { setTransactions(txs); setSettled(stl) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portfolioId])

  // Sort transactions
  const sorted = useMemo(() => {
    const arr = [...transactions]
    arr.sort((a, b) => {
      let cmp = 0
      if (field === 'date')   cmp = a.trade_date.localeCompare(b.trade_date)
      if (field === 'symbol') cmp = a.symbol.localeCompare(b.symbol)
      if (field === 'action') cmp = a.action.localeCompare(b.action)
      if (field === 'price')  cmp = parseFloat(a.price) - parseFloat(b.price)
      return dir === 'desc' ? -cmp : cmp
    })
    return arr
  }, [transactions, field, dir])

  function toggleSort(f: SortField) {
    if (field === f) setDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setField(f); setDir('desc') }
  }

  const SortArrow = ({ f }: { f: SortField }) => (
    <span className="ml-0.5 text-ds-caption text-v2-text-3">
      {field === f ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  if (loading) {
    return (
      <div className="space-y-5">
        {/* Table header skeleton */}
        <div className="bg-v2-surface rounded-v2-lg shadow-v2-sm overflow-hidden animate-pulse">
          <div className="h-10 border-b border-v2-border bg-v2-surface-alt" />
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-v2-border last:border-0">
              <div className="h-3 w-16 bg-v2-surface-alt rounded" />
              <div className="h-3 w-12 bg-v2-surface-alt rounded" />
              <div className="h-3 w-20 bg-v2-surface-alt rounded" />
              <div className="h-3 w-14 bg-v2-surface-alt rounded ml-auto" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Transaction History ────────────────────────────────────── */}
      <SectionCard noPadding>
        <div className="px-5 py-3 border-b border-v2-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-ds-h3 font-bold text-v2-text-1">
              {isEn ? 'Transaction History' : '交易记录'}
            </h3>
            {transactions.length > 0 && (
              <span className="text-ds-caption px-1.5 py-0.5 rounded-full bg-v2-surface-alt text-v2-text-3 font-bold">
                {transactions.length}
              </span>
            )}
            {isFolder && (
              <span className="text-ds-caption px-1.5 py-0.5 rounded-md font-bold bg-v2-accent-soft text-v2-accent">
                {isEn ? 'Aggregated' : '合并视图'}
              </span>
            )}
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            message={isEn ? 'No transactions found' : '暂无交易记录'}
            hint={isEn ? 'Trades will appear here after you execute them' : '执行交易后将显示在此处'}
            className="py-10"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-v2-border">
                  <th className="th-left">
                    <button onClick={() => toggleSort('date')} className="flex items-center text-ds-caption uppercase text-v2-text-3 font-bold pl-4 py-2 hover:text-v2-text-1">
                      {isEn ? 'Date' : '日期'}<SortArrow f="date" />
                    </button>
                  </th>
                  {isFolder && <th className="th text-ds-caption">{isEn ? 'Portfolio' : '组合'}</th>}
                  <th className="th">
                    <button onClick={() => toggleSort('symbol')} className="flex items-center text-ds-caption uppercase text-v2-text-3 font-bold hover:text-v2-text-1">
                      {isEn ? 'Symbol' : '标的'}<SortArrow f="symbol" />
                    </button>
                  </th>
                  <th className="th">
                    <button onClick={() => toggleSort('action')} className="flex items-center text-ds-caption uppercase text-v2-text-3 font-bold hover:text-v2-text-1">
                      {isEn ? 'Action' : '操作'}<SortArrow f="action" />
                    </button>
                  </th>
                  <th className="th text-ds-caption">{isEn ? 'Qty' : '数量'}</th>
                  <th className="th">
                    <button onClick={() => toggleSort('price')} className="flex items-center text-ds-caption uppercase text-v2-text-3 font-bold hover:text-v2-text-1">
                      {isEn ? 'Price' : '价格'}<SortArrow f="price" />
                    </button>
                  </th>
                  <th className="th text-ds-caption">{isEn ? 'Contract' : '合约'}</th>
                  <th className="th text-ds-caption">{isEn ? 'Status' : '状态'}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((tx) => {
                  const isOption = tx.option_type != null
                  const contractLabel = isOption
                    ? `${tx.option_type} $${fmtNum(tx.strike ?? '0')} ${tx.expiry ?? ''}`
                    : 'STOCK'
                  return (
                    <tr key={tx.id} className="border-b border-v2-border hover:bg-v2-surface-hover transition-colors">
                      <td className="td-left pl-4 text-v2-text-2 whitespace-nowrap tnum text-ds-sm">
                        {tx.trade_date ? tx.trade_date.slice(0, 16).replace('T', ' ') : '—'}
                      </td>
                      {isFolder && (
                        <td className="td text-ds-sm text-v2-text-2 max-w-[100px]">
                          <span className="truncate block" title={tx.portfolio_name}>{tx.portfolio_name}</span>
                        </td>
                      )}
                      <td className="td font-bold text-v2-text-1">{tx.symbol}</td>
                      <td className="td">
                        <span className={`px-1.5 py-0.5 rounded-md text-ds-caption font-bold ${ACTION_COLORS[tx.action] ?? 'bg-v2-surface-alt text-v2-text-3'}`}>
                          {tx.action}
                        </span>
                      </td>
                      <td className="td tnum text-v2-text-1">{tx.quantity}</td>
                      <td className="td tnum text-v2-text-1">${fmtNum(tx.price)}</td>
                      <td className="td text-v2-text-2 text-ds-sm max-w-[140px]">
                        <span className="truncate block" title={contractLabel}>{contractLabel}</span>
                      </td>
                      <td className="td">
                        <span className={`text-ds-caption font-bold ${STATUS_COLORS[tx.status] ?? 'text-v2-text-3'}`}>
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Settled Trades (Lifecycle) ────────────────────────────── */}
      {settled.length > 0 && (
        <SectionCard noPadding>
          <button
            onClick={() => setShowSettled(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-v2-surface-hover transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-ds-h3 font-bold text-v2-text-1">
                {isEn ? 'Settled Positions' : '已结算持仓'}
              </h3>
              <span className="text-ds-caption px-1.5 py-0.5 rounded-full bg-v2-surface-alt text-v2-text-3 font-bold">
                {settled.length}
              </span>
            </div>
            <span className={`text-v2-text-3 text-xs transition-transform duration-150 ${showSettled ? 'rotate-90' : ''}`}>▶</span>
          </button>

          {showSettled && (
            <div className="overflow-x-auto border-t border-v2-border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-v2-border">
                    <th className="th-left text-ds-caption pl-4">{isEn ? 'Symbol' : '标的'}</th>
                    <th className="th text-ds-caption">{isEn ? 'Action' : '操作'}</th>
                    <th className="th text-ds-caption">{isEn ? 'Qty' : '数量'}</th>
                    <th className="th text-ds-caption">{isEn ? 'Status' : '状态'}</th>
                    <th className="th text-ds-caption">{isEn ? 'Contract' : '合约'}</th>
                    <th className="th text-ds-caption">{isEn ? 'Eff. Cost' : '有效成本'}</th>
                    <th className="th text-ds-caption">{isEn ? 'Settled' : '结算日'}</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((row) => {
                    const contract = row.option_type
                      ? `${row.option_type} $${fmtNum(row.strike ?? '0')} ${row.expiry ?? ''}`
                      : 'STOCK'
                    return (
                      <tr key={row.trade_event_id} className="border-b border-v2-border hover:bg-v2-surface-hover transition-colors">
                        <td className="td-left pl-4 font-bold text-v2-text-1">{row.symbol}</td>
                        <td className="td">
                          <span className={`px-1.5 py-0.5 rounded-md text-ds-caption font-bold ${ACTION_COLORS[row.action] ?? 'bg-v2-surface-alt text-v2-text-3'}`}>
                            {row.action}
                          </span>
                        </td>
                        <td className="td tnum text-v2-text-1">{row.quantity}</td>
                        <td className="td">
                          <span className={`text-ds-caption font-bold ${STATUS_COLORS[row.status] ?? 'text-v2-text-3'}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="td text-v2-text-2 text-ds-sm">{contract}</td>
                        <td className="td tnum">
                          {row.effective_cost_per_share != null
                            ? <span className="font-bold text-v2-text-1">${fmtNum(row.effective_cost_per_share)}</span>
                            : <span className="text-v2-text-3">—</span>}
                        </td>
                        <td className="td text-v2-text-2 text-ds-sm">{row.settled_date ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
})
