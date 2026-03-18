/**
 * Design System V2 — barrel export.
 *
 * Usage: import { SectionCard, MetricBlock, ... } from '@/design-system'
 */

// Tokens
export * from './tokens'

// Primitives
export { default as SectionCard }    from './primitives/SectionCard'
export { default as SectionGrid }    from './primitives/SectionGrid'
export { default as MetricBlock }    from './primitives/MetricBlock'
export { default as PageHeader }     from './primitives/PageHeader'
export { default as TabsV2 }        from './primitives/TabsV2'
export { default as ActionButton }   from './primitives/ActionButton'
export { default as ChartContainer } from './primitives/ChartContainer'
export { default as PanelContainer } from './primitives/PanelContainer'
export { default as EmptyState }     from './primitives/EmptyState'
export { default as SkeletonLoader } from './primitives/SkeletonLoader'

// Shell
export { default as AppShellV2 }     from './shell/AppShellV2'
export { default as SidebarV2 }      from './shell/SidebarV2'
export { default as TopNavV2 }       from './shell/TopNavV2'
export { default as PageContainer }  from './shell/PageContainer'

// Workspace
export { default as HeroSection }    from './workspace/HeroSection'
export { QuickRiskCard, AllocationCard, CashCard } from './workspace/RightPanelStack'
