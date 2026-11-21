// Sign-in screen (username + 4-digit PIN).
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRememberMe, setRememberMe, supabaseConfigured } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { PinField } from '../../components/ui/PinField'
import { Alert } from '../../components/ui/Layout'
import { Label, inputClass } from '../../components/ui/Field'
import { homeFor } from '../../types/auth'
import { BrandMark } from '../../components/BrandMark'
import { Icon } from '../../components/Icon'

const LAST_USERNAME_KEY = 'issue-desk-last-username'

function readLastUsername(): string {
  try { return getRememberMe() ? localStorage.getItem(LAST_USERNAME_KEY) ?? '' : '' } catch { return '' }
}

export function LoginPage() {
  const { user, login } = useAuth()
  const [username, setUsername] = useState(readLastUsername)
  const [remember, setRemember] = useState(getRememberMe)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={user.must_change_pin ? '/change-pin' : homeFor(user)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!username.trim() || pin.length !== 4) { setError('Enter your username and 4-digit PIN.'); return }
    setBusy(true)
    setError(null)
    setRememberMe(remember)
    const res = await login(username, pin)
    if (res.ok) {
      try {
        if (remember) localStorage.setItem(LAST_USERNAME_KEY, username.trim().toLowerCase())
        else localStorage.removeItem(LAST_USERNAME_KEY)
      } catch { }
    }
    setBusy(false)
    if (!res.ok) {
      setPin('')
      setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
        ? `${res.message} ${res.attemptsLeft} attempt${res.attemptsLeft === 1 ? '' : 's'} left before the account locks.`
        : res.message)
    }

  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center px-5 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">

      <svg aria-hidden="true" className="silk" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path d="M-40 760 C 240 640, 520 820, 820 700 S 1300 520, 1500 600 L 1500 960 L -40 960 Z" fill="#ffffff" fillOpacity="0.55" />
        <path d="M600 900 C 820 760, 1040 700, 1220 520 S 1420 260, 1520 230 L 1520 960 L 600 960 Z" fill="#ffffff" fillOpacity="0.45" />
      </svg>

      <div className="relative z-10 w-full max-w-[25rem]">

        <header className="text-center">
          <BrandMark className="mx-auto size-12 drop-shadow-[0_8px_18px_rgb(224_162_37/0.28)]" />
          <p className="mt-3 text-[13px] font-semibold tracking-wide text-muted">
            <span className="font-serif text-[1.05rem] font-normal tracking-normal text-ink">Ambria</span>
            <span className="mx-1.5 text-line-strong">|</span>food review
          </p>
          <h1 className="mt-6 font-serif text-[2rem] font-normal leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.35rem]">
            Say what went wrong.<br />The right people see it.
          </h1>
        </header>

        <div className="mt-8 rounded-2xl border border-line/80 bg-white p-6 shadow-float sm:p-7">
          <form onSubmit={submit} className="space-y-5" noValidate>
            {!supabaseConfigured && (
              <Alert tone="danger">App is not configured: .env is missing the Supabase URL or key.</Alert>
            )}

            <div>
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <Icon name="user" className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-faint" />
                <input id="username" autoFocus={!username} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  autoComplete="username" placeholder="e.g. rahul sharma"
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  className={inputClass('lg', 'pl-11')} />
              </div>
            </div>

            <PinField label="PIN" value={pin} onChange={setPin} invalid={Boolean(error)} autoFocus={Boolean(username)} />

            <label className="flex cursor-pointer items-center gap-2.5" title="Untick on a shared phone: you will be signed out when the browser closes.">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                className="size-4 cursor-pointer rounded accent-ink" />
              <span className="text-sm font-medium">Keep me signed in</span>
            </label>

            {error && <Alert tone="danger">{error}</Alert>}

            <Button type="submit" size="lg" loading={busy} className="w-full">
              {busy ? 'Signing in…' : <>Sign in<Icon name="arrowLeft" className="rotate-180" /></>}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted">Forgot your PIN? Ask your admin to reset it.</p>
      </div>
    </div>
  )
}
