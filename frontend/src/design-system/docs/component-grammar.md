# Component Grammar — Track Holdings V2

Structural specifications derived from Figma extraction.
All components MUST consume tokens — no raw px, hex, or arbitrary values.

---

## Button

| Variant | Background | Text | Border | Radius |
|---|---|---|---|---|
| primary | `action.primary` | `text.inverse` | none | `radius.lg` (16px) |
| secondary | `surface.raised` | `text.primary` | none | `radius.lg` (16px) |
| ghost | transparent | `text.secondary` | none | `radius.sm` (8px) |
| danger | `semantic.errorBg` | `semantic.error` | `border.subtle` | `radius.lg` (16px) |
| icon | `overlay.buttonSubtle` | inherit | none | `radius.full` |

| Size | Height | Padding-X | Font |
|---|---|---|---|
| sm | 28px | 12px | `typography.small` |
| md | 32-40px | 16px | `typography.body` |
| lg | 40px | 20px | `typography.body` |
| icon-sm | 28px | centered | — |
| icon-md | 32px | centered | — |

**States:**
- Hover: `action.primaryHover` (primary), `surface.hover` (secondary)
- Disabled: `opacity: 0.5`, `cursor: not-allowed`
- Focus: `2px outline`, `action.primary`, `offset 2px`
- Active: darken one step

---

## Card (SectionCard)

| Property | Value | Token |
|---|---|---|
| Background | `#F9F9F9` | `surface.raised` |
| Radius | 16px | `radius.lg` |
| Shadow | `0 8px 24px rgba(0,0,0,0.05)` | `shadow.card` |
| Padding | 24px | `spacing.6` |
| Border | none | — |

**Variants:**
- `default` — raised + shadow
- `warm` — `surface.warm` (#E4E2DD), no shadow, 16px radius
- `flat` — `surface.raised`, no shadow

**Loading:** CardSkeleton with shimmer at matching dimensions.
**min-height:** REQUIRED on all async cards for CLS prevention.

---

## Table / List Row

| Property | Value | Token |
|---|---|---|
| Row height | 64px (compact) / 82px (standard) | — |
| Padding | `16px` horizontal, `14px` vertical | `spacing.4` / custom |
| Radius | 8px (hover state) | `radius.sm` |
| Divider | 1px, `border.subtle`, inset 16px left | `border.subtle` |

**Layout:** `flex`, `justify-between`, `items-center`
- Left: icon (24px, `radius.md`) + `gap 12px` + text stack
- Right: value stack (primary bold + secondary regular)
- Last row: no divider

---

## Metric Block

| Size | Font Size | Font Weight | Line Height |
|---|---|---|---|
| display | 28px | 700 | 36px |
| large | 24px | 700 | 32px |
| default | 18px | 700 | 24px |

**Structure:**
1. Label: `typography.caption` (10px/700), `text.muted`, uppercase
2. Value: size-dependent, `tabular-nums`
3. Delta: `typography.small` (12px/400), semantic color, `opacity: 0.7`

**min-height:** display=40px, large=36px, default=28px (CLS guard)

---

## Badge

| Variant | Background | Text |
|---|---|---|
| blue | `overlay.badgeBlue` | `action.primary` |
| yellow | `overlay.badgeYellow` | `semantic.warning` |
| neutral | `surface.muted` | `text.secondary` |

**Structure:** `px-8px`, `py-2px`, `radius.full`, `typography.caption`

---

## Form Input (Inferred)

| Property | Value | Token |
|---|---|---|
| Height | 40px | — |
| Radius | 16px | `radius.lg` |
| Background | `surface.raised` | `surface.raised` |
| Border | none (or `border.subtle` on focus) | — |
| Focus | `shadow.card` + outline `action.primary` | — |
| Label | `typography.small`, `text.secondary` | — |

---

## Modal / Drawer (Inferred)

| Property | Value | Token |
|---|---|---|
| Backdrop | `rgba(0,0,0,0.3)` | — |
| Container bg | `surface.canvas` | `surface.canvas` |
| Radius | 16px | `radius.lg` |
| Shadow | `shadow.elevated` | `shadow.elevated` |
| Header padding | `24px` horizontal, `16px` vertical | — |

---

## Layout Container

| Region | Width | Behavior |
|---|---|---|
| Sidebar | 90px (icon-only) or 240px (expanded) | Fixed |
| Main content | flex-1, max-w 1344px | Fluid |
| Right panel | 393px | Sticky top=0 |
| Section gap | 16px vertical | Between cards |
| Card internal | 24px padding | Standard |
