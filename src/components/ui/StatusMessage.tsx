import type { ReactNode } from 'react'

interface StatusMessageProps {
  kind: 'loading' | 'empty' | 'error' | 'info'
  children: ReactNode
  action?: ReactNode
}

export function StatusMessage({ kind, children, action }: StatusMessageProps) {
  return (
    <div className="ui-status" data-kind={kind}>
      <p className="notice" role={kind === 'error' ? 'alert' : 'status'}>{children}</p>
      {action}
    </div>
  )
}
