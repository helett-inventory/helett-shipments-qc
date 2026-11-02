import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// A placeholder URL keeps createClient from throwing at import time when the
// env vars are missing; App.tsx shows a setup screen instead of using it.
export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true }
})

const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i

// What a person should read when the connection dropped, instead of "TypeError: Failed to fetch".
export function errText(e: unknown): string {
  const raw = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (NETWORK_FAILURE.test(raw)) return 'Could not reach the server. Check your connection and press the button again.'
  return raw
}

// A phone or PC freezes a background app; its connection to the server goes stale and the first
// request afterwards fails with "Failed to fetch". Waking the connection first avoids that.
let lastOk = Date.now()
const IDLE_MS = 120_000

export async function wake(): Promise<void> {
  try {
    await supabase.auth.getSession() // refreshes the login if it expired while asleep
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 3; i++) {
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1)
      if (!error || !NETWORK_FAILURE.test(error.message)) break
    } catch {
      /* try again */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  lastOk = Date.now()
}

export async function wakeIfIdle(): Promise<void> {
  if (Date.now() - lastOk > IDLE_MS) await wake()
}

// supabase.rpc, but wakes a sleeping connection first so a save after hours in the background just works.
export async function callRpc(name: string, args?: Record<string, unknown>) {
  await wakeIfIdle()
  const res = await supabase.rpc(name, args as never)
  if (!res.error) lastOk = Date.now()
  return res
}
