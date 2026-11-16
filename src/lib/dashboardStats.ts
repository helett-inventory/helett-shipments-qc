// All dashboard numbers, computed in the browser from one query. Pure functions, no React.

const DAY = 86_400_000

export interface DShipment {
  id: string
  fba_id: string
  warehouse: string
  created_at: string
  dispatch_date: string | null
  dispatch_mode: string | null
  status: string
  on_hold: boolean
  shipment_lines: { id: string; asin: string; product_name: string; unit_qty: number; status: string; received_qty: number | null; received_at: string | null }[]
  dispatches: { id: string; dispatched_at: string; wm_approved_at: string | null; dispatch_lines: { line_id: string; units: number }[] }[]
}
export interface DInspection {
  id: string
  line_id: string
  status: string
  inspected_qty: number
  accepted_qty: number
  rejected_qty: number
  submitted_at: string | null
}
export interface DashboardData {
  ships: DShipment[]
  insps: DInspection[]
}

import type { DRange } from './dateRange'

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN)
const sum = (a: number[]) => a.reduce((n, v) => n + v, 0)
const avg = (a: number[]) => (a.length ? sum(a) / a.length : null)
const median = (a: number[]) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const localDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const mondayOf = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (ms: number) => `${new Date(ms).getDate()} ${MON[new Date(ms).getMonth()]}`

export interface Duration {
  label: string
  from: string
  to: string
  avgDays: number | null
  medianDays: number | null
  n: number
}

export function computeDashboard(data: DashboardData, range: DRange, now = Date.now()) {
  const since = range.from ?? 0
  const until = range.to ?? Infinity
  const inRange = (ms: number) => !isNaN(ms) && ms >= since && ms <= until

  const ships = data.ships.filter((s) => s.status !== 'Cancelled')
  const live = (s: DShipment) => s.shipment_lines.filter((l) => l.status !== 'Cancelled')
  const open = ships.filter((s) => s.status !== 'Closed')

  // lookups
  const lineShip = new Map<string, DShipment>()
  const lineInfo = new Map<string, DShipment['shipment_lines'][number]>()
  for (const s of data.ships)
    for (const l of s.shipment_lines) {
      lineShip.set(l.id, s)
      lineInfo.set(l.id, l)
    }
  const sentByLine = new Map<string, number>()
  const lastSentAt = new Map<string, number>() // line -> latest dispatch time
  for (const s of data.ships)
    for (const d of s.dispatches)
      for (const dl of d.dispatch_lines) {
        sentByLine.set(dl.line_id, (sentByLine.get(dl.line_id) ?? 0) + dl.units)
        lastSentAt.set(dl.line_id, Math.max(lastSentAt.get(dl.line_id) ?? 0, t(d.dispatched_at)))
      }
  const inspByLine = new Map<string, DInspection>()
  for (const i of data.insps) inspByLine.set(i.line_id, i)

  const dispatches = ships.flatMap((s) => s.dispatches.map((d) => ({ s, d, at: t(d.dispatched_at), units: sum(d.dispatch_lines.map((x) => x.units)) })))
  const dispatchesIn = dispatches.filter((x) => inRange(x.at))
  const createdIn = ships.filter((s) => inRange(t(s.created_at)))
  const inspIn = data.insps.filter((i) => i.status !== 'Open' && inRange(t(i.submitted_at)))

  // ------------------------------------------------------------- top numbers
  const openShipments = open.length
  const onHold = open.filter((s) => s.on_hold).length
  const toShip = sum(open.flatMap((s) => live(s).map((l) => Math.max(0, l.unit_qty - (sentByLine.get(l.id) ?? 0)))))
  const dispatchedUnits = sum(dispatchesIn.map((x) => x.units))

  // Amazon receiving: shipments fully dispatched and confirmed that still have units not marked received
  const receiving = ships
    .filter((s) => s.status === 'Closed')
    .map((s) => {
      const pending = sum(live(s).map((l) => Math.max(0, l.unit_qty - (l.received_qty ?? 0))))
      const last = Math.max(0, ...s.dispatches.map((d) => t(d.dispatched_at)).filter((v) => !isNaN(v)))
      return { s, pending, ageDays: last ? Math.max(0, (now - last) / DAY) : 0 }
    })
    .filter((r) => r.pending > 0)
  const pendingReceive = sum(receiving.map((r) => r.pending))
  const oldestReceive = receiving.length ? Math.max(...receiving.map((r) => r.ageDays)) : 0

  const inspected = sum(inspIn.map((i) => i.inspected_qty))
  const accepted = sum(inspIn.map((i) => i.accepted_qty))
  const rejected = sum(inspIn.map((i) => i.rejected_qty))
  const passRate = inspected ? (accepted / inspected) * 100 : null

  const withPlan = dispatchesIn.filter((x) => x.s.dispatch_date)
  const onTime = withPlan.filter((x) => localDay(x.at) <= x.s.dispatch_date!).length
  const onTimeRate = withPlan.length ? (onTime / withPlan.length) * 100 : null

  // ------------------------------------------------------------- charts
  const thisMonday = mondayOf(now)
  const weeks = Array.from({ length: 12 }, (_, i) => thisMonday - (11 - i) * 7 * DAY)
  const weekIdx = (ms: number) => {
    if (isNaN(ms)) return -1
    const m = mondayOf(ms)
    return weeks.indexOf(m)
  }
  const weekly = weeks.map((w) => ({ label: `${dayLabel(w)} week`, a: 0, b: 0 }))
  for (const s of ships) {
    const k = weekIdx(t(s.created_at))
    if (k >= 0) weekly[k].a++
  }
  for (const x of dispatches) {
    const k = weekIdx(x.at)
    if (k >= 0) weekly[k].b++
  }

  // Daily chart: the chosen days (at most the last 120 of them; "all time" shows the last 90).
  const endMs = Math.min(range.to ?? now, now)
  const startMs = range.from ?? endMs - 89 * DAY
  const endDay = new Date(endMs)
  endDay.setHours(0, 0, 0, 0)
  const startDay = new Date(startMs)
  startDay.setHours(0, 0, 0, 0)
  const span = Math.min(120, Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / DAY) + 1))
  const dayStarts = Array.from({ length: span }, (_, i) => {
    const d = new Date(endDay)
    d.setDate(d.getDate() - (span - 1 - i))
    return d.getTime()
  })
  const perDay = new Map(dayStarts.map((d) => [localDay(d), 0]))
  for (const x of dispatches) {
    const k = localDay(x.at)
    if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + x.units)
  }
  const daily = { values: dayStarts.map((d) => perDay.get(localDay(d)) ?? 0), labels: dayStarts.map(dayLabel) }

  const STAGES = ['Created', 'QC In Progress', 'QC Done', 'Partially Dispatched', 'Dispatched'] as const
  const pipeline = STAGES.map((st) => ({ label: st === 'QC In Progress' ? 'QC in progress' : st === 'QC Done' ? 'Ready to dispatch' : st === 'Created' ? 'Waiting for QC' : st, value: ships.filter((s) => s.status === st).length }))

  // Units dispatched in the range, by how the shipment goes out (ATS, Drop In, Bluedart).
  const KNOWN = ['ATS', 'Drop In', 'Bluedart']
  const modeOf = (m: string | null) => (m && KNOWN.includes(m) ? m : 'Other')
  const modes = [...KNOWN, 'Other'].map((label) => {
    const rows = dispatchesIn.filter((x) => modeOf(x.s.dispatch_mode) === label)
    return { label, units: sum(rows.map((x) => x.units)), shipments: new Set(rows.map((x) => x.s.id)).size }
  }).filter((m) => m.label !== 'Other' || m.units > 0)

  // ------------------------------------------------------------- analytics
  const durations: Duration[] = []
  const mk = (label: string, from: string, to: string, vals: number[]) =>
    durations.push({ label, from, to, avgDays: avg(vals), medianDays: median(vals), n: vals.length })

  mk(
    'Shipment to QC submitted',
    'Shipment created',
    'QC submitted',
    inspIn.map((i) => {
      const s = lineShip.get(i.line_id)
      return s ? (t(i.submitted_at) - t(s.created_at)) / DAY : NaN
    }).filter((v) => v >= 0)
  )
  const qcToDispatch: number[] = []
  const dispatchToApproval: number[] = []
  for (const x of dispatchesIn) {
    for (const dl of x.d.dispatch_lines) {
      const i = inspByLine.get(dl.line_id)
      const v = i?.submitted_at ? (x.at - t(i.submitted_at)) / DAY : NaN
      if (v >= 0) qcToDispatch.push(v)
    }
    if (x.d.wm_approved_at) {
      const v = (t(x.d.wm_approved_at) - x.at) / DAY
      if (v >= 0) dispatchToApproval.push(v)
    }
  }
  mk('QC submitted to dispatched', 'QC submitted', 'Dispatched', qcToDispatch)
  mk('Dispatched to manager approval', 'Dispatched', 'Approved', dispatchToApproval)
  const dispatchToReceived: number[] = []
  for (const l of lineInfo.values()) {
    const rec = t(l.received_at)
    const sent = lastSentAt.get(l.id)
    if (inRange(rec) && sent) {
      const v = (rec - sent) / DAY
      if (v >= 0) dispatchToReceived.push(v)
    }
  }
  mk('Dispatched to received at Amazon', 'Dispatched', 'Received', dispatchToReceived)

  const ageBuckets = [
    { label: '0 to 3 days', lo: 0, hi: 4 },
    { label: '4 to 7 days', lo: 4, hi: 8 },
    { label: '8 to 14 days', lo: 8, hi: 15 },
    { label: '15 days or more', lo: 15, hi: Infinity }
  ].map((b) => ({ label: b.label, value: sum(receiving.filter((r) => r.ageDays >= b.lo && r.ageDays < b.hi).map((r) => r.pending)), shipments: receiving.filter((r) => r.ageDays >= b.lo && r.ageDays < b.hi).length }))

  // products
  const prod = new Map<string, { name: string; dispatched: number; toShip: number; inspected: number; accepted: number }>()
  const P = (asin: string, name: string) => {
    if (!prod.has(asin)) prod.set(asin, { name, dispatched: 0, toShip: 0, inspected: 0, accepted: 0 })
    return prod.get(asin)!
  }
  for (const x of dispatchesIn)
    for (const dl of x.d.dispatch_lines) {
      const l = lineInfo.get(dl.line_id)
      if (l) P(l.asin, l.product_name).dispatched += dl.units
    }
  for (const s of open)
    for (const l of live(s)) P(l.asin, l.product_name).toShip += Math.max(0, l.unit_qty - (sentByLine.get(l.id) ?? 0))
  for (const i of inspIn) {
    const l = lineInfo.get(i.line_id)
    if (l) {
      const p = P(l.asin, l.product_name)
      p.inspected += i.inspected_qty
      p.accepted += i.accepted_qty
    }
  }
  const products = [...prod.values()].filter((p) => p.dispatched || p.toShip || p.inspected).sort((a, b) => b.dispatched - a.dispatched || b.toShip - a.toShip).slice(0, 60)

  // fulfilment centres
  const fc = new Map<string, { name: string; shipments: number; dispatched: number; receiving: number }>()
  const F = (name: string) => {
    if (!fc.has(name)) fc.set(name, { name, shipments: 0, dispatched: 0, receiving: 0 })
    return fc.get(name)!
  }
  for (const s of createdIn) F(s.warehouse).shipments++
  for (const x of dispatchesIn) F(x.s.warehouse).dispatched += x.units
  for (const r of receiving) F(r.s.warehouse).receiving += r.pending
  const centres = [...fc.values()].sort((a, b) => b.dispatched - a.dispatched || b.shipments - a.shipments).slice(0, 60)

  return {
    kpi: { openShipments, onHold, toShip, dispatchedUnits, dispatchCount: dispatchesIn.length, pendingReceive, oldestReceive, passRate, rejected, inspected, onTimeRate, onTimeCount: onTime, plannedCount: withPlan.length, createdCount: createdIn.length },
    weekly,
    daily,
    pipeline,
    modes,
    durations,
    ageBuckets,
    products,
    centres,
    isEmpty: ships.length === 0
  }
}

// 0.4 -> "10 h", 2.34 -> "2.3 days"
export function fmtDays(d: number | null): string {
  if (d == null) return '—'
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`
  return `${d >= 10 ? Math.round(d) : Math.round(d * 10) / 10} day${Math.round(d * 10) / 10 === 1 ? '' : 's'}`
}
