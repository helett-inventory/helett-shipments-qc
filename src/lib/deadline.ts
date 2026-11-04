import type { Shipment } from '../types/db'

// Amazon account-health rules for shipments that are not going out yet:
//   Drop In and Bluedart (they have an appointment): delete or reschedule at least 96 hours before the appointment.
//   ATS (collected on the dispatch date, counted from 00:00 that day): cancel at least 24 hours before.
export const APPOINTMENT_NOTICE_HOURS = 96
export const ATS_NOTICE_HOURS = 24
export const SOON_HOURS = 24 // badge turns orange
export const WATCH_HOURS = 48 // appears under "Deadline soon" and in the warning banner

const HOUR = 3_600_000
const ACTIVE = ['Created', 'QC In Progress', 'QC Done']

type Dated = Pick<Shipment, 'status' | 'dispatch_mode' | 'appointment_at' | 'dispatch_date'>

// The moment after which changing or cancelling this shipment counts against the account.
// null = nothing to watch (already dispatched, finished, or no date to count from).
export function changeDeadline(s: Dated): Date | null {
  if (!ACTIVE.includes(s.status)) return null
  if (s.dispatch_mode === 'ATS') {
    if (!s.dispatch_date) return null
    const [y, m, d] = s.dispatch_date.slice(0, 10).split('-').map(Number)
    // pickup = dispatch date 00:00, so 24 hours before is 00:00 the day before
    return new Date(y, m - 1, d, 0, 0, 0, 0 - ATS_NOTICE_HOURS * HOUR)
  }
  if (s.dispatch_mode === 'Drop In' || s.dispatch_mode === 'Bluedart') {
    if (!s.appointment_at) return null
    return new Date(new Date(s.appointment_at).getTime() - APPOINTMENT_NOTICE_HOURS * HOUR)
  }
  return null
}

export type Urgency = 'passed' | 'soon' | 'ok'

export function urgency(deadline: Date, now = Date.now()): Urgency {
  const ms = deadline.getTime() - now
  return ms < 0 ? 'passed' : ms < SOON_HOURS * HOUR ? 'soon' : 'ok'
}

export function withinWatch(deadline: Date | null, now = Date.now()): boolean {
  return !!deadline && deadline.getTime() - now < WATCH_HOURS * HOUR
}

// "2d 3h", "5h 20m", "40m"
function span(ms: number): string {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 60_000))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60
  if (days >= 1) return `${days}d ${hours}h`
  if (hours >= 1) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function untilText(deadline: Date, now = Date.now()): string {
  const ms = deadline.getTime() - now
  return ms < 0 ? `passed ${span(ms)} ago` : `in ${span(ms)}`
}

// Hours and minutes as H:MM, e.g. "72:20 hrs to go" or "Passed 5:05 hrs ago".
export function hoursText(deadline: Date, now = Date.now()): string {
  const ms = deadline.getTime() - now
  const total = Math.floor(Math.abs(ms) / 60_000)
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  return ms < 0 ? `Passed ${clock} hrs ago` : `${clock} hrs to go`
}

// Same, with seconds, for the live countdown on the shipment page: "72:20:05 hrs to go".
export function hmsText(deadline: Date, now = Date.now()): string {
  const ms = deadline.getTime() - now
  const total = Math.floor(Math.abs(ms) / 1000)
  const p2 = (n: number) => String(n).padStart(2, '0')
  const clock = `${Math.floor(total / 3600)}:${p2(Math.floor((total % 3600) / 60))}:${p2(total % 60)}`
  return ms < 0 ? `Passed ${clock} hrs ago` : `${clock} hrs to go`
}
