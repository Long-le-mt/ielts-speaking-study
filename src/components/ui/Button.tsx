import { forwardRef, type ComponentPropsWithoutRef } from 'react'

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'quiet'
  size?: 'default' | 'compact'
  busy?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'default', busy = false, className, disabled, type = 'button', ...props },
  ref,
) {
  const classes = [
    'secondary',
    variant !== 'secondary' && `button-${variant}`,
    size === 'compact' && 'button-compact',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || props['aria-busy']}
    />
  )
})
