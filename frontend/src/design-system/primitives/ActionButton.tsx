/**
 * ActionButton — primary and secondary button variants.
 *
 * Uses canonical action tokens. Focus via global :focus-visible rule.
 * Micro-interaction: active:scale-[0.98] for tactile press feedback.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  /** Optional leading icon */
  icon?: ReactNode
  /** Full width */
  block?: boolean
}

const variantClasses: Record<string, string> = {
  primary:   'bg-v2-accent text-white hover:bg-v2-accent-hover active:scale-[0.98] active:opacity-90',
  secondary: 'bg-v2-surface text-v2-text-1 border border-v2-border hover:bg-v2-surface-hover active:bg-v2-surface-alt active:scale-[0.98]',
  ghost:     'bg-transparent text-v2-text-2 hover:bg-v2-surface-alt hover:text-v2-text-1 active:scale-[0.98]',
  danger:    'bg-v2-negative-bg text-v2-negative border border-v2-border hover:opacity-90 active:scale-[0.98]',
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
  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2
        font-bold transition-colors duration-150
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${block ? 'w-full' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
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
