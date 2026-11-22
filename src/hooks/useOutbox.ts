// Starts sending any saved recordings when the app opens, comes back online or returns to the screen.
import { useEffect } from 'react'
import { runOutbox } from '../services/outbox'

export function useOutbox(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return
    const kick = () => void runOutbox(userId)
    const onVisible = () => { if (document.visibilityState === 'visible') kick() }
    kick()
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId])
}
