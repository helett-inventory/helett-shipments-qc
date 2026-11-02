import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { errText, supabase } from '../lib/supabase'
import { clearCache, hydrate } from '../lib/cache'
import type { Profile } from '../types/db'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  // Set when signed in but the account details could not be loaded (offline, timeout, database error).
  problem: string | null
  retry: () => void
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

const PROFILE_TIMEOUT_MS = 10000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
        if (!data.session) setLoading(false)
      })
      .catch((e) => {
        setProblem(errText(e))
        setLoading(false)
      })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        clearCache() // nothing from this user stays on the device after sign-out
        setProfile(null)
        setLoading(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    hydrate(userId)
    let cancelled = false
    setProblem(null)
    setLoading(true)
    // Never sit on "Loading" forever: give up after a while and say why.
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setProblem('Loading your account is taking too long. Check your connection.')
      setLoading(false)
    }, PROFILE_TIMEOUT_MS)

    Promise.resolve(supabase.from('profiles').select('*').eq('id', userId).maybeSingle())
      .then(({ data, error }) => {
        if (cancelled) return
        window.clearTimeout(timer)
        if (error) setProblem(error.message)
        else setProfile((data as Profile | null) ?? null)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        window.clearTimeout(timer)
        setProblem(errText(e))
        setLoading(false)
      })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [userId, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    return error ? error.message : null
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return <Ctx.Provider value={{ session, profile, loading, problem, retry, signIn, signOut }}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
