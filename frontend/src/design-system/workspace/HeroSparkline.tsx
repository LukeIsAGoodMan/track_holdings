/**
 * HeroSparkline — Minimal inline sparkline for portfolio value.
 *
 * Pure signal line: no axes, no labels, no grid, no container.
 * Height ~24px, stroke ~1.5px.
 * Color: low-saturation green (positive) or red (negative).
 * Last point visually anchors to the current portfolio value.
 *
 * Fetches 7-day portfolio history for a compact trend signal.
 * Renders as a pure SVG polyline.
 */
import { useState, useEffect, memo, useMemo } from 'react'
import { fetchPortfolioHistory } from '@/api/holdings'

interface Props {
  portfolioId: number | null | undefined
  sentiment: 'positive' | 'negative' | 'neutral'
  className?: string
}

/** Subdued, elegant colors — NOT retail chart loud */
const STROKE_COLORS = {
  positive: '#4a9a6b',   // muted sage green
  negative: '#c05c56',   // muted terracotta red
  neutral:  '#94908d',   // text-3 grey
} as const

export default memo(function HeroSparkline({ portfolioId, sentiment, className = '' }: Props) {
  const [points, setPoints] = useState<number[]>([])

  useEffect(() => {
    if (portfolioId == null) return
    fetchPortfolioHistory(portfolioId, 7)
      .then(res => {
        const vals = res.series.map(p => parseFloat(p.pnl)).filter(n => isFinite(n))
        setPoints(vals)
      })
      .catch(() => setPoints([]))
  }, [portfolioId])

  const pathD = useMemo(() => {
    if (points.length < 2) return ''
    const min = Math.min(...points)
    const max = Math.max(...points)
    const range = max - min || 1

    const width = 96
    const height = 24
    const yPad = 2

    return points.map((v, i) => {
      const x = (i / (points.length - 1)) * width
      const y = yPad + (1 - (v - min) / range) * (height - 2 * yPad)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [points])

  if (points.length < 2) return null

  const stroke = STROKE_COLORS[sentiment]

  return (
    <svg
      className={`shrink-0 ${className}`}
      width="96"
      height="24"
      viewBox="0 0 96 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={pathD}
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Terminal dot — anchors to current value */}
      <circle
        cx={(96).toString()}
        cy={pathD.split(' ').pop()?.split(',')[1]?.replace(/[^0-9.]/g, '') ?? '12'}
        r="2"
        fill={stroke}
      />
    </svg>
  )
})
