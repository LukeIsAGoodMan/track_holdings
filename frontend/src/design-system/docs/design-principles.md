# Design Principles — Track Holdings V2

Derived from Wealthsimple dashboard extraction (2026-03-19).
These 7 rules govern all component and layout decisions.

---

## 1. Warm Neutrality Over Cold Minimalism

Grey palette skews warm (`#32302F` not `#333333`). Surface colors include
cream-tinted variants (`#E4E2DD`, `#DED5D2`). This creates perceived
approachability for financial data without sacrificing professionalism.

**Enforcement:** All grey tokens use warm-tinted hex values. No pure blue-grey.

---

## 2. Color Communicates Meaning, Never Decoration

Saturated color appears exclusively in semantic contexts:
- Green (`#058A33`) for gains
- Red (`#CD1C13`) for losses
- Blue (`#305FAA`) for actionable elements

Zero decorative color in layout containers, backgrounds, or borders.

**Enforcement:** Only `semantic.*` and `action.*` tokens may use saturated color.

---

## 3. Shadow Implies Interaction, Not Hierarchy

Cards use 0.05-opacity shadows that are functionally subtle but provide
depth cues on hover/focus transitions. Stronger shadows (0.18) are reserved
for floating interactive elements (avatars, FABs, modals).

**Enforcement:** Standard cards use `shadow.card`. Only floating elements use `shadow.elevated`.

---

## 4. Typography Weight Carries Hierarchy, Not Size

The primary label system uses a single size (~14px) with Bold/Regular weight
to distinguish primary from secondary content. Size variation is reserved for
structural levels (display → heading → body).

**Enforcement:** Within a card, differentiate by weight (700 vs 400), not size.

---

## 5. Density Through Nesting, Not Compression

Data density is achieved by nesting content into cards and sections rather
than reducing spacing. Individual components maintain comfortable internal
padding (16-24px).

**Enforcement:** Never reduce padding below `spacing.4` (16px) for density. Add sections instead.

---

## 6. Border-Free Containment

Containers are defined by surface color and shadow only. Visible borders
appear only as 1px dividers (`rgba(0,0,0,0.08)`) between list items, never
as container outlines.

**Enforcement:** Cards use `shadow.card` + `surface.raised`, not `border`.

---

## 7. One Typeface, Two Weights

Inter Bold (700) for emphasis and labels. Inter Regular (400) for supporting text.
No medium, semibold, or light variants.

**Enforcement:** `fontWeight` must be exactly `400` or `700`. No `500`, `600`.
