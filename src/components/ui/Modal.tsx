// Pop-up dialog: a bottom sheet on phones, a centred box on desktop.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'

export function Modal({ open, title, description, onClose, children, footer, size = 'md' }: {
  open: boolean; title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg'
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    requestAnimationFrame(() => { if (!boxRef.current?.contains(document.activeElement)) boxRef.current?.focus() })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      prevFocus?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fade-in fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/40 backdrop-blur-[2px] md:items-center md:p-6" onClick={onClose}>
      <div ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className={`sheet-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-pop outline-none md:rounded-2xl ${size === 'lg' ? 'md:max-w-2xl' : 'md:max-w-lg'}`}>
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" />
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 md:px-6 md:pt-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-1.5 rounded-lg p-1.5 text-faint transition-colors hover:bg-ink/[0.05] hover:text-ink">
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5 md:px-6">{children}</div>
        {footer && (
          <div className="flex gap-2 border-t border-line bg-subtle/60 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] md:justify-end md:rounded-b-2xl md:px-6 [&>*]:flex-1 md:[&>*]:flex-none">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
