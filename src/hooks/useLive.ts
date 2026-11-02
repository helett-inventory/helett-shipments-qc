import { useCallback, useEffect, useRef, useState } from 'react'
import { getEntry, isFresh, setEntry, subscribeQuery } from '../lib/cache'
import { errText } from '../lib/supabase'

// Reads a query through the local cache (src/lib/cache.ts):
//  - cached data shows immediately, with no loading flash;
//  - the database is only asked again when the cached data is stale (a change was
//    announced, the connection dropped, or it is old) or when there is nothing cached;
//  - while the page is open, a change to any of `tables` refetches it.
// `key` identifies the query: change it (for example the id in the URL) to read a different one.
export function useLive<T>(fetcher: () => Promise<T>, tables: string[], key: string) {
  const first = getEntry(key)
  const [data, setData] = useState<T | null>(() => (first?.data as T | undefined) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!first)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const keyRef = useRef(key)
  keyRef.current = key
  const tablesRef = useRef(tables)
  tablesRef.current = tables

  const running = useRef(false)
  const queued = useRef(false)

  const reload = useCallback(async () => {
    // One request at a time; a change that lands meanwhile triggers exactly one more.
    if (running.current) {
      queued.current = true
      return
    }
    running.current = true
    const forKey = keyRef.current
    try {
      const d = await fetcherRef.current()
      setEntry(forKey, d, tablesRef.current)
      if (keyRef.current === forKey) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      running.current = false
      setLoading(false)
      if (queued.current) {
        queued.current = false
        reload()
      }
    }
  }, [])

  useEffect(() => {
    const entry = getEntry(key)
    if (entry) {
      setData(entry.data as T)
      setLoading(false)
      if (!isFresh(entry)) reload() // show the cached copy now, refresh in the background
    } else {
      setData(null)
      setLoading(true)
      reload()
    }
    return subscribeQuery(key, { tables, refetch: reload })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, error, loading, reload }
}
