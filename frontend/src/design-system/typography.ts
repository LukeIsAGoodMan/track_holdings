/**
 * Design System V2 — Typography Scale
 *
 * Source of truth: Figma extraction (Wealthsimple dashboard, 2026-03-19)
 * Font: Inter — humanist sans-serif, optimized for UI + tabular data
 * Weights: 400 (Regular), 700 (Bold) — NO 500/600 (Principle 7)
 *
 * Normalization log:
 *   28.6-29.4px → 28px (display)
 *   23.6px → 24px (h1)
 *   16.6-16.9px → 17px (h2)
 *   14.9-15.5px → 15px (h3)
 *   12.7-13.9px → 14px (body — high frequency cluster)
 *   11.1-11.8px → 12px (small)
 *   9.8-10.5px → 10px (caption)
 */

export const fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" as const

export const fontWeight = {
  regular: 400,
  bold:    700,
} as const

/**
 * Full typography scale.
 * Every entry includes fontSize, fontWeight, lineHeight, and letterSpacing.
 * Numeric values use fontFeatureSettings: '"tnum"' for tabular alignment.
 */
export const typographyScale = {
  /** Portfolio balance, hero numbers — largest, tightest */
  display: {
    fontSize:      '1.75rem',     // 28px
    fontWeight:    700,
    lineHeight:    '2.25rem',     // 36px
    letterSpacing: '-0.02em',
    fontFeatureSettings: '"tnum"',
  },

  /** Large section numbers, secondary hero values */
  h1: {
    fontSize:      '1.5rem',      // 24px
    fontWeight:    700,
    lineHeight:    '2rem',        // 32px
    letterSpacing: '-0.01em',
    fontFeatureSettings: '"tnum"',
  },

  /** Carousel headings, section titles */
  h2: {
    fontSize:      '1.0625rem',   // 17px
    fontWeight:    700,
    lineHeight:    '1.625rem',    // 26px
    letterSpacing: '-0.01em',
  },

  /** Tab labels, section headers */
  h3: {
    fontSize:      '0.9375rem',   // 15px
    fontWeight:    700,
    lineHeight:    '1.375rem',    // 22px
    letterSpacing: '0.001em',
  },

  /** Primary labels, prices, nav items — bold by default */
  body: {
    fontSize:      '0.875rem',    // 14px
    fontWeight:    700,
    lineHeight:    '1.25rem',     // 20px
    letterSpacing: '0.01em',
    fontFeatureSettings: '"tnum"',
  },

  /** Descriptive text, secondary content — regular weight */
  bodyRegular: {
    fontSize:      '0.875rem',    // 14px
    fontWeight:    400,
    lineHeight:    '1.25rem',     // 20px
    letterSpacing: '0.01em',
  },

  /** Subtitles, change percentages, secondary info */
  small: {
    fontSize:      '0.75rem',     // 12px
    fontWeight:    400,
    lineHeight:    '1rem',        // 16px
    letterSpacing: '0.015em',
  },

  /** Badges, pills, tiny labels */
  caption: {
    fontSize:      '0.625rem',    // 10px
    fontWeight:    700,
    lineHeight:    '0.875rem',    // 14px
    letterSpacing: '0.02em',
  },
} as const

export type TypographyScaleKey = keyof typeof typographyScale
