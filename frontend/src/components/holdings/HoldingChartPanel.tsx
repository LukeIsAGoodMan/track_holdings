/**
 * HoldingChartPanel — right-side slide-over for quick holding inspection.
 *
 * 1D: Intraday candle-style chart (high-low range + open-close body via custom Bar shapes)
 * 5D / 1M: Line chart from EOD close prices
 *
 * Auto-refreshes every 5 min while open (handled by useHoldingChartPanel hook).
 */
import { useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { useLanguage } from '@/context/LanguageContext'
import type { IntradayBar, EodLightBar } from '@/types'
import type { ChartView, ChartStatus } from './useHoldingChartPanel'

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  symbol: string | null
  view: ChartView
  onClose: () => void
  onViewChange: (v: ChartView) => void
  intraday5min: IntradayBar[]
  eodLight: EodLightBar[]
  status: ChartStatus
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtTime(dateStr: string): string {
  // "2026-03-27 09:35:00" → "09:35"
  const timePart = dateStr.split(' ')[1]
  return timePart ? timePart.slice(0, 5) : dateStr
}

function fmtDate(dateStr: string): string {
  // "2026-03-27" → "Mar 27"
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(parts[1]) - 1] ?? ''} ${parseInt(parts[2])}`
}

const VIEW_LABELS: Record<ChartView, { en: string; zh: string }> = {
  '1D': { en: '1D', zh: '1日' },
  '5D': { en: '5D', zh: '5日' },
  '1M': { en: '1M', zh: '1月' },
}

// ── OHLC candle shape for Recharts Bar ───────────────────────────────────────

interface CandleDatum {
  time: string
  open: number
  high: number
  low: number
  close: number
  // Bar uses [low, high] range; body is drawn as custom shape
  range: [number, number]
  bullish: boolean
}

function CandleShape(props: Record<string, unknown>) {
  const x      = Number(props.x ?? 0)
  const y      = Number(props.y ?? 0)
  const width  = Number(props.width ?? 0)
  const height = Number(props.height ?? 0)
  const payload = props.payload as CandleDatum | undefined
  if (!payload || width <= 0) return null

  const { open, close, bullish } = payload
  const yScale = props as Record<string, unknown>

  // high/low wick is the full bar rect
  const wickX = x + width / 2
  const wickColor = bullish ? '#4a9a6b' : '#c05c56'

  // Body: compute from open/close relative to high/low range
  const high = payload.high
  const low  = payload.low
  const totalRange = high - low
  if (totalRange <= 0) return (
    <line x1={wickX} y1={y} x2={wickX} y2={y + height} stroke={wickColor} strokeWidth={1} />
  )

  const bodyTop    = Math.max(open, close)
  const bodyBottom = Math.min(open, close)
  const bodyY      = y + ((high - bodyTop) / totalRange) * height
  const bodyH      = Math.max(1, ((bodyTop - bodyBottom) / totalRange) * height)
  const bodyW      = Math.max(2, width * 0.6)
  const bodyX      = x + (width - bodyW) / 2

  return (
    <g>
      {/* Wick (high-low line) */}
      <line x1={wickX} y1={y} x2={wickX} y2={y + height} stroke={wickColor} strokeWidth={1} />
      {/* Body (open-close rect) */}
      <rect
        x={bodyX} y={bodyY} width={bodyW} height={bodyH}
        fill={bullish ? '#4a9a6b' : '#c05c56'}
        rx={1}
      />
    </g>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function ChartTooltipContent({ active, payload, label }: {
  active?: boolean; payload?: Array<{ payload: Record<string, unknown> }>; label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload

  const hasOHLC = d.open != null && d.high != null
  return (
    <div className="rounded-v2-md px-3 py-2 tnum text-xs" style={{ backgroundColor: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="text-stone-400 mb-1" style={{ fontSize: '10px' }}>{label}</div>
      {hasOHLC ? (
        <div className="space-y-0.5">
          <div>O <span className="text-stone-800 font-medium">{fmtPrice(d.open as number)}</span></div>
          <div>H <span className="text-stone-800 font-medium">{fmtPrice(d.high as number)}</span></div>
          <div>L <span className="text-stone-800 font-medium">{fmtPrice(d.low as number)}</span></div>
          <div>C <span className="text-stone-800 font-medium">{fmtPrice(d.close as number)}</span></div>
        </div>
      ) : (
        <div className="text-stone-800 font-medium">{fmtPrice(d.close as number)}</div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function HoldingChartPanel({
  open, symbol, view, onClose, onViewChange,
  intraday5min, eodLight, status,
}: Props) {
  const { lang, t } = useLanguage()
  const isEn = lang !== 'zh'

  // 1D candle data
  const candleData = useMemo<CandleDatum[]>(() => {
    if (view !== '1D') return []
    return intraday5min
      .filter(b => b.open != null && b.high != null && b.low != null && b.close != null)
      .map(b => ({
        time: fmtTime(b.date),
        open: b.open!, high: b.high!, low: b.low!, close: b.close!,
        range: [b.low!, b.high!] as [number, number],
        bullish: b.close! >= b.open!,
      }))
  }, [intraday5min, view])

  // 5D / 1M line data from eod_light
  const lineData = useMemo(() => {
    if (view === '1D') return []
    const days = view === '5D' ? 5 : 31
    const slice = eodLight.slice(-days)
    return slice.map(b => ({
      time: fmtDate(b.date),
      close: b.close,
    }))
  }, [eodLight, view])

  const hasData = view === '1D' ? candleData.length > 0 : lineData.length > 0

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[59]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-[60] bg-white border-l border-stone-200 shadow-lg flex flex-col"
        style={{ width: 'min(480px, 90vw)', transition: 'transform 200ms ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="text-base font-semibold text-stone-800">{symbol ?? ''}</div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 cursor-pointer p-1"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-1 px-5 py-3">
          {(['1D', '5D', '1M'] as ChartView[]).map(v => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`px-3 py-1 rounded-v2-md text-xs font-medium cursor-pointer ${
                view === v
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
              }`}
              style={{ transition: 'background-color 150ms ease-out, color 150ms ease-out' }}
            >
              {VIEW_LABELS[v]?.[isEn ? 'en' : 'zh'] ?? v}
            </button>
          ))}
        </div>

        {/* Chart area */}
        <div className="flex-1 px-4 pb-4 min-h-0">
          {status === 'loading' && (
            <div className="h-64 bg-stone-50 rounded-v2-lg ds-shimmer" />
          )}

          {status === 'error' && (
            <div className="h-64 flex items-center justify-center text-stone-400 text-xs">
              {t('no_chart_data')}
            </div>
          )}

          {status === 'ready' && !hasData && (
            <div className="h-64 flex items-center justify-center text-stone-400 text-xs">
              {t('no_chart_data')}
            </div>
          )}

          {status === 'ready' && hasData && view === '1D' && (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={candleData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false} axisLine={false}
                  interval={Math.max(0, Math.floor(candleData.length / 8))}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false} axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false}>
                  {candleData.map((d, i) => (
                    <Cell key={i} fill={d.bullish ? '#4a9a6b' : '#c05c56'} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          )}

          {status === 'ready' && hasData && view !== '1D' && (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false} axisLine={false}
                  interval={Math.max(0, Math.floor(lineData.length / 6))}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: '#a8a29e', fontSize: 9 }}
                  tickLine={false} axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="#4a9a6b"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: '#4a9a6b', strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer meta */}
        <div className="px-5 py-2 border-t border-stone-100 text-[10px] text-stone-400">
          {isEn ? 'Auto-refreshes every 5 min while open' : '面板打开时每5分钟自动刷新'}
        </div>
      </div>
    </>
  )
}
