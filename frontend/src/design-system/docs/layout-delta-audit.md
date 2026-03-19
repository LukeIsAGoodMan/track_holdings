# Layout Delta Audit — Track Holdings V2 vs Figma Reference

Generated: 2026-03-19 (A0 stabilization patch)

## Reference Sources
- **Figma**: Wealthsimple dashboard (node 2:9942), viewport 2033px
- **Current**: Track Holdings V2 shell components + tokens.ts

---

## Delta Table

| Property | Figma Reference | Current System | Delta | Classification |
|---|---|---|---|---|
| **Sidebar expanded** | 90px (icon-only) | 240px (`w-v2-sidebar`) | +150px | **1 — Intentional adaptation** |
| **Sidebar collapsed** | N/A (no collapse) | 64px (`w-v2-sidebar-sm`) | N/A | **1 — Intentional adaptation** |
| **Action panel** | N/A | 520px (`w-v2-panel`) | N/A | **1 — Intentional adaptation** |
| **Content max-width** | 1344px | 1400px (`max-w-v2-content`) | +56px | **3 — Requires visual QA** |
| **Top nav height** | ~80px (inferred) | 56px (`h-14`) | -24px | **1 — Intentional adaptation** |
| **Page gutter (sm)** | 96px left | 24px (`px-6`) | -72px | **1 — Intentional adaptation** |
| **Page gutter (md)** | 96px left | 32px (`px-8`) | -64px | **1 — Intentional adaptation** |
| **Section gap** | 16px | 20px (`gap-5`) | +4px | **3 — Requires visual QA** |
| **Right panel** | 393px (sticky) | Not implemented | N/A | **2 — Missing from system** |

---

## Analysis

### 1 — Intentional Adaptations (KEEP)

**Sidebar (240px vs 90px):**
Wealthsimple uses an icon-only sidebar (90px) because it has fewer nav items (7 icons).
Track Holdings has a workflow-driven sidebar with:
- Portfolio tree selector with nested items
- "New Trade" and "Alerts" action buttons
- Group labels ("Portfolio", "Strategy")

An icon-only 90px sidebar cannot support this content structure. The 240px expanded
width with 64px collapsed state is a valid design adaptation. **Keep.**

**Top nav (56px vs ~80px):**
Wealthsimple shows a greeting + two CTAs in an 80px nav bar. Track Holdings uses
a compact nav with page title + portfolio breadcrumb + WS status + user avatar.
The 56px height is appropriate for this density. **Keep.**

**Page gutter (24-32px vs 96px):**
Wealthsimple's 96px left padding is measured from the sidebar edge to the content
start. Track Holdings achieves equivalent spacing through the sidebar width (240px
or 64px) + PageContainer padding (24-32px). The effective left offset from viewport
edge is 264-272px expanded or 88-96px collapsed — comparable. **Keep.**

### 2 — Drift / Missing (Should Implement)

**Right panel (393px, sticky):**
Wealthsimple uses a fixed 393px right panel for watchlist, promotions, and quick
actions. Track Holdings V2 pages implement right columns ad-hoc in each page
(e.g., RightPanelStack in HoldingsPageV2). There is no system-level right panel
primitive.

**Recommendation:** Create a `RightPanel` shell component or codify the right
column pattern in PageContainer. Low priority — current approach works but lacks
consistency. Defer to Phase B.

### 3 — Requires Visual QA

**Content max-width (1400px vs 1344px):**
+56px wider. On a 1920px viewport with 240px sidebar, effective content area =
1680px, capped at 1400px. On Figma reference with 90px sidebar, effective =
1943px, capped at 1344px. The delta means Track Holdings content is slightly
wider but visually acceptable at standard viewports. **Monitor during Phase A
refactor — no immediate change needed.**

**Section gap (20px vs 16px):**
+4px wider gaps between cards. This is at the borderline threshold. Wealthsimple's
tighter 16px creates a denser feel; Track Holdings' 20px adds breathing room.
Both are on the 4pt grid. **Acceptable — defer decision to visual QA after
Phase A primitive refactor.**

---

## Summary

| Classification | Count | Action |
|---|---|---|
| Intentional adaptation (keep) | 5 | No change |
| Drift / missing | 1 | Defer to Phase B |
| Requires visual QA | 2 | Monitor during Phase A |

**No layout values should be changed at this time.**
