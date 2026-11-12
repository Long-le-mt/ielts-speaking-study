import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from './Button'

interface DrawerProps {
  id: string
  title: string
  open: boolean
  modal: boolean
  triggerId: string
  className?: string
  closeButtonId?: string
  closeLabel?: string
  onClose: () => void
  children: ReactNode
}

export function Drawer({
  id, title, open, modal, triggerId, className, closeButtonId, closeLabel = 'Close', onClose, children,
}: DrawerProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const modalOpen = open && modal
  const titleId = `${id}-title`

  useEffect(() => {
    if (modalOpen) closeButton.current?.focus({ preventScroll: true })
  }, [modalOpen])

  useEffect(() => {
    if (open || !restoreFocus.current) return
    restoreFocus.current = false
    document.getElementById(triggerId)?.focus({ preventScroll: true })
  }, [open, triggerId])

  function dismiss() {
    restoreFocus.current = true
    onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
      return
    }
    if (event.key !== 'Tab' || !modalOpen) return

    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex]',
    )).filter((control) => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <>
      <div className="sidebar-backdrop" aria-hidden="true" hidden={!modalOpen} onClick={dismiss} />
      <aside
        id={id}
        className={className}
        role={modalOpen ? 'dialog' : undefined}
        aria-modal={modalOpen || undefined}
        aria-labelledby={titleId}
        hidden={!open}
        onKeyDown={handleKeyDown}
      >
        <div className="sidebar-heading">
          <h2 id={titleId}>{title}</h2>
          <Button id={closeButtonId} ref={closeButton} size="compact" aria-label={closeLabel} onClick={dismiss}>
            Close
          </Button>
        </div>
        {children}
      </aside>
    </>
  )
}
