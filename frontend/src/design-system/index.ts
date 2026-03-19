/**
 * Design System V2 — barrel export.
 *
 * Usage: import { SectionCard, MetricBlock, ... } from '@/design-system'
 */

// Tokens — colors, spacing, radius, shadows, layout, zIndex
export * from './tokens'

// Typography — fontFamily, fontWeight, typographyScale (canonical source)
export * from './typography'

// Motion — duration, easing, skeleton, transition helper (canonical source)
export * from './motion'

// Types — ThemeTokens, semantic key unions
export type * from './types'

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
export { default as Toolbar }        from './primitives/Toolbar'
export { default as Badge }         from './primitives/Badge'

// Shell
export { default as AppShellV2 }     from './shell/AppShellV2'
export { default as SidebarV2 }      from './shell/SidebarV2'
export { default as TopNavV2 }       from './shell/TopNavV2'
export { default as PageContainer }  from './shell/PageContainer'
export { default as RightPanel }     from './shell/RightPanel'

// Workspace
export { default as HeroSection }         from './workspace/HeroSection'
export { default as HoldingsActionBar }   from './workspace/HoldingsActionBar'
export { default as TradeRecordTimeline } from './workspace/TradeRecordTimeline'
export { default as ActivityPanel }       from './workspace/ActivityPanel'
export { QuickRiskCard, AllocationCard, CashCard } from './workspace/RightPanelStack'
export { default as RiskHero }            from './workspace/RiskHero'
export { default as RiskHeatmap }         from './workspace/RiskHeatmap'
export { default as ScenarioStressPanel } from './workspace/ScenarioStressPanel'
export { default as ConcentrationTable }  from './workspace/ConcentrationTable'
export { default as RiskAlertStack }      from './workspace/RiskAlertStack'
