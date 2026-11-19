// Lets a page show its title in the desktop top bar.
import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'

export interface LayoutContext { setBarTitle: (t: string | null) => void }

export function useBarTitle(title: string) {
  const ctx = useOutletContext<LayoutContext | undefined>()
  const set = ctx?.setBarTitle
  useEffect(() => {
    set?.(title)
    return () => set?.(null)
  }, [set, title])
}
