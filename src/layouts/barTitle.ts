// =============================================================================
// WHAT THIS FILE IS
//   Lets a page put its title in the desktop top bar (left of the search box)
//   instead of a big heading in the page.
// WHY IT EXISTS
//   Dense pages (Issues) need every pixel for content, so their title sits in
//   the top bar, as in the design mockup. Pages with a normal PageHeader don't
//   use this.
//     useBarTitle('Issues')   → shows "Issues" in the bar while the page is open
// USED BY
//   layouts/AppLayout.tsx (provides it), pages/Issues/IssuesPage.tsx
// =============================================================================
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
