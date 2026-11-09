import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Btn, Field, inputCls } from '../components/ui'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(email, password))
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">Helett</h1>
        <p className="text-muted mt-1 mb-8">Sign in to manage shipments and QC.</p>
        <Field label="Email">
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Password">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls} pr-16`}
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setShow((v) => !v)
              }}
              aria-pressed={show}
              className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] px-3 rounded-md text-sm font-medium text-muted hover:text-ink"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>
        {error && (
          <p role="alert" className="text-fail text-sm mb-3">
            {error}
          </p>
        )}
        <Btn type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Btn>
      </form>
    </div>
  )
}
