// =============================================================================
// WHAT THIS FILE IS
//   A short message that slides up at the bottom ("Saved", "PIN reset") and
//   hides itself after 4 seconds. useToast() returns [message, show] and
//   <Toast> renders it.
// WHY IT EXISTS
//   Dashboard, Users and Venues each had their own copy of the same timer and
//   markup. On phones it sits above the bottom tab bar.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'

export interface ToastMsg { text: string; tone: 'ok' | 'error' }

export function useToast(ms = 4000) {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), ms)
    return () => clearTimeout(id)
  }, [toast, ms])
  const show = useCallback((text: string, tone: ToastMsg['tone'] = 'ok') => setToast({ text, tone }), [])
  return [toast, show, () => setToast(null)] as const
}

export function Toast({ toast, onClose }: { toast: ToastMsg | null; onClose?: () => void }) {
  if (!toast) return null
  return createPortal(
    <div role="status" aria-live="polite"
      className="toast-in fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-md items-start gap-3 rounded-xl bg-navy-900 px-4 py-3 text-sm text-white shadow-pop md:bottom-6">
      <Icon name={toast.tone === 'ok' ? 'checkCircle' : 'alert'} className={`mt-0.5 size-4 shrink-0 ${toast.tone === 'ok' ? 'text-[#7fd3ae]' : 'text-[#ffb59a]'}`} />
      <span className="min-w-0 flex-1 leading-relaxed">{toast.text}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="-my-0.5 -mr-1 rounded p-0.5 text-white/60 hover:text-white">
          <Icon name="x" className="size-4" />
        </button>
      )}
    </div>,
    document.body,
  )
}
