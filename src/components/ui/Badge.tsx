import type { ComponentPropsWithoutRef } from 'react'

interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  tone?: 'neutral' | 'yellow' | 'coral' | 'mint' | 'blue'
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  const classes = ['pill', 'ui-badge', `ui-badge-${tone}`, className].filter(Boolean).join(' ')
  return <span {...props} className={classes} />
}
