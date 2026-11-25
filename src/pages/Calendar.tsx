import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isViewOnly } from '../lib/roles'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../hooks/useLive'
import { useNeeds } from '../hooks/useNeeds'
import { NeedsStrip } from '../components/NeedsStrip'
import { fetchAll, supabase } from '../lib/supabase'
import { fmtDate, fmtDayLong, todayISO } from '../lib/format'
import { ErrorBox, HoldStamp, Loading, ModePill, PageTitle, StatusStamp, StickyHead } from '../components/ui'
import { DeadlineBadge } from '../components/DeadlineBadge'
import { changeDeadline } from '../lib/deadline'
import type { Shipment, ShipmentLine } from '../types/db'

type Row = Shipment & { shipment_lines: Pick<ShipmentLine, 'product_name' | 'unit_qty' | 'status' | 'received_qty'>[] }
type Kind = 'dropin' | 'other' | 'late' | 'hold' | 'done'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

// Dot look. Still to dispatch: black = Drop In, grey = every other type. Then amber = past its date, red ring = on hold, light green = dispatched.
const DOT: Record<Kind, string> = {
  dropin: 'bg-ink',
  other: 'bg-[#aab0b9]',
  late: 'bg-[#c98a1b]',
  hold: 'bg-white ring-2 ring-fail',
  done: 'bg-[#8fd3ae]'
}
const KIND_LABEL: Record<Kind, string> = { dropin: 'Drop In', other: 'ATS and others', late: 'Past its date', hold: 'On hold', done: 'Dispatched' }

function Dot({ kind }: { kind: Kind }) {
  return <span className={`dot inline-block w-2 h-2 rounded-full shrink-0 ${DOT[kind]}`} />
}

// A calendar of dispatch dates: every shipment is an indicator on the day it is planned to go out.
export function Calendar() {
  const { profile } = useAuth()
  const fin = isViewOnly(profile)
  const needs = useNeeds()
  const { data, error, loading } = useLive<Row[]>(
    async () => {
      return fetchAll<Row>((a, b) =>
        supabase
          .from('shipments')
          .select('*, shipment_lines(product_name, unit_qty, status, received_qty)')
          .not('dispatch_date', 'is', null)
          .order('created_at', { ascending: false })
          .order('id')
          .range(a, b)
      )
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
    return s.dispatch_mode === 'Drop In' ? 'dropin' : 'other'
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
    if (window.matchMedia('(max-width: 1023px)').matches) setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
  }
  const dayRows = picked ? (byDay.get(picked) ?? []) : []
  const navBtn = 'w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 active:scale-95 transition'

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1760px] px-4 py-5 lg:px-6 lg:pt-8 lg:pb-4 lg:min-h-[calc(100vh-2.5rem)] lg:flex lg:flex-col">
      <StickyHead wide>
      <PageTitle
        title="Calendar"
        action={
          <div className="flex items-center gap-2">
            {(profile?.role === 'inventory' || !!profile?.is_admin) && (
              <Link to="/shipments/new" className="min-h-[44px] px-4 rounded-lg bg-ink text-white font-medium flex items-center">
                New shipment
              </Link>
            )}
          </div>
        }
      />
      </StickyHead>
      <NeedsStrip items={needs.ships} />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto] gap-5 items-start lg:items-stretch lg:flex-1">
          <section aria-label="Month" className="bg-surface shadow-card rounded-xl overflow-hidden min-w-0 lg:flex lg:flex-col">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-ink text-white">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold tracking-tight leading-tight">
                  {MONTHS[view.m]} {view.y}
                </h2>
                <p className="text-[13px] text-white/70">
                  {monthStats.ships} shipment{monthStats.ships === 1 ? '' : 's'} · {monthStats.units.toLocaleString()} units
                </p>
              </div>
              <button type="button" onClick={goToday} className="min-h-[36px] px-3.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors">
                Today
              </button>
              <button type="button" onClick={() => move(-1)} aria-label="Previous month" className={navBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <button type="button" onClick={() => move(1)} aria-label="Next month" className={navBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[13px] text-muted font-medium border-b border-line">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1.5">
                  {w}
                </span>
              ))}
            </div>

            <div key={`${view.y}-${view.m}`} className="grid grid-cols-7 lg:grid-rows-[repeat(6,minmax(96px,1fr))] lg:flex-1 swap-in [&>button:nth-child(7n)]:border-r-0 [&>button:nth-last-child(-n+7)]:border-b-0">
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
                    className={`relative min-h-[64px] lg:min-h-[96px] lg:overflow-hidden p-1.5 border-b border-r border-line text-left flex flex-col items-center lg:items-stretch gap-1 transition-colors ${
                      isPicked ? 'bg-[#eef0f2]' : 'hover:bg-canvas'
                    } ${c.inMonth ? '' : '[&_.dot]:!bg-[#c3c8d0] [&_.dot]:!ring-0'}`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] tabular-nums ${
                        isToday ? 'bg-ink text-white font-semibold' : c.inMonth ? 'font-medium' : 'text-muted/50'
                      }`}
                    >
                      {c.day}
                    </span>
                    {/* phones: dots only */}
                    <span className="flex flex-wrap justify-center gap-1 xl:hidden">
                      {rows.slice(0, 4).map((s) => (
                        <Dot key={s.id} kind={kindOf(s)} />
                      ))}
                    </span>
                    {rows.length > 4 && <span className="text-[10px] text-muted leading-none xl:hidden">+{rows.length - 4}</span>}
                    {/* wide screens: a small chip per shipment; the third only when the window is tall enough */}
                    <span className="hidden xl:flex flex-col gap-1 min-w-0">
                      {rows.slice(0, 3).map((s, i) => (
                        <span key={s.id} className={`${i === 2 ? 'hidden [@media(min-height:860px)]:flex' : 'flex'} items-center gap-1.5 rounded-md bg-[#f0f1f3] px-1.5 py-[3px] text-[11px] leading-none min-w-0`}>
                          <Dot kind={kindOf(s)} />
                          <span className="truncate font-mono">{s.fba_id}</span>
                        </span>
                      ))}
                      {rows.length > 2 && (
                        <span className="text-[11px] text-muted px-1 leading-none">
                          <span className="[@media(min-height:860px)]:hidden">+{rows.length - 2} more</span>
                          {rows.length > 3 && <span className="hidden [@media(min-height:860px)]:inline">+{rows.length - 3} more</span>}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>

            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 py-2 text-[13px] text-muted border-t border-line" aria-label="Key">
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

          <aside ref={panel} aria-label="Selected day" className="bg-surface shadow-card rounded-xl overflow-hidden scroll-mt-20 lg:relative">
            <div className="lg:absolute lg:inset-0 lg:flex lg:flex-col">
            <div className="px-4 py-3 border-b border-line">
              <h2 className="text-lg font-semibold tracking-tight">{picked ? fmtDayLong(picked) : 'Pick a day'}</h2>
              <p className="text-[13px] text-muted">{picked ? `${dayRows.length} shipment${dayRows.length === 1 ? '' : 's'} to dispatch` : 'Tap a day to see its shipments.'}</p>
            </div>
            {picked && dayRows.length === 0 && <p className="px-4 py-8 text-sm text-muted text-center">No shipments on this day.</p>}
            <ul key={picked ?? ''} className="divide-y divide-line swap-in lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
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
                        <span className="font-mono text-[15px] font-normal">{s.fba_id}</span>
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
                      {!fin && changeDeadline(s) && (
                        <div className="mt-2 flex items-center gap-2 text-[13px]">
                          <span className="text-muted">Cancel or reschedule:</span>
                          <DeadlineBadge shipment={s} />
                        </div>
                      )}
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
            {picked && (profile?.role === 'inventory' || !!profile?.is_admin) && (
              <div className="p-3 border-t border-line shrink-0">
                <Link
                  to={`/shipments/new?date=${picked}`}
                  className="min-h-[44px] w-full rounded-lg bg-[#f0f1f3] hover:bg-[#e6e8eb] font-medium flex items-center justify-center transition-colors"
                >
                  Add shipment to {fmtDate(picked)}
                </Link>
              </div>
            )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
