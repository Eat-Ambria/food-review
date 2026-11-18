// =============================================================================
// WHAT THIS FILE IS
//   The sign-in screen: username + 4-digit PIN.
// WHY IT EXISTS
//   It is the only way into the app. The check itself happens on the server
//   (auth-login Edge Function). This page only collects input and shows the
//   result, including "x attempts left" and the lock message.
//   "Keep me signed in" (on by default) keeps the session after the app is
//   closed, and also remembers the username so it is pre-filled next time.
//   Turn it off on a shared phone. The PIN itself is never stored by the app.
// USED BY
//   App.tsx route "/login"
// =============================================================================
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
    setRememberMe(remember) // must happen before login, so the session is stored in the right place
    const res = await login(username, pin)
    if (res.ok) {
      try {
        if (remember) localStorage.setItem(LAST_USERNAME_KEY, username.trim().toLowerCase())
        else localStorage.removeItem(LAST_USERNAME_KEY)
      } catch { /* storage blocked: not important */ }
    }
    setBusy(false)
    if (!res.ok) {
      setPin('')
      setError(res.attemptsLeft !== undefined && res.attemptsLeft > 0
        ? `${res.message} ${res.attemptsLeft} attempt${res.attemptsLeft === 1 ? '' : 's'} left before the account locks.`
        : res.message)
    }
    // On success the <Navigate> above takes over on the next render.
  }

  return (
    <div className="relative flex min-h-full flex-col md:flex-row">
      {/* White silk waves behind the form side (same as inside the app). */}
      <svg aria-hidden="true" className="silk" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <path d="M-40 760 C 240 640, 520 820, 820 700 S 1300 520, 1500 600 L 1500 960 L -40 960 Z" fill="#ffffff" fillOpacity="0.55" />
        <path d="M600 900 C 820 760, 1040 700, 1220 520 S 1420 260, 1520 230 L 1520 960 L 600 960 Z" fill="#ffffff" fillOpacity="0.45" />
      </svg>
      {/* Brand panel: navy, with what the app does, as the three steps it really is. */}
      <section className="relative z-10 flex flex-col overflow-hidden bg-[linear-gradient(180deg,#1a2335_0%,#141c2c_100%)] px-6 pb-10 pt-[max(2rem,env(safe-area-inset-top))] text-white md:w-[42%] md:max-w-xl md:justify-between md:px-12 md:py-12">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-11 shrink-0" />
          <p className="font-serif text-[2rem] leading-none">Ambria</p>
          <span className="mt-1 text-sm font-medium text-white/50">Issue Desk</span>
        </div>

        <div className="mt-8 md:mt-0">
          <h1 className="max-w-md font-serif text-[2.1rem] font-normal leading-[1.1] tracking-[-0.02em] md:text-[3.1rem]">
            Say what went wrong. The right people see it.
          </h1>
          <span aria-hidden="true" className="mt-5 block h-0.5 w-14 rounded-full bg-marigold" />
          <ol className="mt-10 hidden max-w-sm md:block">
            {[
              ['Record', 'Describe the complaint in Hindi, English or both.'],
              ['Split', 'Each problem becomes its own issue, matched to the event.'],
              ['Notify', 'Every POC is notified on their phone.'],
            ].map(([title, text], i) => (
              <li key={title} className="relative flex gap-4 pb-7 last:pb-0">
                {i < 2 && <span aria-hidden="true" className="absolute left-[13px] top-8 bottom-1 w-px bg-white/15" />}
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-marigold/50 text-xs font-bold text-marigold">{i + 1}</span>
                <span className="pt-0.5">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-white/60">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative z-10 mt-10 hidden text-xs text-white/40 md:block">Pushpanjali · Manaktala · Exotica · Restro</p>
        {/* Thin marigold thread, like the app's sidebar. */}
        <svg aria-hidden="true" viewBox="0 0 272 140" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-48 w-full md:block">
          <defs>
            <linearGradient id="login-thread" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#e0a225" stopOpacity="0" />
              <stop offset="0.5" stopColor="#e0a225" stopOpacity="0.8" />
              <stop offset="1" stopColor="#e0a225" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <path className="thread" d="M0 128 C 80 126, 130 104, 180 68 S 252 22, 272 16" fill="none" stroke="url(#login-thread)" strokeWidth="1.2" />
        </svg>
      </section>

      {/* Form */}
      <section className="relative z-10 flex flex-1 items-start justify-center px-5 py-8 md:items-center md:px-10">
        <div className="w-full max-w-[24rem] rounded-[1.75rem] border border-white/90 bg-white/80 p-6 shadow-float backdrop-blur-sm md:p-9">
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="mb-7">
              <h2 className="font-serif text-[2.1rem] font-normal leading-none tracking-[-0.02em]">Sign in</h2>
              <span aria-hidden="true" className="mt-3 block h-0.5 w-10 rounded-full bg-marigold" />
              <p className="mt-3 text-sm text-muted">Use the username and PIN your admin gave you.</p>
            </div>

            {!supabaseConfigured && (
              <Alert tone="danger">App is not configured: .env is missing the Supabase URL or key.</Alert>
            )}

            <div>
              <Label htmlFor="username">Username</Label>
              <input id="username" autoFocus={!username} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                autoComplete="username" placeholder="e.g. rahul.sharma"
                value={username} onChange={(e) => setUsername(e.target.value)}
                className={inputClass('lg')} />
            </div>

            <PinField label="PIN" value={pin} onChange={setPin} invalid={Boolean(error)} autoFocus={Boolean(username)} />

            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                className="mt-0.5 size-4 cursor-pointer accent-ink" />
              <span className="text-sm">
                <span className="font-semibold">Keep me signed in</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">Untick on a shared phone. You will be signed out when the browser closes.</span>
              </span>
            </label>

            {error && <Alert tone="danger">{error}</Alert>}

            <Button type="submit" size="lg" loading={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>

          <p className="mt-8 border-t border-line pt-5 text-center text-xs text-muted">Forgot your PIN? Ask your admin to reset it.</p>
        </div>
      </section>
    </div>
  )
}
