const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' is a calendar date, not an instant: parse it as local so the
// day never shifts with the viewer's timezone.
function parseDateOnly(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  const d = s.length === 10 ? parseDateOnly(s) : new Date(s)
  if (!d || isNaN(d.getTime())) return s
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtTime(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtTimeSec(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return ''
  return `${fmtDate(s)}, ${fmtTime(s)}`
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// <input type="datetime-local"> value from an ISO instant, in local time.
export function toLocalInput(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// Calendar-day helpers for grouping by dispatch date (all local time).
export function addDaysISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "Mon 02 Nov 2026" from a YYYY-MM-DD string.
export function fmtDayLong(s: string): string {
  const d = parseDateOnly(s)
  if (!d) return s
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${wd} ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// "28 Oct, 14:00" (no year), for tight spaces.
export function fmtShortDateTime(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
