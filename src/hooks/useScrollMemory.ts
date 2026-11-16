import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// Every page keeps its own scroll position for the session:
//  - a page you have not opened yet starts at the top (it does not inherit the previous page's scroll);
//  - coming back to a page puts you where you left it, even after a refresh (sessionStorage, this tab only).
// Pages load their data after they appear, so a saved position is applied once the page is tall enough.

const STORE = 'helett.scroll'
let positions: Record<string, number> = {}
try {
  positions = JSON.parse(sessionStorage.getItem(STORE) || '{}')
} catch {
  positions = {}
}
let saveTimer: number | undefined
function persist() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(positions))
    } catch {
      /* storage blocked: positions are still kept while the app is open */
    }
  }, 150)
}

export function useScrollMemory() {
  const { pathname, search } = useLocation()
  const key = pathname + search
  const keyRef = useRef(key)

  // the browser must not also try to restore scroll by itself
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  }, [])

  // remember the position of whichever page is showing
  useEffect(() => {
    let timer = 0
    const onScroll = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        positions[keyRef.current] = window.scrollY
        persist()
      }, 60)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // on every page change: top for a new page, the saved spot for one seen before
  useLayoutEffect(() => {
    keyRef.current = key
    const target = positions[key] ?? 0
    if (target <= 0) {
      window.scrollTo(0, 0)
      return
    }
    let cancelled = false
    const t0 = performance.now()
    const stop = () => {
      cancelled = true
    }
    // if the person scrolls themselves while the page is still loading, leave them alone
    const events: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'keydown', 'pointerdown']
    events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }))
    const step = () => {
      if (cancelled) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max >= target - 1 || performance.now() - t0 > 2500) {
        window.scrollTo(0, target)
        return
      }
      window.scrollTo(0, Math.max(0, max))
      retry = window.setTimeout(step, 50)
    }
    let retry = 0
    step()
    return () => {
      cancelled = true
      window.clearTimeout(retry)
      events.forEach((e) => window.removeEventListener(e, stop))
    }
  }, [key])
}
