import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isFinanceOnly } from '../lib/roles'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { fmtDayLong, todayISO } from '../lib/format'
import { ErrorBox, HoldStamp, Loading, ModePill, Page, PageTitle, StatusStamp } from '../components/ui'
import type { Shipment, ShipmentLine } from '../types/db'

type Row = Shipment & { shipment_lines: Pick<ShipmentLine, 'product_name' | 'unit_qty' | 'status' | 'received_qty'>[] }
type Kind = 'open' | 'late' | 'hold' | 'done'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

// Dot look per state. Black = still to dispatch, amber = past its date, red ring = on hold, grey = dispatched.
const DOT: Record<Kind, string> = {
  open: 'bg-ink',
  late: 'bg-[#c98a1b]',
  hold: 'bg-white ring-2 ring-fail',
  done: 'bg-[#c3c8d0]'
}
const KIND_LABEL: Record<Kind, string> = { open: 'To dispatch', late: 'Past its date', hold: 'On hold', done: 'Dispatched' }

function Dot({ kind }: { kind: Kind }) {
  return <span className={`dot inline-block w-2 h-2 rounded-full shrink-0 ${DOT[kind]}`} />
}

// A calendar of dispatch dates: every shipment is an indicator on the day it is planned to go out.
export function Calendar() {
  const { profile } = useAuth()
  const fin = isFinanceOnly(profile)
  const { data, error, loading } = useLive<Row[]>(
    async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*, shipment_lines(product_name, unit_qty, status, received_qty)')
        .not('dispatch_date', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (error) throw error
      return data as unknown as Row[]
    },
    ['shipments', 'shipment_lines'],
    'calendar'
  )

  const today = todayISO()
  const [ty, tm] = today.split('-').map(Number)
  const [view, setView] = useState({ y: ty, m: tm - 1 })
  const [picked, setPicked] = useState<string | null>(today)

  const kindOf = (s: Row): Kind => {
    if (s.status === 'Closed') return 'done'
    if (s.on_hold && !fin) return 'hold'
    if ((s.dispatch_date ?? '') < today) return 'late'
    return 'open'
  }

  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const s of data ?? []) {
      if (s.status === 'Cancelled' || !s.dispatch_date) continue
      const k = s.dispatch_date.slice(0, 10)
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return m
  }, [data])

  // Monday-first grid of whole weeks that covers the month.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const lead = (first.getDay() + 6) % 7
    const total = 42 // always six weeks, so the calendar is the same size in every month
    return Array.from({ length: total }, (_, i) => {
      const d = new Date(view.y, view.m, 1 - lead + i)
      return { key: iso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === view.m }
    })
  }, [view])

  const monthStats = useMemo(() => {
    let ships = 0
    let units = 0
    for (const c of cells) {
      if (!c.inMonth) continue
      for (const s of byDay.get(c.key) ?? []) {
        ships++
        units += s.shipment_lines.filter((l) => l.status !== 'Cancelled').reduce((n, l) => n + l.unit_qty, 0)
      }
    }
    return { ships, units }
  }, [cells, byDay])

  const move = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const goToday = () => {
    setView({ y: ty, m: tm - 1 })
    setPicked(today)
  }

  const panel = useRef<HTMLElement>(null)
  const pick = (key: string) => {
    setPicked(key)
    // stacked layout: bring the day's list into view
    if (window.matchMedia('(max-width: 1535px)').matches) setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
  }
  const dayRows = picked ? (byDay.get(picked) ?? []) : []
  const navBtn = 'w-11 h-11 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 active:scale-95 transition'

  return (
    <Page wide>
      <PageTitle
        title="Calendar"
        sub="Shipments on their planned dispatch date."
        action={
          <button type="button" onClick={goToday} className="min-h-[44px] px-4 rounded-lg bg-ink text-white font-medium">
            Today
          </button>
        }
      />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <div className="grid 2xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
          <section aria-label="Month" className="bg-surface shadow-card rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-ink text-white">
              <button type="button" onClick={() => move(-1)} aria-label="Previous month" className={navBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <div className="flex-1 min-w-0 text-center">
                <h2 className="text-lg font-semibold tracking-tight leading-tight">
                  {MONTHS[view.m]} {view.y}
                </h2>
                <p className="text-[13px] text-white/70">
                  {monthStats.ships} shipment{monthStats.ships === 1 ? '' : 's'} · {monthStats.units.toLocaleString()} units
                </p>
              </div>
              <button type="button" onClick={() => move(1)} aria-label="Next month" className={navBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[13px] text-muted font-medium border-b border-line">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-2">
                  {w}
                </span>
              ))}
            </div>

            <div key={`${view.y}-${view.m}`} className="grid grid-cols-7 swap-in [&>button:nth-child(7n)]:border-r-0 [&>button:nth-last-child(-n+7)]:border-b-0">
              {cells.map((c) => {
                const rows = byDay.get(c.key) ?? []
                const isToday = c.key === today
                const isPicked = c.key === picked
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => pick(c.key)}
                    aria-label={`${fmtDayLong(c.key)}, ${rows.length} shipment${rows.length === 1 ? '' : 's'}`}
                    aria-pressed={isPicked}
                    className={`relative min-h-[64px] lg:min-h-[112px] p-1.5 lg:p-2 border-b border-r border-line text-left flex flex-col items-center lg:items-stretch gap-1 transition-colors ${
                      isPicked ? 'bg-[#eef0f2]' : 'hover:bg-canvas'
                    } ${c.inMonth ? '' : 'text-muted/50 [&_.dot]:opacity-40'}`}
                  >
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-sm tabular-nums ${
                        isToday ? 'bg-ink text-white font-semibold' : c.inMonth ? 'font-medium' : ''
                      }`}
                    >
                      {c.day}
                    </span>
                    {/* phones: dots only */}
                    <span className="flex flex-wrap justify-center gap-1 lg:hidden">
                      {rows.slice(0, 4).map((s) => (
                        <Dot key={s.id} kind={kindOf(s)} />
                      ))}
                    </span>
                    {rows.length > 4 && <span className="text-[10px] text-muted leading-none lg:hidden">+{rows.length - 4}</span>}
                    {/* desktop: a small chip per shipment */}
                    <span className="hidden lg:flex flex-col gap-1 min-w-0">
                      {rows.slice(0, 3).map((s) => (
                        <span key={s.id} className="flex items-center gap-1.5 rounded-md bg-[#f0f1f3] px-1.5 py-1 text-[11px] leading-none min-w-0">
                          <Dot kind={kindOf(s)} />
                          <span className="truncate font-mono">{s.fba_id}</span>
                        </span>
                      ))}
                      {rows.length > 3 && <span className="text-[11px] text-muted px-1">+{rows.length - 3} more</span>}
                    </span>
                  </button>
                )
              })}
            </div>

            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 py-3 text-[13px] text-muted border-t border-line" aria-label="Key">
              {(Object.keys(KIND_LABEL) as Kind[])
                .filter((k) => !(fin && k === 'hold'))
                .map((k) => (
                  <li key={k} className="inline-flex items-center gap-2">
                    <Dot kind={k} />
                    {KIND_LABEL[k]}
                  </li>
                ))}
            </ul>
          </section>

          <aside ref={panel} aria-label="Selected day" className="bg-surface shadow-card rounded-xl overflow-hidden 2xl:sticky 2xl:top-6 scroll-mt-20">
            <div className="px-4 py-3 border-b border-line">
              <h2 className="text-lg font-semibold tracking-tight">{picked ? fmtDayLong(picked) : 'Pick a day'}</h2>
              <p className="text-[13px] text-muted">{picked ? `${dayRows.length} shipment${dayRows.length === 1 ? '' : 's'} to dispatch` : 'Tap a day to see its shipments.'}</p>
            </div>
            {picked && dayRows.length === 0 && <p className="px-4 py-8 text-sm text-muted text-center">No shipments on this day.</p>}
            <ul key={picked ?? ''} className="divide-y divide-line swap-in">
              {dayRows.map((s) => {
                const lines = s.shipment_lines.filter((l) => l.status !== 'Cancelled')
                const units = lines.reduce((n, l) => n + l.unit_qty, 0)
                const got = lines.reduce((n, l) => n + (l.received_qty ?? 0), 0)
                const sent = s.status === 'Closed' || s.status === 'Partially Dispatched'
                return (
                  <li key={s.id}>
                    <Link to={`/shipments/${s.id}`} className="block px-4 py-3 hover:bg-canvas">
                      <div className="flex items-center gap-2">
                        <Dot kind={kindOf(s)} />
                        <span className="font-mono text-[15px] font-semibold">{s.fba_id}</span>
                        <span className="ml-auto text-sm text-muted">{s.warehouse}</span>
                      </div>
                      <div className="mt-1.5 text-sm truncate">{lines.length === 1 ? lines[0].product_name : `${lines.length} SKUs`}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ModePill mode={s.dispatch_mode} />
                        {!fin && s.on_hold ? <HoldStamp /> : <StatusStamp status={s.status} />}
                        <span className="text-[13px] text-muted">
                          {units.toLocaleString()} units · {s.box_qty_total} box{s.box_qty_total === 1 ? '' : 'es'}
                        </span>
                      </div>
                      {sent && !fin && (
                        <div className="mt-2 flex items-center gap-2 text-[13px]">
                          <span className="h-1.5 flex-1 rounded-full bg-[#eef0f2] overflow-hidden" aria-hidden="true">
                            <span className="block h-full rounded-full bg-ink" style={{ width: `${units ? Math.min(100, (got / units) * 100) : 0}%` }} />
                          </span>
                          <span className="tabular-nums text-muted shrink-0">
                            {got.toLocaleString()} of {units.toLocaleString()} received
                          </span>
                        </div>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </aside>
        </div>
      )}
    </Page>
  )
}
