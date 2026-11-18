// =============================================================================
// WHAT THIS FILE IS
//   A thin bar at the top of the screen that appears while the device is offline.
// WHY IT EXISTS
//   Recording, transcription and login all need internet. Telling the user up
//   front avoids confusing errors later.
// USED BY
//   App.tsx
// =============================================================================
import { useEffect, useState } from 'react'
import { Icon } from './Icon'

export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return (
    <div role="status" className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-warn px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-[13px] font-semibold text-white">
      <Icon name="wifiOff" className="size-4" />
      You are offline. Recording and submitting need internet.
    </div>
  )
}
