# Design System V2 — Governance Rules

These rules are mandatory for all V2 code. Violations must be fixed before merge.

---

## Architecture Rules

1. **Pages compose primitives; pages do not define visual rules.**
   Pages may only use: SectionCard, PanelContainer, ChartContainer, MetricBlock,
   ActionButton, Badge, TabsV2, EmptyState, SkeletonLoader, Toolbar, RightPanel.
   No page-local card wrappers, badge styles, or button variants.

2. **RightPanel is mandatory for standard 2-column V2 layouts.**
   No `grid-cols-12` + `col-span-*` patterns in V2 pages.
   Use flex layout: `flex-1` main + `<RightPanel>` shell component.
   Exception: detail-panel patterns (e.g. OpportunitiesPageV2) may use
   inline fixed-width sticky divs when content requires wider display.

3. **Skeleton structure must match final layout.**
   Loading skeletons must use the same flex/panel structure as the loaded state.
   Same padding, same radius, same min-height. CLS must be zero.

---

## Typography Rules

4. **No arbitrary typography values.**
   Forbidden: `text-[Npx]`, `text-[N.Nrem]`, arbitrary tracking values.
   Use only: `text-ds-display`, `text-ds-h1`, `text-ds-h2`, `text-ds-h3`,
   `text-ds-body`, `text-ds-body-r`, `text-ds-sm`, `text-ds-caption`.

5. **Two weights only: `font-bold` (700) and `font-normal` (400).**
   Forbidden: `font-semibold`, `font-medium`, `font-light`, `font-extrabold`.
   Note: `text-ds-*` classes already include the correct weight.
   Adding `font-bold` to a `text-ds-*` class is redundant and should be removed.

---

## Numeric Display Rules

6. **All numbers must render with `tnum` (tabular-nums).**
   Apply the `tnum` class to all numeric displays: prices, percentages,
   P&L, Greeks, exposures, counts. This prevents horizontal jitter
   during real-time updates.

7. **Zero must render; never use truthy checks for numeric output.**
   `0`, `0.0`, `0.00` are valid display values.
   Only `null` and `undefined` represent missing data.
   Use: `value !== null && value !== undefined` (or `isPresent(value)`).
   Forbidden: `if (value)`, `value && ...`, `value || '—'` for numbers.

---

## Color & Token Rules

8. **No raw hex colors.** Use `v2-*` Tailwind classes or `var(--ds-*)` CSS variables.
9. **No raw px values** except those already defined in tokens.
10. **No legacy color classes** (`slate-*`, `emerald-*`, `indigo-*`, `rose-*`) in V2 code.
11. **No `border-sub`** — use `border-v2-border` (standard) or `border-v2-border-strong`.

---

## Interaction Rules

12. **Interaction states must come from the interaction contract.**
    Use `interactiveClasses()` or the canonical state patterns defined in
    `interaction.ts`. No per-component ad-hoc hover/active/focus overrides.

13. **Focus-visible is global.** The `:focus-visible` rule in `index.css` handles
    all keyboard focus. Do not add component-level focus ring overrides.
    Ensure no `overflow-hidden` parent clips the focus outline.

---

## Motion Rules

14. **No `transition-all`.** Use scoped transitions only:
    `transition-colors`, `transition-opacity`, `transition-transform`,
    `transition-[width]`.

15. **Never animate numeric metric values.** Numbers must update instantly.

16. **Layout transitions must not cause content jitter.**
    Sidebar collapse, panel resize must be smooth. Use `will-change` sparingly.

---

## Spacing & Layout Rules

17. **No ad-hoc spacing hacks.** All spacing must use Tailwind's standard scale
    (which maps to the 4px/8px grid defined in tokens).

18. **No `grid-cols-12` in V2 pages.** Flex layout is the V2 standard.

---

## Sticky Safety Rules

19. **Sticky Safety Rule.**
    Any ancestor of a sticky element must not use `overflow:hidden` or `overflow:auto`
    unless it is the intended scroll container. Breaking this rule causes sticky failure.

20. **RightPanel scroll container.**
    The `<main>` element in AppShellV2 is the scroll container.
    RightPanel uses `sticky top-0` within that container.
    Do not add `overflow-hidden` to any element between `<main>` and `<RightPanel>`.

---

## Numeric Formatting Rules

21. **Use `formatMetric()` for all new numeric formatting.**
    Prefer `formatMetric(value, { type: 'currency' })` over direct `Intl.NumberFormat`.
    Always zero-safe. Always consistent precision.
    Existing `fmtUSD`/`fmtNum` remain valid for legacy code but should migrate.

---

## Enforcement

These rules should be checked in code review and enforced via:
- PR checklist (`.github/PULL_REQUEST_TEMPLATE.md`)
- Visual inspection of changed pages
- TypeScript compilation (no any-typed token usage)
