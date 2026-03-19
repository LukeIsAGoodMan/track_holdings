# Refactoring Notes — Token Normalization Log

Decisions made when normalizing raw Figma values into the token system.

---

## Typography Normalization

| Raw Value | Normalized To | Reason |
|---|---|---|
| 28.6–29.4px | **28px** | Nearest 4pt grid (28). Consistent with display tier |
| 23.6px | **24px** | Nearest 4pt grid (24) |
| 16.6–16.9px | **17px** | Kept odd — between 16/18, preserves intended density |
| 14.9–15.5px | **15px** | Kept odd — tab-label specific size |
| 12.7–13.9px | **14px** | High-frequency cluster (12+ occurrences). Normalized UP to 14px for readability |
| 11.1–11.8px | **12px** | Normalized to 4pt grid |
| 9.8–10.5px | **10px** | Normalized to nearest even |

### Font Weight Normalization
- Figma uses only 400 and 700
- Current system uses 400, 500, 600
- Decision: **Adopt 400/700 only** per Principle 7
- 500 → 400 (supporting text contexts)
- 600 → 700 (emphasis contexts)

### Font Family Change
- Current: Plus Jakarta Sans (geometric)
- Target: Inter (humanist)
- Impact: ALL text elements reflow — must test every page

---

## Spacing Normalization

| Raw Value | Normalized To | Reason |
|---|---|---|
| 14px (list row py) | **Keep 14px** | Special case for data density. Not on 4pt grid but acceptable for row vertical padding |
| 28px (sidebar padding) | **24px** (`spacing.6`) | Not on 8pt grid. Normalize to nearest token |
| 10px (glass element pt) | **8px** (`spacing.2`) | Not on 8pt grid. Normalize down |
| 6px (glass element gap) | **Keep 6px** | Already in scale as `spacing.1.5` |

---

## Radius Normalization

| Raw Value | Normalized To | Reason |
|---|---|---|
| 38px | **9999px** (`radius.full`) | Circle button — use pill token |
| 72px | **9999px** (`radius.full`) | Avatar circle — use pill token |
| 200px | **9999px** (`radius.full`) | Pill element — use pill token |

---

## Color Clustering

### Warm Grey Cluster
- `#32302F` (Dune) → `text.primary` (was `#0a0f1a`)
- `#686664` (Ironside Gray) → `text.secondary` (was `#5c6370`)
- `#94908D` (Natural Gray) → `text.muted` (was `#9ca3af`)

### Surface Cluster
- `#FFFFFF` → `surface.canvas` (unchanged)
- `#F9F9F9` → `surface.raised` (was `#fafafa` — near identical, adopting Figma)
- `#F5F4F4` → `surface.subtle` (was `#f5f6f8` — warm shift)
- `#F2F2F2` → `surface.muted` (was `#f8f9fa` — slight darkening)
- `#E4E2DD` → `surface.warm` (NEW — no equivalent)
- `#DED5D2` → `surface.warmAlt` (NEW — no equivalent)

### Border Change
- Current: solid hex `#e5e7eb`
- Figma: alpha `rgba(0,0,0,0.08)`
- Decision: **Adopt alpha** — better for layered surfaces (transparent dividers work on any background)

### Accent Shift
- Current: Indigo `#4f46e5`
- Figma: Azure `#305FAA`
- Decision: **Adopt Azure** — aligns with Wealthsimple source of truth
- Secondary accent: `#7F78DF` (Medium Purple) — NEW token for avatars/special elements

---

## Shadow Normalization

| Level | Current | Figma | Decision |
|---|---|---|---|
| card | `0 1px 2px rgba(0,0,0,0.03)` | `0 8px 24px rgba(0,0,0,0.05)` | **Adopt Figma** — more visible elevation |
| subtle | composite 2-layer | `0 8px 16px rgba(0,0,0,0.04)` | **Adopt Figma** — single-layer simplification |
| elevated | `0 4px 6px composite` | `0 12px 46px rgba(0,0,0,0.18)` | **Adopt Figma** — dramatic floating effect |

---

## Visual Regression Risks

### CRITICAL (>4px delta)
1. **heroNumber 32px → 28px**: -4px. Mitigate with min-height on MetricBlock display skeleton
2. **Shadow offset 1px → 8px**: Visual-only shift. Cards gain visible depth. No CLS risk
3. **Font family swap**: Complete text reflow. All pages must be visually inspected

### MODERATE (2-4px delta)
4. **SectionCard padding 20px → 24px**: +4px. Content area shrinks 8px total. Check for horizontal overflow
5. **bodySm 13px → 12px**: -1px. Table row heights may decrease slightly

### LOW (<2px delta)
6. **label 11px → 10px**: -1px. Badge heights decrease marginally
7. **textPrimary warm shift**: Lower perceived contrast. Verify WCAG AA (4.5:1 minimum)
