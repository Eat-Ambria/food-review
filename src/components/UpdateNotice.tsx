// Tells the user a new version is out and reloads to it.
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { refreshApp } from '../lib/refreshApp'

declare const __BUILD_ID__: string

export function UpdateNotice() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let stopped = false
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        const { build } = await res.json()
        if (!stopped && build && build !== __BUILD_ID__) setAvailable(true)
      } catch { }
    }
    void check()
    const id = setInterval(check, 10 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { stopped = true; clearInterval(id); document.removeEventListener('visibilitychange', check) }
  }, [])

  if (!available) return null
  return (
    <div role="status" className="toast-in fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-navy-900 py-2.5 pl-4 pr-2.5 text-sm text-white shadow-pop md:bottom-6">
      <span className="flex items-center gap-2.5"><Icon name="sparkles" className="size-4 text-marigold" />A new version is available.</span>
      <button type="button" onClick={() => void refreshApp()} className="h-8 rounded-lg bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-white/90">Reload</button>
    </div>
  )
}
