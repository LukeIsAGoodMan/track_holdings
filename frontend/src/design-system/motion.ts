/**
 * Design System V2 — Motion Tokens
 *
 * Source of truth: Figma extraction + existing system (values aligned)
 * Philosophy: functional transitions, no decorative animation
 *
 * Duration tiers:
 *   fast    — hover bg, opacity, color changes (feedback)
 *   default — card transitions, slide-in, sidebar collapse (layout)
 *   slow    — modal open/close, page transitions (emphasis)
 *
 * Motion categories:
 *   feedback — interaction responses (hover, press, focus)
 *   layout   — structural changes (sidebar collapse, panel resize)
 *   emphasis — attention-drawing changes (modal open, error flash)
 *
 * Rules:
 *   1. Never animate numeric metric values
 *   2. Tables: hover/selection feedback only, no spatial movement
 *   3. Charts may resize smoothly but must not "jump"
 *   4. Replace transition-all with scoped transitions
 *   5. Feedback transitions must be subtle and fast
 *   6. Layout transitions must be stable, no width thrash
 */

export const duration = {
  fast:    '150ms',
  default: '200ms',
  slow:    '300ms',
} as const

export const easing = {
  /** Standard material easing — most transitions */
  standard:    'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Decelerate — elements entering the screen */
  decelerate:  'cubic-bezier(0.0, 0, 0.2, 1)',
  /** Accelerate — elements leaving the screen */
  accelerate:  'cubic-bezier(0.4, 0, 1, 1)',
} as const

export const skeleton = {
  duration: '1.5s',
  timing:   'ease-in-out',
  iteration: 'infinite',
} as const

/**
 * Transition shorthand builder.
 * Usage: transition('background-color', 'fast') → 'background-color 150ms cubic-bezier(...)'
 */
export function transition(
  property: string,
  speed: keyof typeof duration = 'default',
): string {
  return `${property} ${duration[speed]} ${easing.standard}`
}

/**
 * Scoped Tailwind transition class strings by category.
 * Use these instead of transition-all.
 */
export const motionClass = {
  /** Hover/press/focus feedback — color changes only */
  feedback: 'transition-colors duration-150',
  /** Layout changes — width/flex transitions */
  layout:   'transition-[width] duration-200 ease-out',
  /** Emphasis — opacity for attention */
  emphasis: 'transition-opacity duration-150',
  /** Transform — icon rotations, arrow flips */
  transform: 'transition-transform duration-200',
} as const

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)' as const

export type DurationKey = keyof typeof duration
export type EasingKey = keyof typeof easing
export type MotionCategory = keyof typeof motionClass
