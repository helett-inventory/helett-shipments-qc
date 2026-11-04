import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { needsAppointment, needsBoxLabels } from '../data/options'
import { changeDeadline, withinWatch } from '../lib/deadline'
import { DeadlineBadge } from '../components/DeadlineBadge'
import { addDaysISO, fmtDate, fmtDateTime, fmtDayLong, todayISO } from '../lib/format'
import { Chip, Empty, ErrorBox, HoldStamp, Loading, Page, StickyHead, PageTitle, StatusStamp } from '../components/ui'
import type { Dispatch, Shipment, ShipmentLine } from '../types/db'

type Row = Shipment & {
  shipment_lines: ShipmentLine[]
  dispatches: Pick<Dispatch, 'id' | 'wm_approved_at'>[]
  box_label_checks: { scanned: string | null }[]
}

type Filter = 'all' | 'deadline' | 'today' | 'tomorrow' | 'ready' | 'finished'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'deadline', label: 'Deadline soon' },
  { id: 'today', label: 'Dispatch today' },
  { id: 'tomorrow', label: 'Dispatch tomorrow' },
  { id: 'ready', label: 'Ready to dispatch' },
  { id: 'finished', label: 'Finished' }
]

const isFinished = (s: Row) => s.status === 'Closed' || s.status === 'Cancelled'

function matches(s: Row, f: Filter, today: string, tomorrow: string): boolean {
  switch (f) {
    case 'deadline':
      return withinWatch(changeDeadline(s))
    case 'today':
      return !isFinished(s) && s.dispatch_date === today
    case 'tomorrow':
      return !isFinished(s) && s.dispatch_date === tomorrow
    case 'ready':
      return s.status === 'QC Done' || s.status === 'Partially Dispatched'
    case 'finished':
      return isFinished(s)
    default:
      return true
  }
}

interface Group {
  key: string
  title: string
  note?: string
  tone?: 'fail'
  rows: Row[]
}

// Upcoming days first (soonest at the top), then overdue, then undated, then finished.
function buildGroups(rows: Row[], today: string, tomorrow: string, filter: Filter): Group[] {
  // Deadline view: one list, closest deadline first (already-passed ones at the very top).
  if (filter === 'deadline') {
    const when = (s: Row) => changeDeadline(s)?.getTime() ?? Infinity
    return rows.length ? [{ key: 'deadline', title: 'Closest deadline first', note: 'Cancel or reschedule before it passes', rows: [...rows].sort((a, b) => when(a) - when(b)) }] : []
  }
  const byApp = (a: Row, b: Row) => (a.appointment_at ?? '').localeCompare(b.appointment_at ?? '')
  const overdue: Row[] = []
  const days = new Map<string, Row[]>()
  const undated: Row[] = []
  const finished: Row[] = []
  for (const s of rows) {
    if (isFinished(s)) finished.push(s)
    else if (!s.dispatch_date) undated.push(s)
    else if (s.dispatch_date < today) overdue.push(s)
    else days.set(s.dispatch_date, [...(days.get(s.dispatch_date) ?? []), s])
  }
  const out: Group[] = []
  for (const day of [...days.keys()].sort()) {
    out.push({
      key: day,
      title: day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : fmtDayLong(day),
      note: day === today || day === tomorrow ? fmtDayLong(day) : undefined,
      rows: days.get(day)!.sort(byApp)
    })
  }
  if (overdue.length)
    out.push({
      key: 'overdue',
      title: 'Overdue',
      note: 'Dispatch date has passed',
      tone: 'fail',
      rows: overdue.sort((a, b) => (a.dispatch_date! < b.dispatch_date! ? -1 : 1))
    })
  if (undated.length) out.push({ key: 'none', title: 'No dispatch date', rows: undated.sort(byApp) })
  if (finished.length)
    out.push({
      key: 'finished',
      title: 'Finished',
      rows: finished.sort((a, b) => (b.dispatch_date ?? '').localeCompare(a.dispatch_date ?? ''))
    })
  return out
}

const COLS = 'lg:grid-cols-[1.3fr_.9fr_1.6fr_1fr_1.2fr_1.2fr]'

export function Shipments() {
  const { profile } = useAuth()
  const { data, error, loading } = useLive<Row[]>(
    async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*, shipment_lines(*), dispatches(id, wm_approved_at), box_label_checks(scanned)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Row[]
    },
    ['shipments', 'shipment_lines', 'dispatches'],
    'shipments-list'
  )
  const showDeadlines = !(profile?.role === 'qc' && !profile.is_admin) // QC does not manage Amazon deadlines
  const filters = showDeadlines ? FILTERS : FILTERS.filter((f) => f.id !== 'deadline')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const today = todayISO()
  const tomorrow = addDaysISO(1)

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>
    for (const f of FILTERS) out[f.id] = (data ?? []).filter((s) => matches(s, f.id, today, tomorrow)).length
    return out
  }, [data, today, tomorrow])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (data ?? [])
      .filter((s) => matches(s, filter, today, tomorrow))
      .filter(
        (s) =>
          !q ||
          [s.fba_id, s.warehouse, ...s.shipment_lines.map((l) => l.product_name)].some((v) => v.toLowerCase().includes(q))
      )
    return buildGroups(rows, today, tomorrow, filter)
  }, [data, filter, query, today, tomorrow])

  const needDecision = useMemo(() => (data ?? []).filter((s) => withinWatch(changeDeadline(s))).length, [data])

  return (
    <Page wide>
      <StickyHead wide>
      <PageTitle
        title="Shipments"
        action={
          (profile?.role === 'inventory' || !!profile?.is_admin) && (
            <Link to="/shipments/new" className="min-h-[44px] px-4 rounded-lg bg-ink text-white font-medium flex items-center">
              New shipment
            </Link>
          )
        }
      />
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 pt-1 pb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search FBA ID, product, warehouse"
          aria-label="Search shipments"
          className="w-full lg:w-80 min-h-[44px] px-3 rounded-lg bg-surface ring-1 ring-[#cfd4da] focus:ring-2 focus:ring-ink focus:outline-none"
        />
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto -mx-4 px-4 py-1 lg:mx-0 lg:px-1 lg:min-w-0" role="tablist" aria-label="Filter shipments">
          {filters.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 min-h-[44px] px-4 rounded-full text-sm font-medium ${
                filter === f.id ? 'bg-ink text-white' : 'bg-surface ring-1 ring-[#cfd4da] text-muted hover:text-ink'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 ${filter === f.id ? 'text-white/65' : 'text-muted/70'}`}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>
      </StickyHead>

      {showDeadlines && needDecision > 0 && filter !== 'deadline' && (
        <div role="alert" className="mb-4 rounded-lg bg-[#fdeedb] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[15px] font-medium text-warn">
            {needDecision} shipment{needDecision > 1 ? 's' : ''} need a decision in the next 48 hours: cancel or reschedule to protect account health.
          </span>
          <button type="button" onClick={() => setFilter('deadline')} className="min-h-[40px] px-4 rounded-lg bg-ink text-white text-sm font-medium">
            Show them
          </button>
        </div>
      )}
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && groups.length === 0 && <Empty>No shipments match.</Empty>}

      {groups.length > 0 && (
        <div>
          <div className="hidden lg:grid grid-cols-[152px_1fr] mb-2 text-[13px] text-muted font-medium">
            <span />
            <div className={`grid ${COLS} gap-x-4 px-5`}>
              <span>Shipment</span>
              <span>Warehouse</span>
              <span>Products</span>
              <span>Dispatch date</span>
              <span>Appointment</span>
              <span>Status</span>
            </div>
          </div>

          <div className="space-y-4">
          {groups.map((g) => {
            const isDay = /^\d{4}-\d{2}-\d{2}$/.test(g.key)
            const [wd, dd, mon, yr] = isDay ? fmtDayLong(g.key).split(' ') : []
            const isToday = g.key === today
            const count = `${g.rows.length} shipment${g.rows.length > 1 ? 's' : ''}`
            return (
            <section key={g.key} aria-label={g.title} className="bg-surface shadow-card rounded-xl overflow-hidden lg:grid lg:grid-cols-[152px_1fr]">
              <div
                className={`px-4 lg:px-5 py-3 lg:py-5 flex items-baseline justify-between lg:block ${
                  isToday ? 'bg-ink text-white' : 'bg-[#eef0f2]'
                }`}
              >
                {isDay ? (
                  <div className="flex items-baseline gap-2.5 lg:block">
                    <div className="text-2xl lg:text-[40px] font-semibold leading-none tracking-tight">{dd}</div>
                    <div className={`lg:mt-1.5 text-sm ${isToday ? 'text-white/75' : 'text-muted'}`}>
                      {wd} · {mon} {yr}
                    </div>
                    {(g.key === today || g.key === tomorrow) && (
                      <div className={`text-sm font-semibold lg:mt-2 ${isToday ? 'text-white' : 'text-ink'}`}>{g.title}</div>
                    )}
                  </div>
                ) : (
                  <div>
                    <h2 className={`text-base font-semibold ${g.tone === 'fail' ? 'text-fail' : ''}`}>{g.title}</h2>
                    {g.note && <div className="text-sm text-muted mt-0.5">{g.note}</div>}
                  </div>
                )}
                <span className={`text-[13px] lg:block lg:mt-3 ${isToday ? 'text-white/75' : 'text-muted'}`}>{count}</span>
              </div>
              <ul className="divide-y divide-line min-w-0">
                {g.rows.map((s) => {
                  const units = s.shipment_lines.reduce((n, l) => n + l.unit_qty, 0)
                  const first = s.shipment_lines[0]?.product_name ?? ''
                  const more = s.shipment_lines.length - 1
                  const awaiting = s.dispatches.some((d) => !d.wm_approved_at)
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/shipments/${s.id}`}
                        className={`grid grid-cols-[1fr_auto] ${COLS} gap-x-4 gap-y-1 px-4 lg:px-5 py-4 lg:py-5 items-center hover:bg-canvas ${
                          s.on_hold ? 'bg-fail/[0.04]' : ''
                        }`}
                      >
                        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                          <div className="font-mono font-medium truncate">{s.fba_id}</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5 lg:justify-start lg:col-start-6 lg:row-start-1">
                          {s.on_hold && <HoldStamp />}
                          {(s.status === 'QC Done' || s.status === 'Partially Dispatched') && needsBoxLabels(s.dispatch_mode ?? '') && s.box_label_checks.some((c) => !c.scanned) && <Chip tone="warn">Box labels pending</Chip>}
                          {awaiting && <StatusStamp status="Awaiting WM" />}
                          <StatusStamp status={s.status} />
                        </div>
                        <div className="col-span-2 text-sm text-muted lg:text-ink lg:col-span-1 lg:col-start-2 lg:row-start-1">{s.warehouse}</div>
                        <div className="col-span-2 text-sm lg:col-span-1 lg:col-start-3 lg:row-start-1 min-w-0">
                          <span className="block truncate">
                            {first}
                            {more > 0 && <span className="text-muted"> +{more} more</span>}
                          </span>
                          <span className="text-muted">
                            {units} units · {s.box_qty_total} boxes
                          </span>
                        </div>
                        <div className="col-span-2 text-sm text-muted lg:text-ink lg:col-span-1 lg:col-start-4 lg:row-start-1">
                          <span className="lg:hidden">Dispatch </span>
                          {s.dispatch_date ? fmtDate(s.dispatch_date) : '—'}
                        </div>
                        <div className="col-span-2 text-sm text-muted lg:col-span-1 lg:col-start-5 lg:row-start-1">
                          {s.appointment_at ? (
                            <>
                              <span className="lg:hidden">Appointment </span>
                              {fmtDateTime(s.appointment_at)}
                            </>
                          ) : (
                            needsAppointment(s.dispatch_mode ?? '') ? 'No appointment' : '—'
                          )}
                          <div className="mt-1">
                            {showDeadlines && <DeadlineBadge shipment={s} />}
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
            )
          })}
          </div>
        </div>
      )}
    </Page>
  )
}
