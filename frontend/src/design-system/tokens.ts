/**
 * Design System V2 — Centralized Design Tokens
 *
 * SOURCE OF TRUTH: Figma extraction (Wealthsimple dashboard, 2026-03-19)
 * See: docs/figma-extraction-report.md for raw data
 * See: docs/refactoring-notes.md for normalization decisions
 *
 * This file owns: colors, spacing, radius, shadows, layout, zIndex.
 * Typography  → typography.ts (canonical source)
 * Motion      → motion.ts     (canonical source)
 *
 * All tokens exported `as const` for strict typing.
 * Tailwind classes reference these via extended config.
 * CSS variables mirror these in design-tokens.css.
 *
 * RULE: No ad-hoc colors, spacing, or typography outside this file.
 */

// ── Colors ────────────────────────────────────────────────────────────────────
export const colors = {
  // Surfaces — warm-tinted grey scale
  bg:            '#fafafa',     // page background
  surface:       '#ffffff',     // canvas — cards, panels, modals
  surfaceRaised: '#f9f9f9',     // raised — card default (Alabaster)
  surfaceHover:  '#f5f4f4',     // hover — interactive feedback (Wild Sand)
  surfaceAlt:    '#f2f2f2',     // muted — skeleton bg, secondary areas
  surfaceWarm:   '#e4e2dd',     // warm — promo cards, accent surfaces (Westar)
  surfaceWarmAlt:'#ded5d2',     // warm alt — variant promo (Swiss Coffee)

  // Text — warm grey hierarchy
  textPrimary:   '#32302f',     // Dune — headings, primary labels, prices
  textSecondary: '#686664',     // Ironside Gray — body, descriptions
  textTertiary:  '#94908d',     // Natural Gray — muted, placeholders, inactive tabs
  textInverse:   '#ffffff',     // on dark backgrounds

  // Borders — alpha-based for surface layering
  border:        'rgba(0, 0, 0, 0.08)',   // dividers, list separators
  borderStrong:  'rgba(0, 0, 0, 0.12)',   // stronger separation

  // Semantic — Financial
  positive:      '#058a33',     // Salem — gains, long, bull
  positiveBg:    '#f0fdf4',     // green-50 — background tint
  negative:      '#cd1c13',     // Thunderbird — losses, short, bear
  negativeBg:    '#fef2f2',     // red-50 — background tint
  caution:       '#d97706',     // amber-600 — warnings, expiry
  cautionBg:     '#fffbeb',     // amber-50
  warning:       '#7e6812',     // warning text (on yellow badge)

  // Action — Azure accent
  accent:        '#305faa',     // Azure — primary CTA, links, badges
  accentHover:   '#4a6fa5',     // San Marino — hover state
  accentSoft:    '#eef2ff',     // background tint for accent elements
  accentMuted:   '#7f78df',     // Medium Purple — avatars, secondary accent
  accentText:    '#305faa',     // text on light accent backgrounds

  // Overlay — alpha colors for layered elements
  overlayBtnSubtle:  'rgba(0, 0, 0, 0.06)',           // icon button bg
  overlayBadgeBlue:  'rgba(169, 188, 229, 0.22)',     // blue badge bg
  overlayBadgeYellow:'rgba(218, 201, 103, 0.24)',     // yellow badge bg
  overlayGlass:      'rgba(193, 202, 237, 0.50)',     // glass effect bg

  // Chrome (shell UI)
  chrome:        '#ffffff',
  chromeMuted:   '#94908d',     // aligned with textTertiary
} as const

// ── Spacing ───────────────────────────────────────────────────────────────────
// 8pt grid with 4pt half-step: 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48
export const spacing = {
  '0.5': '0.125rem',  // 2px
  '1':   '0.25rem',   // 4px
  '1.5': '0.375rem',  // 6px
  '2':   '0.5rem',    // 8px
  '3':   '0.75rem',   // 12px
  '4':   '1rem',      // 16px
  '5':   '1.25rem',   // 20px
  '6':   '1.5rem',    // 24px
  '8':   '2rem',      // 32px
  '10':  '2.5rem',    // 40px
  '12':  '3rem',      // 48px
} as const

// ── Radius ────────────────────────────────────────────────────────────────────
export const radius = {
  sm:   '0.5rem',    // 8px — icon buttons, inputs, list row hover
  md:   '0.75rem',   // 12px — sidebar items, stock logos
  lg:   '1rem',      // 16px — cards, carousel, main containers
  full: '9999px',    // pills, avatars, badges, circles
} as const

// ── Shadows ───────────────────────────────────────────────────────────────────
// Wealthsimple-style: 8-12px offset, soft opacity
export const shadows = {
  card:     '0px 8px 24px 0px rgba(0, 0, 0, 0.05)',   // standard cards
  subtle:   '0px 8px 16px 0px rgba(0, 0, 0, 0.04)',   // subtle floating elements
  elevated: '0px 12px 46px 0px rgba(0, 0, 0, 0.18)',  // high-emphasis float (modals, FABs)
  none:     'none',
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
  shellGutter:     '1rem',       // 16px — outer page gutter around shell surfaces
  shellGap:        '1rem',       // 16px — gap between sidebar and main surfaces
} as const

// ── Z-Index (semantic layering) ───────────────────────────────────────────────
// Named by purpose, not arbitrary number. Use these exclusively.
export const zIndex = {
  nav:      20,       // sidebar, bottom nav
  topNav:   30,       // sticky top bar (above nav)
  dropdown: 40,       // menus, popovers, tooltips
  overlay:  50,       // modal backdrops, drawers
  modal:    60,       // modal content
  toast:    70,       // notifications, snackbars
} as const
