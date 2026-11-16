// A date range for the dashboard: a preset ("Last 30 days") or two days picked on the calendar.
// `from` / `to` are instants (start of the first day, end of the last day); null means no limit.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface DRange {
  id: string // preset id, or 'custom'
  title: string // "Last 30 days"
  label: string // lower-case phrase for sentences: "last 30 days"
  from: number | null
  to: number | null
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
export const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export const fmtShort = (ms: number, withYear = false) => {
  const d = new Date(ms)
  return `${d.getDate()} ${MON[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`
}

// "14 Oct to 12 Nov 2026" (the year is shown once, or on both ends when they differ)
export function spanText(r: DRange): string {
  if (r.from == null || r.to == null) return 'Everything so far'
  const a = new Date(r.from)
  const b = new Date(r.to)
  const sameYear = a.getFullYear() === b.getFullYear()
  return `${fmtShort(r.from, !sameYear)} to ${fmtShort(r.to, true)}`
}

export const PRESET_IDS = ['7', '30', '90', 'month', 'lastmonth', 'year', 'all'] as const

export function preset(id: string, now = new Date()): DRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const last = (n: number): DRange => ({ id, title: `Last ${n} days`, label: `last ${n} days`, from: startOfDay(addDays(today, -(n - 1))), to: endOfDay(today) })
  switch (id) {
    case '7':
      return last(7)
    case '90':
      return last(90)
    case 'month':
      return { id, title: 'This month', label: 'this month', from: startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: endOfDay(today) }
    case 'lastmonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0)
      return { id, title: 'Last month', label: 'last month', from: startOfDay(first), to: endOfDay(lastDay) }
    }
    case 'year':
      return { id, title: 'This year', label: 'this year', from: startOfDay(new Date(today.getFullYear(), 0, 1)), to: endOfDay(today) }
    case 'all':
      return { id, title: 'All time', label: 'all time', from: null, to: null }
    default:
      return last(30)
  }
}

export const PRESETS = PRESET_IDS.map((id) => ({ id, title: preset(id).title }))

export function customRange(a: Date, b: Date): DRange {
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a]
  const r: DRange = { id: 'custom', title: 'Custom range', label: '', from: startOfDay(from), to: endOfDay(to) }
  r.label = from.getTime() === to.getTime() ? `on ${fmtShort(r.from!, true)}` : spanText(r)
  return r
}
