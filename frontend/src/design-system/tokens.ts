/**
 * Design System V2 — Centralized Design Tokens
 *
 * Philosophy: Mercury (structure) + Apple (typography) + Wealthsimple (focus)
 *
 * All tokens are exported as typed constants. Tailwind classes reference these
 * via the extended config; components use them directly when needed.
 *
 * RULE: No ad-hoc colors, spacing, or typography outside this file.
 */

// ── Colors ────────────────────────────────────────────────────────────────────
export const colors = {
  // Surfaces
  bg:           '#fafafa',     // page background — warmer than slate-50
  surface:      '#ffffff',     // cards, panels
  surfaceHover: '#f8f9fa',     // interactive hover on surface
  surfaceAlt:   '#f5f6f8',     // secondary surface (sidebar, header subtle)

  // Text
  textPrimary:   '#0a0f1a',   // near-black — high contrast headings + numbers
  textSecondary: '#5c6370',   // body copy, descriptions
  textTertiary:  '#9ca3af',   // labels, placeholders, muted
  textInverse:   '#ffffff',   // text on dark backgrounds

  // Borders
  border:       '#e5e7eb',    // default border (gray-200)
  borderSubtle: '#f0f1f3',    // very subtle dividers (used instead of borders)

  // Semantic — Financial
  positive:     '#16a34a',    // muted green (green-600) — gains, long, bull
  positiveBg:   '#f0fdf4',    // green-50 — background tint
  negative:     '#dc2626',    // muted red (red-600) — losses, short, bear
  negativeBg:   '#fef2f2',    // red-50 — background tint
  caution:      '#d97706',    // amber-600 — warnings, expiry
  cautionBg:    '#fffbeb',    // amber-50

  // Accent — ONE consistent accent throughout
  accent:       '#4f46e5',    // indigo-600
  accentSoft:   '#eef2ff',    // indigo-50 — background tint
  accentMuted:  '#818cf8',    // indigo-400 — secondary accent
  accentText:   '#3730a3',    // indigo-800 — on light accent backgrounds

  // Chrome (shell UI)
  chrome:       '#ffffff',
  chromeMuted:  '#6b7280',    // gray-500
} as const

// ── Spacing ───────────────────────────────────────────────────────────────────
// 4-based scale: 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 48
export const spacing = {
  '1':  '0.25rem',   // 4px
  '1.5':'0.375rem',  // 6px
  '2':  '0.5rem',    // 8px
  '3':  '0.75rem',   // 12px
  '4':  '1rem',      // 16px
  '5':  '1.25rem',   // 20px
  '6':  '1.5rem',    // 24px
  '8':  '2rem',      // 32px
  '12': '3rem',      // 48px
} as const

// ── Radius ────────────────────────────────────────────────────────────────────
export const radius = {
  sm:   '0.5rem',    // 8px — buttons, inputs
  md:   '0.75rem',   // 12px — cards inner elements
  lg:   '1rem',      // 16px — cards, panels
  xl:   '1.25rem',   // 20px — primary containers
  full: '9999px',    // pills, avatars
} as const

// ── Shadows ───────────────────────────────────────────────────────────────────
// Minimal — Apple-style barely-there elevation
export const shadows = {
  sm:   '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
  md:   '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
  lg:   '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03)',
  none: 'none',
} as const

// ── Typography ────────────────────────────────────────────────────────────────
// Hierarchy: Numbers > Titles > Labels
export const typography = {
  // Hero financial numbers — largest, tightest
  heroNumber: {
    fontSize:      '2rem',       // 32px
    fontWeight:    '600',
    letterSpacing: '-0.025em',
    lineHeight:    '1.1',
    fontFeatureSettings: '"tnum"',
  },
  // Large metric values
  metricValue: {
    fontSize:      '1.5rem',     // 24px
    fontWeight:    '600',
    letterSpacing: '-0.02em',
    lineHeight:    '1.2',
    fontFeatureSettings: '"tnum"',
  },
  // Secondary metric values
  metricValueSm: {
    fontSize:      '1.125rem',   // 18px
    fontWeight:    '600',
    letterSpacing: '-0.015em',
    lineHeight:    '1.3',
    fontFeatureSettings: '"tnum"',
  },
  // Section titles
  sectionTitle: {
    fontSize:      '0.9375rem',  // 15px
    fontWeight:    '600',
    letterSpacing: '-0.01em',
    lineHeight:    '1.4',
  },
  // Small labels / captions
  label: {
    fontSize:      '0.6875rem',  // 11px
    fontWeight:    '500',
    letterSpacing: '0.04em',
    lineHeight:    '1.5',
    textTransform: 'uppercase' as const,
  },
  // Body text
  body: {
    fontSize:      '0.875rem',   // 14px
    fontWeight:    '400',
    lineHeight:    '1.6',
  },
  // Small body / table data
  bodySm: {
    fontSize:      '0.8125rem',  // 13px
    fontWeight:    '400',
    lineHeight:    '1.5',
  },
} as const

// ── Layout ────────────────────────────────────────────────────────────────────
export const layout = {
  maxContentWidth: '1400px',
  topNavHeight:    '3.5rem',     // 56px — h-14
  sidebarExpanded: '240px',
  sidebarCollapsed:'64px',
  sidebarPanel:    '520px',      // trade entry, alerts, etc.
  pageGutter:      '1.5rem',     // 24px — px-6
  pageGutterMd:    '2rem',       // 32px — px-8
  sectionGap:      '1.25rem',    // 20px — gap between sections
} as const

// ── Animation ─────────────────────────────────────────────────────────────────
export const motion = {
  fast:     '150ms',
  default:  '200ms',
  slow:     '300ms',
  easing:   'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

// ── Z-Index ───────────────────────────────────────────────────────────────────
export const zIndex = {
  sidebar:  20,
  topNav:   30,
  dropdown: 40,
  overlay:  50,
  modal:    60,
} as const
