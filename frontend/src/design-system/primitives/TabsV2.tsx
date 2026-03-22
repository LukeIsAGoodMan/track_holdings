/**
 * TabsV2 — Minimal tab navigation.
 *
 * Typography rules:
 *   - Active and inactive use SAME font size
 *   - NO font weight change (no bold)
 *   - State change via opacity/color ONLY
 *   - Transition feels stable and calm
 *
 * States:
 *   inactive: text-v2-text-3 (muted)
 *   hover:    text-v2-text-2
 *   active:   text-v2-text-1 + subtle underline indicator
 */
import { useState } from 'react'

export interface TabItem {
  key: string
  label: string
}

interface Props {
  tabs: TabItem[]
  activeKey?: string
  onChange?: (key: string) => void
  size?: 'sm' | 'md'
  className?: string
}

export default function TabsV2({
  tabs,
  activeKey: controlledKey,
  onChange,
  size = 'md',
  className = '',
}: Props) {
  const [internalKey, setInternalKey] = useState(tabs[0]?.key ?? '')
  const activeKey = controlledKey ?? internalKey

  const handleClick = (key: string) => {
    if (!controlledKey) setInternalKey(key)
    onChange?.(key)
  }

  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <div className={`flex items-center gap-1 ${className}`} role="tablist">
      {tabs.map(({ key, label }) => {
        const isActive = key === activeKey
        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleClick(key)}
            className={`
              relative px-3 py-2 ${textSize} font-medium
              ds-color rounded-v2-sm
              ${isActive
                ? 'text-v2-text-1'
                : 'text-v2-text-3 hover:text-v2-text-2'
              }
            `}
          >
            {label}
            {isActive && (
              <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-v2-text-1 rounded-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}
