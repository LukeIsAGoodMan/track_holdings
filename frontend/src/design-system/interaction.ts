/**
 * Design System V2 — Interaction Grammar
 *
 * Compositional interaction-state system with semantic variants.
 * Returns lightweight Tailwind class strings — no heavy dynamic CSS.
 *
 * State priority (highest wins):
 *   disabled > loading > selected > active > hover > idle
 *
 * Variant naming encodes intent (no generic "button" or "row"):
 *   button-primary   — primary CTA buttons
 *   button-ghost     — ghost/text buttons
 *   row-interactive  — clickable table rows (use group-hover for large tables)
 *   card-interactive — clickable cards (opportunities, selections)
 *   nav-item         — sidebar navigation links
 *   tab              — tab bar items
 *
 * Table optimization: For large tables (>50 rows), use group-based hover
 * instead of calling interactiveClasses() per row:
 *   <tr className="group">
 *     <td className="group-hover:bg-v2-surface-hover" />
 *   </tr>
 *
 * Focus-visible: Handled globally in index.css. Never override per-component.
 *
 * Future extensibility: The resolveInteraction() pattern can wrap this
 * when stateful interaction logic is needed (Phase X).
 */

// ── Semantic variant definitions ─────────────────────────────────────────────

export type InteractionVariant =
  | 'button-primary'
  | 'button-ghost'
  | 'row-interactive'
  | 'card-interactive'
  | 'nav-item'
  | 'tab'

export interface InteractionConfig {
  variant: InteractionVariant
  selected?: boolean
  disabled?: boolean
  loading?: boolean
}

const VARIANT_MAP: Record<InteractionVariant, {
  idle: string
  hover: string
  active: string
  selected: string
  disabled: string
}> = {
  'button-primary': {
    idle:     'transition-colors duration-150 cursor-pointer',
    hover:    'hover:bg-v2-accent-hover',
    active:   'active:scale-[0.98] active:opacity-90',
    selected: 'bg-v2-accent text-white',
    disabled: 'opacity-50 cursor-not-allowed',
  },
  'button-ghost': {
    idle:     'transition-colors duration-150 cursor-pointer',
    hover:    'hover:bg-v2-surface-alt hover:text-v2-text-1',
    active:   'active:bg-v2-surface-hover active:scale-[0.98]',
    selected: 'bg-v2-surface-alt text-v2-text-1',
    disabled: 'opacity-50 cursor-not-allowed',
  },
  'row-interactive': {
    idle:     'transition-colors duration-150',
    hover:    'hover:bg-v2-surface-hover',
    active:   '',
    selected: 'bg-v2-accent-soft',
    disabled: 'opacity-50 cursor-not-allowed',
  },
  'card-interactive': {
    idle:     'bg-v2-surface-raised transition-colors duration-150 cursor-pointer',
    hover:    'hover:bg-v2-surface-hover hover:shadow-v2-sm',
    active:   'active:scale-[0.995]',
    selected: 'bg-v2-accent-soft ring-1 ring-v2-accent/20',
    disabled: 'opacity-50 cursor-not-allowed pointer-events-none',
  },
  'nav-item': {
    idle:     'transition-colors duration-150 cursor-pointer',
    hover:    'hover:bg-v2-surface-alt hover:text-v2-text-1',
    active:   '',
    selected: 'bg-v2-accent-soft text-v2-accent',
    disabled: 'opacity-50 cursor-not-allowed',
  },
  'tab': {
    idle:     'transition-colors duration-150 cursor-pointer',
    hover:    'hover:text-v2-text-2',
    active:   '',
    selected: 'text-v2-accent',
    disabled: 'opacity-50 cursor-not-allowed',
  },
}

/**
 * Compose interaction-state classes for a semantic variant.
 *
 * Priority: disabled > loading > selected > idle+hover+active
 *
 * @returns Tailwind class string
 */
export function interactiveClasses(config: InteractionConfig): string {
  const { variant, selected = false, disabled = false, loading = false } = config
  const v = VARIANT_MAP[variant]

  if (disabled) return `${v.idle} ${v.disabled}`
  if (loading)  return `${v.idle} cursor-wait`
  if (selected) return `${v.idle} ${v.selected}`
  return `${v.idle} ${v.hover} ${v.active}`
}

// ── Table-optimized group-hover classes ──────────────────────────────────────
/**
 * For large tables, apply these to <tr className="group"> children
 * instead of calling interactiveClasses() per row.
 */
export const TABLE_ROW_GROUP = 'group transition-colors duration-150' as const
export const TABLE_CELL_HOVER = 'group-hover:bg-v2-surface-hover' as const

// ── Scoped transition constants ─────────────────────────────────────────────
export const TRANSITION_FEEDBACK  = 'transition-colors duration-150' as const
export const TRANSITION_EMPHASIS  = 'transition-opacity duration-150' as const
export const TRANSITION_LAYOUT    = 'transition-[width] duration-200 ease-out' as const
export const TRANSITION_TRANSFORM = 'transition-transform duration-200' as const
