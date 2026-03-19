/**
 * ActionButton — primary and secondary button variants.
 *
 * Interaction states sourced from interaction.ts contract.
 * Focus via global :focus-visible rule.
 * Micro-interaction: active:scale-[0.98] for tactile press feedback.
 *
 * NO local variantClasses map — interaction.ts is the single source.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { interactiveClasses } from '../interaction'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  /** Optional leading icon */
  icon?: ReactNode
  /** Full width */
  block?: boolean
}

/** Maps ActionButton variant → interaction system variant + visual base */
const VARIANT_BASE: Record<string, { intent: 'button-primary' | 'button-ghost'; base: string }> = {
  primary:   { intent: 'button-primary', base: 'bg-v2-accent text-white' },
  secondary: { intent: 'button-ghost',   base: 'bg-v2-surface text-v2-text-1 border border-v2-border' },
  ghost:     { intent: 'button-ghost',   base: 'bg-transparent text-v2-text-2' },
  danger:    { intent: 'button-ghost',   base: 'bg-v2-negative-bg text-v2-negative border border-v2-border' },
}

const sizeClasses: Record<string, string> = {
  sm: 'px-3 py-1.5 text-ds-sm rounded-v2-sm',
  md: 'px-4 py-2 text-ds-body-r rounded-v2-md',
  lg: 'px-5 py-2.5 text-ds-body-r rounded-v2-md',
}

export default function ActionButton({
  variant = 'primary',
  size = 'md',
  icon,
  block = false,
  children,
  className = '',
  disabled,
  ...rest
}: Props) {
  const { intent, base } = VARIANT_BASE[variant]
  const stateClasses = interactiveClasses({ variant: intent, disabled: !!disabled })

  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2 font-bold
        ${base} ${stateClasses} ${sizeClasses[size]}
        ${block ? 'w-full' : ''}
        ${className}
      `}
      disabled={disabled}
      {...rest}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  )
}
