// =============================================================================
// WHAT THIS FILE IS
//   The Change PIN screen. It is forced on first login (default PIN 0000) and
//   is optional afterwards.
// WHY IT EXISTS
//   Every imported user starts with 0000, which everyone knows. The guard in
//   RequireAuth blocks every other page until this has been completed.
//   The rules (any 4 digits except 0000; easy PINs like 1234 can be blocked
//   via app_settings.pin_block_easy_pins) are enforced in SQL by
//   change_my_pin(). The checks here only give faster feedback.
// USED BY
//   App.tsx route "/change-pin"
// =============================================================================
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { changePin } from '../../services/authService'
import { Button } from '../../components/ui/Button'
import { PinField } from '../../components/ui/PinField'
import { Icon } from '../../components/Icon'
import { Alert, Card } from '../../components/ui/Layout'
import { homeFor } from '../../types/auth'

export function ChangePinPage() {
  const { user, refreshProfile, logout } = useAuth()
  const navigate = useNavigate()
  const forced = Boolean(user?.must_change_pin)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (current.length !== 4 || next.length !== 4) { setError('Each PIN must be 4 digits.'); return }
    if (next !== confirm) { setError('The new PINs do not match.'); setConfirm(''); return }
    if (next === '0000') { setError('Please choose a PIN other than 0000.'); return }
    setBusy(true)
    setError(null)
    const res = await changePin(current, next)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not change PIN.'); setCurrent(''); return }
    await refreshProfile()
    navigate(homeFor(user), { replace: true })
  }

  return (
    <div className="flex min-h-full items-start justify-center px-4 py-10 md:items-center">
      <Card className="w-full max-w-sm p-6 md:p-8">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div>
            <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon name="lock" className="size-5" /></span>
            <h1 className="mt-4 font-serif text-[1.9rem] font-normal leading-tight tracking-[-0.02em]">{forced ? 'Set your own PIN' : 'Change PIN'}</h1>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {forced
                ? 'You are using the default PIN. Choose a new 4-digit PIN to continue.'
                : 'Enter your current PIN, then choose a new one.'}
            </p>
          </div>

          <PinField label={forced ? 'Current PIN (0000)' : 'Current PIN'} value={current} onChange={setCurrent} autoFocus />
          <div className="space-y-5 border-t border-line pt-5">
            <PinField label="New PIN" value={next} onChange={setNext} autoComplete="new-password" />
            <PinField label="Confirm new PIN" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <p className="-mt-2 text-xs text-muted">Any 4 digits except 0000.</p>
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          <div className="space-y-2 pt-1">
            <Button type="submit" size="lg" loading={busy} className="w-full">Save new PIN</Button>
            {forced
              ? <Button variant="ghost" size="lg" className="w-full" onClick={() => void logout()}>Sign out</Button>
              : <Button variant="ghost" size="lg" className="w-full" onClick={() => navigate(-1)}>Cancel</Button>}
          </div>
        </form>
      </Card>
    </div>
  )
}
