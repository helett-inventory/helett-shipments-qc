import { useEffect, useState } from 'react'
import { changeDeadline, hmsText, hoursText, urgency } from '../lib/deadline'
import { fmtShortDateTime } from '../lib/format'
import type { Shipment } from '../types/db'

// Re-renders every minute so "in 2h 5m" stays true while the page is open.
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}

const STYLE = {
  ok: 'text-ink',
  soon: 'text-warn',
  passed: 'text-fail'
} as const

// "72:20 hrs to go" as plain text. Black normally, orange under 24 hours, red once the deadline has passed. Hover shows the exact time.
export function DeadlineBadge({ shipment, seconds }: { shipment: Pick<Shipment, 'status' | 'dispatch_mode' | 'appointment_at' | 'dispatch_date'>; seconds?: boolean }) {
  const now = useNow(seconds ? 1000 : 60_000)
  const d = changeDeadline(shipment)
  if (!d) return null
  const level = urgency(d, now)
  return (
    <span
      className={`inline-block text-[13px] font-semibold tabular-nums whitespace-nowrap ${STYLE[level]}`}
      title={`Amazon deadline to cancel or reschedule: ${fmtShortDateTime(d.toISOString())}`}
    >
      {seconds ? hmsText(d, now) : hoursText(d, now)}
    </span>
  )
}
