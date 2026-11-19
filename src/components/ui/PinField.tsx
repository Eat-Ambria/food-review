// The 4-box PIN input with a blinking cursor.
import { useId, useState } from 'react'

export function PinField({ label, value, onChange, autoFocus, invalid, autoComplete = 'current-password' }: {
  label: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  invalid?: boolean
  autoComplete?: string
}) {
  const id = useId()
  const [focused, setFocused] = useState(false)

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">{label}</label>
      <div className="relative">
        <input
          id={id}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
          aria-invalid={invalid}
        />
        <div className="grid grid-cols-4 gap-2.5" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => {
            const filled = i < value.length
            const active = focused && i === Math.min(value.length, 3)
            return (
              <div key={i}
                className={`flex h-14 items-center justify-center rounded-lg border bg-surface transition-[border-color,box-shadow]
                  ${invalid ? 'border-danger' : active ? 'border-ink/45 ring-[3px] ring-ink/[0.06]' : filled ? 'border-line-strong' : 'border-line'}`}>
                {filled && <span className="size-2.5 rounded-full bg-ink" />}

                {active && !filled && <span className="pin-caret h-6 w-[2px] rounded-full bg-ink" />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
