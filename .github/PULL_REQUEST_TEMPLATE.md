## Summary

<!-- Brief description of changes -->

## Design System Compliance

- [ ] Existing primitives reused (no page-local card/button/badge wrappers)
- [ ] All tokens respected (no raw hex, no raw px, no arbitrary Tailwind values)
- [ ] Typography uses `text-ds-*` classes only (no `text-[Npx]`)
- [ ] Font weights: only `font-bold` or `font-normal` (no `font-semibold`/`font-medium`)
- [ ] All numeric displays use `tnum` class
- [ ] All numeric values are zero-safe (`value !== null && value !== undefined`)
- [ ] No `transition-all` — only scoped transitions
- [ ] Interaction states follow `interaction.ts` contract
- [ ] Focus-visible works correctly (not clipped by overflow containers)
- [ ] No `border-sub` usage (use `border-v2-border`)
- [ ] No `rounded-v2-xl` usage

## Layout Compliance

- [ ] Flex layout used (no `grid-cols-12` / `col-span-*` in V2 pages)
- [ ] RightPanel shell component used for sidebar widgets
- [ ] Skeleton matches final layout structure (same flex/panel hierarchy)
- [ ] Sticky behavior works correctly (no broken by overflow parents)
- [ ] No CLS between loading and loaded states

## Testing

- [ ] TypeScript compiles with zero errors
- [ ] Build completes successfully
- [ ] V1/V2 toggle still works
- [ ] Visual inspection of affected pages completed
