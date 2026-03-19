# Design System V2 — Component Conventions

## Migration Guardrails (enforced from Phase A onward)

### FORBIDDEN in V2 components

1. **No raw hex colors**
   - Bad:  `text-[#32302f]`, `bg-[#f9f9f9]`
   - Good: `text-v2-text-1`, `bg-v2-surface-raised`

2. **No raw px font sizes**
   - Bad:  `text-[15px]`, `text-[11px]`, `text-[28px]`
   - Good: `text-ds-h3`, `text-ds-sm`, `text-ds-display`

3. **No raw shadow values**
   - Bad:  `shadow-[0_8px_24px_rgba(0,0,0,0.05)]`
   - Good: `shadow-v2-sm`

4. **No raw radius values**
   - Bad:  `rounded-[16px]`
   - Good: `rounded-v2-lg`

5. **No legacy Tailwind palette colors in V2 components**
   - Bad:  `text-slate-400`, `bg-emerald-50`, `border-indigo-200`
   - Good: `text-v2-text-3`, `bg-v2-positive-bg`, `border-v2-border`

6. **No font-medium or font-semibold (Principle 7: two weights only)**
   - Bad:  `font-medium`, `font-semibold`
   - Good: `font-normal` (400), `font-bold` (700)

### ALLOWED

- Standard Tailwind utilities: `flex`, `gap-4`, `p-5`, `items-center`, etc.
- Tailwind spacing scale: `p-1` through `p-12` (maps to 4px–48px)
- `text-xs`, `text-sm`, `text-lg` etc. in V1 components ONLY
- V1 color classes (`bg-app`, `text-chrome-muted`, etc.) in V1 components ONLY

### Token Domain Ownership

| Domain | Canonical File | Never Define In |
|---|---|---|
| Colors, Spacing, Radius, Shadows, Layout, Z-Index | `tokens.ts` | typography.ts, motion.ts |
| Typography (scale, family, weights) | `typography.ts` | tokens.ts |
| Motion (duration, easing, skeleton) | `motion.ts` | tokens.ts |
| CSS Variables | `design-tokens.css` | index.css |
| Tailwind Mapping | `tailwind.config.js` | inline styles |

### Deprecation Tracking

| Token | Status | Replacement | Remove In |
|---|---|---|---|
| `rounded-v2-xl` | ERADICATED | `rounded-v2-lg` | Completed in Phase A+B |
| `border-sub` | ERADICATED | `border-v2-border` | Completed in Phase C |
| `font-semibold` | ERADICATED | `font-bold` | Completed in Phase B+C |
| `font-medium` | ERADICATED | `font-normal` or `font-bold` | Completed in Phase B+C |
| `text-[Npx]` | ERADICATED | `text-ds-*` semantic classes | Completed in Phase C |
