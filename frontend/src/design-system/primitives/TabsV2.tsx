/**
 * TabsV2 — minimal underline tab navigation.
 *
 * Wealthsimple-style: no boxes, no heavy borders. Clean underline indicator.
 * Supports controlled + uncontrolled modes.
 */
import { useState } from 'react'

export interface TabItem {
  key: string
  label: string
}

interface Props {
  tabs: TabItem[]
  /** Controlled: current active key */
  activeKey?: string
  /** Callback when tab changes */
  onChange?: (key: string) => void
  /** Size variant */
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

  const textClass = size === 'sm' ? 'text-ds-sm' : 'text-ds-body-r'

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
              relative px-3 py-2 ${textClass} font-bold transition-colors rounded-v2-sm
              ${isActive
                ? 'text-v2-accent'
                : 'text-v2-text-3 hover:text-v2-text-2'
              }
            `}
          >
            {label}
            {isActive && (
              <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-v2-accent rounded-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}
