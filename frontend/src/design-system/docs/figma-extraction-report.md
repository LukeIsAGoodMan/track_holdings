# Figma Extraction Report — Track Holdings Design System

**Source:** Wealthsimple Dashboard (Figma node 2:9942)
**Secondary reference:** Apple.com product page (Figma node 2:11527)
**Extracted:** 2026-03-19 via Figma MCP (get_design_context)
**File key:** X9KnvQmLmYqQFEzrUT9sHA

---

## Raw Color Palette

| Hex | Figma Name | Lightness | Semantic Role |
|---|---|---|---|
| `#32302F` | Dune | ~19% | Text primary |
| `#686664` | Ironside Gray | ~40% | Text secondary |
| `#94908D` | Natural Gray | ~57% | Text muted |
| `#E4E2DD` | Westar | ~88% | Warm surface |
| `#DED5D2` | Swiss Coffee | ~85% | Warm surface alt |
| `#F2F2F2` | Grey 95 | ~95% | Surface muted |
| `#F5F4F4` | Wild Sand | ~96% | Surface subtle |
| `#F9F9F9` | Alabaster | ~98% | Surface raised |
| `#FFFFFF` | White | 100% | Surface canvas |
| `#305FAA` | Azure | — | Action primary |
| `#4A6FA5` | San Marino | — | Action hover |
| `#7F78DF` | Medium Purple | — | Accent secondary |
| `#CD1C13` | Thunderbird | — | Semantic error/loss |
| `#058A33` | Salem | — | Semantic success/gain |
| `#7E6812` | — | — | Semantic warning |

### Alpha Colors

| Value | Usage |
|---|---|
| `rgba(0, 0, 0, 0.08)` | Border subtle / dividers |
| `rgba(0, 0, 0, 0.06)` | Button subtle bg |
| `rgba(169, 188, 229, 0.22)` | Badge blue bg |
| `rgba(218, 201, 103, 0.24)` | Badge yellow bg |
| `rgba(193, 202, 237, 0.50)` | Glass element bg |
| `rgba(0, 0, 0, 0.05)` | Shadow card |
| `rgba(0, 0, 0, 0.18)` | Shadow elevated |
| `rgba(0, 0, 0, 0.04)` | Shadow subtle |

---

## Raw Typography

**Font family:** Inter (only)
**Weights:** 400 (Regular), 700 (Bold)

| Raw Size Range | Weight | Line Height | Letter Spacing | Context |
|---|---|---|---|---|
| 28.6–29.4px | 700 | — | — | Total balance |
| 23.6px | 700 | — | — | Section numbers |
| 16.6–16.9px | 700 | 26px | -0.18px | Carousel titles |
| 14.9–15.5px | 700 | 22px | 0.016px | Tab labels |
| 13.0–13.9px | 700 | 20px | 0.14px | Primary labels, prices |
| 13.0px | 400 | 20px | 0.14px | Body text |
| 11.1–11.8px | 400 | 16px | 0.18px | Subtitles, change % |
| 9.8–10.5px | 700 | 14px | 0.21px | Badges, pills |

---

## Raw Spacing Values (px)

Frequency-ranked: **8, 16, 24** (high) > **4, 12, 14, 20, 32** (medium) > **2, 6, 10, 28** (low)

Detected grid: **8pt** with 4pt half-step

---

## Raw Border Radii

| Value | Context |
|---|---|
| `8px` | Icon buttons, small containers, list rows |
| `12px` | Sidebar items, stock logos |
| `16px` | Cards, carousel, main containers |
| `38px` | Circle buttons (normalize to full) |
| `72px` | Avatars (normalize to full) |
| `200px` | Pills (normalize to full) |

---

## Raw Shadows

| Value | Context |
|---|---|
| `0px 8px 24px 0px rgba(0,0,0,0.05)` | Standard card |
| `0px 8px 16px 0px rgba(0,0,0,0.04)` | Subtle floating |
| `0px 12px 46px 0px rgba(0,0,0,0.18)` | High-emphasis float |

---

## Raw Layout Dimensions

| Element | Width | Height |
|---|---|---|
| Viewport | 2033px | — |
| Sidebar | 90px | full |
| Main content | 1344px | — |
| Right panel | 393px | sticky |
| Top nav padding-left | 96px | — |
| Account row | 1344px | 82px |
| Watchlist row | 373px | 64px |
| Nav arrow | 28px | 28px |
| Stock logo | 24px | 24px |
| Sidebar icon | 18px | 18px |
| Tab segment | — | 32px |

---

## Component Instances Identified

| Component | Variants | Size | Usage |
|---|---|---|---|
| Icon set | 14 variants | 16-32px | Navigation, actions |
| Card container (11) | 1 | full-width | Account rows, promo, docs |
| List row (17) | 1 | 64px height | Watchlist ticker rows |
| Tab pill (10) | 1 | 32px height | Time range selector |
| Nav arrow (15) | 2 (left/right) | 28px circle | Carousel navigation |
| Tab text (16) | 1 | 30px | Holdings/Watchlist tabs |
| Stock logo (1) | 4 variants | 24px round | Ticker icons |
| Badge (7lvokd) | blue, yellow | pill | Status indicators |
