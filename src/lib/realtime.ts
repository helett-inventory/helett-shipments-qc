import { supabase, wake } from './supabase'
import { invalidateAll, invalidateTables } from './cache'

const TABLES = ['shipments', 'shipment_lines', 'inspections', 'fnsku_checks', 'box_label_checks', 'dispatches', 'dispatch_lines']

// One shared subscription for the whole app. A database change marks the
// cached data that depends on that table as stale, and any open page that
// shows it refetches. Pages that are not open refetch the next time they open.
export function startRealtime(): () => void {
  const pending = new Set<string>()
  let timer: number | undefined
  const flush = () => {
    const tables = [...pending]
    pending.clear()
    invalidateTables(tables)
  }

  const channel = supabase.channel('app-cache')
  for (const table of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      pending.add(table)
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, 250)
    })
  }

  // After a dropped connection we may have missed events: treat everything as stale.
  let wasDown = false
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (wasDown) invalidateAll()
      wasDown = false
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      wasDown = true
    }
  })

  // Away from the tab for a while: events may have been throttled.
  let hiddenAt = 0
  const onVisible = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > 30_000) wake().then(invalidateAll)
  }
  const onOnline = () => wake().then(invalidateAll)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)

  return () => {
    window.clearTimeout(timer)
    supabase.removeChannel(channel)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}
