// Shows a spinner while the app checks who is signed in.
import { Spinner } from './ui/Spinner'

export function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <Spinner className="size-6" label="Loading" />
    </div>
  )
}
