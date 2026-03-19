/**
 * Design System V2 — Type Definitions
 *
 * Strongly typed token keys and theme structure.
 * All primitives MUST consume these types, not arbitrary strings.
 *
 * Domain ownership:
 *   colors, spacing, radius, shadows, layout, zIndex → tokens.ts
 *   typography                                       → typography.ts
 *   motion                                           → motion.ts
 */

import type { colors, spacing, radius, shadows, layout, zIndex } from './tokens'
import type { typographyScale } from './typography'
import type { duration } from './motion'

// ── Theme aggregate type ─────────────────────────────────────────────────────

export type ThemeTokens = {
  colors:     typeof colors
  spacing:    typeof spacing
  radius:     typeof radius
  shadows:    typeof shadows
  typography: typeof typographyScale
  layout:     typeof layout
  motion:     typeof duration
  zIndex:     typeof zIndex
}

// ── Semantic key unions ──────────────────────────────────────────────────────

/** Surface hierarchy levels */
export type SurfaceLevel = 'canvas' | 'raised' | 'subtle' | 'muted' | 'warm' | 'warmAlt'

/** Text emphasis levels */
export type TextLevel = 'primary' | 'secondary' | 'muted' | 'inverse'

/** Financial sentiment */
export type Sentiment = 'positive' | 'negative' | 'neutral'

/** Semantic status colors */
export type SemanticStatus = 'success' | 'error' | 'warning'

/** Action color variants */
export type ActionVariant = 'primary' | 'primaryHover' | 'disabled'

/** Shadow elevation levels */
export type ElevationLevel = 'none' | 'card' | 'subtle' | 'elevated'

/** Radius scale keys */
export type RadiusScale = 'sm' | 'md' | 'lg' | 'full'

/** Spacing scale keys */
export type SpacingScale = keyof typeof spacing

/** Typography scale keys */
export type TypographyScale = keyof typeof typographyScale

/** Motion speed keys */
export type MotionSpeed = 'fast' | 'default' | 'slow'

/** Button variant types */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'

/** Button size types */
export type ButtonSize = 'sm' | 'md' | 'lg'

/** Badge variant types */
export type BadgeVariant = 'blue' | 'yellow' | 'neutral'

/** Metric display size */
export type MetricSize = 'sm' | 'md' | 'lg' | 'display'

/** Card surface variant */
export type CardVariant = 'default' | 'warm' | 'flat'
