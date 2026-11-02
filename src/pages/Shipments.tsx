import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { needsAppointment, needsBoxLabels } from '../data/options'
import { addDaysISO, fmtDate, fmtDateTime, fmtDayLong, todayISO } from '../lib/format'
import { Chip, Empty, ErrorBox, HoldStamp, Loading, Page, PageTitle, StatusStamp } from '../components/ui'
import type { Dispatch, Shipment, ShipmentLine } from '../types/db'

type Row = Shipment & {
  shipment_lines: ShipmentLine[]
  dispatches: Pick<Dispatch, 'id' | 'wm_approved_at'>[]
  box_label_checks: { scanned: string | null }[]
}

type Filter = 'all' | 'today' | 'tomorrow' | 'ready' | 'finished'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Dispatch today' },
  { id: 'tomorrow', label: 'Dispatch tomorrow' },
  { id: 'ready', label: 'Ready to dispatch' },
  { id: 'finished', label: 'Finished' }
]

const isFinished = (s: Row) => s.status === 'Closed' || s.status === 'Cancelled'

function matches(s: Row, f: Filter, today: string, tomorrow: string): boolean {
  switch (f) {
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
function buildGroups(rows: Row[], today: string, tomorrow: string): Group[] {
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
    return buildGroups(rows, today, tomorrow)
  }, [data, filter, query, today, tomorrow])

  return (
    <Page wide>
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

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search FBA ID, product, warehouse"
          aria-label="Search shipments"
          className="w-full lg:w-80 min-h-[44px] px-3 rounded-lg border border-line bg-surface focus:border-ink focus:outline-none"
        />
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0 lg:min-w-0" role="tablist" aria-label="Filter shipments">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 min-h-[40px] px-3 rounded-full text-sm font-medium border ${
                filter === f.id ? 'bg-ink text-white border-ink' : 'bg-surface border-line text-muted hover:text-ink'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 ${filter === f.id ? 'text-white/65' : 'text-muted/70'}`}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && groups.length === 0 && <Empty>No shipments match.</Empty>}

      {groups.length > 0 && (
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          <div className={`hidden lg:grid ${COLS} gap-x-4 px-5 py-2.5 border-b border-line text-[13px] text-muted font-medium`}>
            <span>Shipment</span>
            <span>Warehouse</span>
            <span>Products</span>
            <span>Dispatch date</span>
            <span>Appointment</span>
            <span>Status</span>
          </div>

          {groups.map((g) => (
            <section key={g.key} aria-label={g.title}>
              <div
                className={`flex items-baseline justify-between gap-3 px-4 lg:px-5 py-2 bg-canvas border-b border-line ${
                  g.key === groups[0].key ? '' : 'border-t'
                }`}
              >
                <h2 className={`text-sm font-semibold ${g.tone === 'fail' ? 'text-fail' : ''}`}>
                  {g.title}
                  {g.note && <span className="ml-2 font-normal text-muted">{g.note}</span>}
                </h2>
                <span className="text-[13px] text-muted">
                  {g.rows.length} shipment{g.rows.length > 1 ? 's' : ''}
                </span>
              </div>
              <ul>
                {g.rows.map((s) => {
                  const units = s.shipment_lines.reduce((n, l) => n + l.unit_qty, 0)
                  const first = s.shipment_lines[0]?.product_name ?? ''
                  const more = s.shipment_lines.length - 1
                  const awaiting = s.dispatches.some((d) => !d.wm_approved_at)
                  return (
                    <li key={s.id} className="border-t first:border-t-0 border-line">
                      <Link
                        to={`/shipments/${s.id}`}
                        className={`grid grid-cols-[1fr_auto] ${COLS} gap-x-4 gap-y-1 px-4 lg:px-5 py-3.5 items-center hover:bg-canvas ${
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
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
