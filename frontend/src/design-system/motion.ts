/**
 * Design System V2 — Motion Tokens
 *
 * Source of truth: Figma extraction + existing system (values aligned)
 * Philosophy: functional transitions, no decorative animation
 *
 * Duration tiers:
 *   fast    — hover bg, opacity, color changes
 *   default — card transitions, slide-in, sidebar collapse
 *   slow    — modal open/close, page transitions
 */

export const duration = {
  fast:    '150ms',
  default: '200ms',
  slow:    '300ms',
} as const

export const easing = {
  /** Standard material easing — use for most transitions */
  standard:    'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Decelerate — use for elements entering the screen */
  decelerate:  'cubic-bezier(0.0, 0, 0.2, 1)',
  /** Accelerate — use for elements leaving the screen */
  accelerate:  'cubic-bezier(0.4, 0, 1, 1)',
} as const

export const skeleton = {
  /** Shimmer animation duration */
  duration: '1.5s',
  /** Shimmer animation timing */
  timing:   'ease-in-out',
  /** Shimmer animation iteration */
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
 * Reduced motion media query value.
 * Components should check this and disable transitions.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)' as const

export type DurationKey = keyof typeof duration
export type EasingKey = keyof typeof easing
