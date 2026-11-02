import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Btn, Field, inputCls } from '../components/ui'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(email, password))
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">Helett Enterprises</h1>
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
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
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
