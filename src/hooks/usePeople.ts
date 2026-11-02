import { useEffect, useState } from 'react'
import { getProfiles } from '../services/lookups'
import type { Profile } from '../types/db'

// Names for "who is confirming" dropdowns: people who have an account,
// filtered by what they are allowed to confirm. Never typed by hand.
export function usePeople(filter: (p: Profile) => boolean, always: string[] = []): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let live = true
    getProfiles()
      .then((all) => {
        if (!live) return
        const people = all.filter(filter).map((p) => p.name)
        setNames([...new Set([...people, ...always.filter(Boolean)])])
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return names
}
