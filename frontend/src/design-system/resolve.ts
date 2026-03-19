/**
 * Design System V2 → X — Runtime Resolution Layer
 *
 * Programmable UI engine that wraps existing static systems:
 *   resolveInteraction — stateful interaction class resolution
 *   resolveToken       — dot-path token accessor with caching
 *   resolveMetric      — unified metric formatting + color logic
 *
 * These are backward-compatible wrappers — they delegate to the existing
 * static systems (interaction.ts, tokens.ts, formatMetric.ts).
 *
 * Future evolution:
 *   - theming (light/dark)
 *   - density modes (compact/comfortable)
 *   - A/B variant resolution
 *   - config-driven UI rendering
 */

import { interactiveClasses, TABLE_ROW_GROUP, TABLE_CELL_HOVER } from './interaction'
import type { InteractionVariant } from './interaction'
import { colors, spacing, radius, shadows, layout, zIndex } from './tokens'
import { formatMetric, isPresent } from '@/utils/formatMetric'

// ═══════════════════════════════════════════════════════════════════════════════
// resolveInteraction — stateful class resolution with caching
// ═══════════════════════════════════════════════════════════════════════════════

type InteractionType = 'button' | 'row' | 'card' | 'nav' | 'tab'
type InteractionIntent = 'primary' | 'ghost' | 'neutral'

interface InteractionState {
  selected?: boolean
  disabled?: boolean
  loading?: boolean
}

interface ResolveInteractionConfig {
  type: InteractionType
  intent?: InteractionIntent
  state?: InteractionState
}

/** Maps (type, intent) → InteractionVariant */
const VARIANT_LOOKUP: Record<string, InteractionVariant> = {
  'button:primary':  'button-primary',
  'button:ghost':    'button-ghost',
  'button:neutral':  'button-ghost',
  'row:primary':     'row-interactive',
  'row:ghost':       'row-interactive',
  'row:neutral':     'row-interactive',
  'card:primary':    'card-interactive',
  'card:ghost':      'card-interactive',
  'card:neutral':    'card-interactive',
  'nav:primary':     'nav-item',
  'nav:ghost':       'nav-item',
  'nav:neutral':     'nav-item',
  'tab:primary':     'tab',
  'tab:ghost':       'tab',
  'tab:neutral':     'tab',
}

// Cache for static variant resolution (no state)
const _interactionCache = new Map<string, string>()

export function resolveInteraction(config: ResolveInteractionConfig): string {
  const { type, intent = 'neutral', state = {} } = config
  const variant = VARIANT_LOOKUP[`${type}:${intent}`] ?? 'button-ghost'

  // For stateless resolution, use cache
  const hasState = state.selected || state.disabled || state.loading
  if (!hasState) {
    const key = variant
    const cached = _interactionCache.get(key)
    if (cached) return cached
    const result = interactiveClasses({ variant })
    _interactionCache.set(key, result)
    return result
  }

  return interactiveClasses({
    variant,
    selected: state.selected,
    disabled: state.disabled,
    loading: state.loading,
  })
}

// Table optimization exports (pass-through)
export { TABLE_ROW_GROUP, TABLE_CELL_HOVER }

// ═══════════════════════════════════════════════════════════════════════════════
// resolveToken — dot-path token accessor
// ═══════════════════════════════════════════════════════════════════════════════

const TOKEN_MAP: Record<string, Record<string, string | number>> = {
  color: colors as unknown as Record<string, string>,
  spacing,
  radius,
  shadow: shadows,
  layout: layout as unknown as Record<string, string>,
  zIndex: zIndex as unknown as Record<string, number>,
}

const _tokenCache = new Map<string, string | number | undefined>()

/**
 * Resolve a token by dot-path.
 *
 * Usage:
 *   resolveToken('color.accent')     → '#305faa'
 *   resolveToken('spacing.4')        → '1rem'
 *   resolveToken('radius.lg')        → '1rem'
 *   resolveToken('shadow.card')      → '0px 8px 24px ...'
 *
 * Returns undefined if path not found.
 * Results are cached.
 */
export function resolveToken(path: string): string | number | undefined {
  const cached = _tokenCache.get(path)
  if (cached !== undefined) return cached

  const [domain, key] = path.split('.', 2)
  const group = TOKEN_MAP[domain]
  if (!group || !key) return undefined

  const value = group[key]
  _tokenCache.set(path, value)
  return value
}

// ═══════════════════════════════════════════════════════════════════════════════
// resolveMetric — unified metric + color resolution
// ═══════════════════════════════════════════════════════════════════════════════

type MetricType = 'currency' | 'percent' | 'number' | 'greek'
type Highlight = 'positive' | 'negative' | 'neutral'

interface ResolveMetricConfig {
  value: string | number | null | undefined
  type: MetricType
  precision?: number
  showSign?: boolean
  highlight?: Highlight
}

interface ResolvedMetric {
  /** Formatted text string (e.g. "$1,234.50") */
  text: string
  /** Tailwind class string: tnum + color */
  className: string
}

const HIGHLIGHT_CLASSES: Record<Highlight, string> = {
  positive: 'tnum text-v2-positive',
  negative: 'tnum text-v2-negative',
  neutral:  'tnum text-v2-text-1',
}

/**
 * Resolve a metric value into formatted text + Tailwind classes.
 *
 * Usage:
 *   const { text, className } = resolveMetric({
 *     value: 1234.5,
 *     type: 'currency',
 *     highlight: 'positive',
 *   })
 *   → { text: '$1,234.50', className: 'tnum text-v2-positive' }
 */
export function resolveMetric(config: ResolveMetricConfig): ResolvedMetric {
  const { value, type, precision, showSign, highlight = 'neutral' } = config

  const text = formatMetric(value, { type, precision, showSign })
  const className = HIGHLIGHT_CLASSES[highlight]

  return { text, className }
}

// Re-export isPresent for convenience
export { isPresent }
