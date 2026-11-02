// Local cache for everything the app reads.
//
//  - A page shows cached data at once and only asks the database again when the
//    data is stale: a change was announced by realtime, the connection dropped,
//    the tab was away for a while, or the entry is older than MAX_AGE_MS.
//  - Entries are saved to localStorage so a reload or reopened app paints
//    instantly; they are re-checked once in the background (marked stale on load).
//  - It is cleared on sign-out and never shared between users.

interface Entry {
  data: unknown
  at: number
  stale: boolean
  tables: string[]
}

interface Listener {
  tables: string[]
  refetch: () => void
}

const STORAGE_KEY = 'helett-cache-v1'
const MAX_STORAGE_CHARS = 2_000_000
// Safety net if a realtime event is ever missed.
export const MAX_AGE_MS = 5 * 60 * 1000

const store = new Map<string, Entry>()
const listeners = new Map<string, Set<Listener>>()
let userId: string | null = null
let saveTimer: number | undefined

/* ------------------------------------------------------------ persistence */

export function hydrate(uid: string) {
  if (userId === uid) return
  userId = uid
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { userId: string; entries: Record<string, { data: unknown; at: number; tables: string[] }> }
    if (saved.userId !== uid) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    for (const [k, v] of Object.entries(saved.entries)) {
      if (!store.has(k)) store.set(k, { data: v.data, at: v.at, tables: v.tables, stale: true })
    }
  } catch {
    /* private mode or corrupt value: just start empty */
  }
}

function persist() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      const entries: Record<string, { data: unknown; at: number; tables: string[] }> = {}
      store.forEach((e, k) => {
        entries[k] = { data: e.data, at: e.at, tables: e.tables }
      })
      const json = JSON.stringify({ userId, entries })
      if (json.length < MAX_STORAGE_CHARS) localStorage.setItem(STORAGE_KEY, json)
    } catch {
      /* quota or private mode */
    }
  }, 1000)
}

/* ------------------------------------------------------------ queries */

export function getEntry(key: string): Entry | undefined {
  return store.get(key)
}

export function setEntry(key: string, data: unknown, tables: string[]) {
  store.set(key, { data, at: Date.now(), stale: false, tables })
  persist()
}

export function isFresh(e: Entry): boolean {
  return !e.stale && Date.now() - e.at < MAX_AGE_MS
}

// A mounted page registers here so it refetches the moment its data is invalidated.
export function subscribeQuery(key: string, l: Listener): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(l)
  return () => {
    set!.delete(l)
  }
}

export function invalidateTables(tables: string[]) {
  store.forEach((e) => {
    if (e.tables.some((t) => tables.includes(t))) e.stale = true
  })
  listeners.forEach((set) =>
    set.forEach((l) => {
      if (l.tables.some((t) => tables.includes(t))) l.refetch()
    })
  )
}

export function invalidateAll() {
  store.forEach((e) => {
    e.stale = true
  })
  listeners.forEach((set) => set.forEach((l) => l.refetch()))
}

export function clearCache() {
  store.clear()
  lookups.clear()
  inflight.clear()
  userId = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------ lookups */

// Lists that almost never change (products, people): fetched once and reused for ttlMs.
const lookups = new Map<string, { data: unknown; at: number }>()
const inflight = new Map<string, Promise<unknown>>()

export async function cachedLookup<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const hit = lookups.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const p = fetcher()
    .then((data) => {
      lookups.set(key, { data, at: Date.now() })
      return data
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export function forgetLookup(key: string) {
  lookups.delete(key)
}
