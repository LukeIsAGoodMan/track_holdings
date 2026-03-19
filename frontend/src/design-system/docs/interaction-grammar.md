# Interaction Grammar — Track Holdings V2

State definitions and motion constraints derived from Figma extraction.

---

## Hover / Active / Focus

### Card Hover
- Overlay transitions from `opacity: 0` → `opacity: 1`
- Background shifts toward `surface.canvas` (white)
- Transition: `200ms ease`

### List Row Hover
- Background: `surface.raised`
- Radius: `radius.sm` (8px)
- Transition: `150ms ease`

### Button Hover
- Primary: `action.primary` → `action.primaryHover`
- Secondary: `surface.raised` → `surface.hover`
- Ghost: transparent → `surface.subtle`
- Transition: `150ms ease`

### Icon Button Hover
- Background opacity transition on `overlay.buttonSubtle`
- Transition: `150ms ease`

### Focus
- 2px outline, color: `action.primary`
- Outline offset: 2px
- No background change
- Applied via `:focus-visible` only (not `:focus`)

### Active
- Scale: `0.98` (recommended, not in Figma — inferred from interaction density)
- Duration: instant (no transition on active)

---

## Loading Skeleton Rules

### Base Properties
- Background: `surface.muted` (#F2F2F2)
- Animation: shimmer gradient
  - `surface.muted` → `surface.subtle` → `surface.muted`
  - Duration: 1.5s
  - Timing: ease-in-out
  - Iteration: infinite

### Dimension Matching (CLS Prevention)
Every skeleton MUST match the loaded component's exact dimensions:

| Component | Skeleton Structure |
|---|---|
| MetricBlock (display) | h-9 (value) + h-2.5 (label) with 4px gap |
| MetricBlock (large) | h-7 (value) + h-2.5 (label) with 4px gap |
| List row | h-16 with 24px circle + two text lines (h-3 + h-2.5) |
| Card | Full card dimensions, same radius |
| Chart | Full chart height, same radius |

### Skeleton Radius
Must equal component radius. Card skeleton uses `radius.lg`.

---

## Empty States

### Structure
- Centered vertically and horizontally within container
- Icon: 48px, color: `text.muted`
- Title: `typography.h3`, color: `text.primary`
- Description: `typography.bodyRegular`, color: `text.secondary`
- CTA: `ActionButton` variant `secondary`
- min-height: must match loaded component height

### Error States
- Same layout as empty state
- Icon: 48px, color: `semantic.error`
- Title: `typography.h3`, "Something went wrong"
- Retry button: `ActionButton` variant `primary`

---

## Motion Constraints

### Duration Scale
| Name | Value | Usage |
|---|---|---|
| `fast` | 150ms | Hover bg, opacity, color transitions |
| `default` | 200ms | Card transitions, slide-in, sidebar collapse |
| `slow` | 300ms | Modal open/close, page transitions |

### Easing
- Standard: `cubic-bezier(0.4, 0, 0.2, 1)` — material standard
- No spring physics (design is functional, not playful)

### Rules
1. Carousel: horizontal slide, manual prev/next, no auto-play
2. `backdrop-blur` transitions: avoid animating (GPU performance)
3. Skeleton shimmer: 1.5s, linear, infinite
4. Sidebar collapse: width transition `200ms ease-out`
5. Tab indicator: `left` + `width` transition `200ms ease`
6. No `transform: scale()` on hover (use background opacity instead)

### Reduced Motion
When `prefers-reduced-motion: reduce`:
- All transitions: `0ms`
- Skeleton shimmer: disabled (static bg)
- Sidebar: instant collapse (no transition)
