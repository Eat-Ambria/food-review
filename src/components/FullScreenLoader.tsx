// =============================================================================
// WHAT THIS FILE IS
//   A centred spinner shown while the session is being restored on app start.
// WHY IT EXISTS
//   Without it, the login page flashes for a moment before a logged-in user is
//   recognised.
// =============================================================================
import { Spinner } from './ui/Spinner'

export function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <Spinner className="size-6" label="Loading" />
    </div>
  )
}
