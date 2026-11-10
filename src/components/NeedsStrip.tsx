import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate, todayISO } from '../lib/format'
import { NEED_LABEL, type Need, type NeedKind } from '../hooks/useNeeds'

const KEY = 'helett.needs.open'
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

// Most pressing first.
const ORDER: NeedKind[] = ['hold', 'approve', 'labels', 'dispatch', 'recheck', 'qc', 'review', 'receive']

// Whole days from the dispatch date to today (positive = in the past).
const daysSince = (iso: string) =>
  Math.round((Date.parse(todayISO() + 'T00:00:00Z') - Date.parse(iso.slice(0, 10) + 'T00:00:00Z')) / 86400000)

function sinceText(n: number): string {
  if (n === 0) return 'Today'
  const u = Math.abs(n) === 1 ? 'day' : 'days'
  return n > 0 ? `${n} ${u} ago` : `in ${-n} ${u}`
}

// The chip turns black when it is time to act: a dispatch due today or late, or Amazon receiving open for 5+ days.
function isUrgent(kind: NeedKind, n: number) {
  if (kind === 'receive') return n >= 5
  if (kind === 'dispatch' || kind === 'labels' || kind === 'approve') return n >= 0
  return false
}

function summary(items: Need[]) {
  const by = new Map<NeedKind, number>()
  for (const n of items) by.set(n.kind, (by.get(n.kind) ?? 0) + 1)
  return ORDER.filter((k) => by.has(k))
    .map((k) => `${by.get(k)} ${NEED_LABEL[k].toLowerCase()}`)
    .join(', ')
}

const Bell = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
)

function When({ need }: { need: Need }) {
  if (!need.date) return <span className="text-[13px] text-muted">No dispatch date</span>
  const n = daysSince(need.date)
  const urgent = isUrgent(need.kind, n)
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-[13px] text-muted">{fmtDate(need.date)}</span>
      <span className={`h-7 px-2.5 rounded-full text-[13px] font-semibold flex items-center ${urgent ? 'bg-ink text-white' : 'bg-[#f0f1f3] text-ink'}`}>
        {sinceText(n)}
      </span>
    </span>
  )
}

// Your own to-do alerts: a collapsible bar above the list. Open, the items are grouped by what
// has to be done, most pressing group first and the oldest item first inside each group.
export function NeedsStrip({ items }: { items: Need[] }) {
  const [open, setOpen] = useState(readOpen)
  if (items.length === 0) return null
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      /* private mode: just not remembered */
    }
  }
  const groups = ORDER.map((k) => ({
    kind: k,
    rows: items.filter((i) => i.kind === k).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  })).filter((g) => g.rows.length > 0)

  return (
    <section aria-label="Waiting on you" className="mb-4 rounded-2xl bg-[#e8eaee] p-1.5">
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full min-h-[48px] flex items-center gap-3 pl-2 pr-3 rounded-xl text-left hover:bg-black/[0.03]">
        <span className="relative w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center shrink-0">
          {Bell}
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-ink ring-2 ring-[#e8eaee] text-[11px] font-semibold flex items-center justify-center">
            {items.length}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight">Waiting on you</span>
          <span className="block text-sm text-muted truncate">{summary(items)}</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {groups.map((g) => (
            <div key={g.kind} className="rounded-xl bg-surface overflow-hidden">
              <h3 className="px-4 pt-3 pb-1.5 flex items-center gap-2 text-[15px] font-semibold">
                {NEED_LABEL[g.kind]}
                <span className="min-w-6 h-6 px-1.5 rounded-full bg-[#f0f1f3] text-[13px] font-semibold flex items-center justify-center">{g.rows.length}</span>
              </h3>
              <ul className="divide-y divide-line">
                {g.rows.map((n) => (
                  <li key={n.key}>
                    <Link
                      to={n.to}
                      className="flex flex-col gap-1.5 lg:grid lg:grid-cols-[150px_56px_minmax(0,1fr)_minmax(0,.7fr)_210px_16px] lg:items-center lg:gap-x-4 px-4 py-3 min-h-[52px] hover:bg-canvas"
                    >
                      <span className="flex items-center justify-between gap-3 lg:contents">
                        <span className="font-mono text-[15px] font-semibold">{n.title}</span>
                        <span className="text-sm text-muted lg:text-ink">{n.fc}</span>
                      </span>
                      <span className="min-w-0 text-sm">
                        {n.products.slice(0, 2).map((p, i) => (
                          <span key={i} className="block truncate">
                            {p}
                          </span>
                        ))}
                        {n.products.length > 2 && <span className="block text-[13px] text-muted">+{n.products.length - 2} more</span>}
                      </span>
                      <span className="text-sm text-muted truncate">{n.note}</span>
                      <span className="lg:justify-self-end">
                        <When need={n} />
                      </span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden lg:block text-muted">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function NavCount({ n, invert = false, className = '' }: { n: number; invert?: boolean; className?: string }) {
  if (n <= 0) return null
  return (
    <span
      aria-label={`${n} waiting`}
      className={`min-w-[18px] h-[18px] px-1 rounded-full ${invert ? 'bg-white text-ink' : 'bg-ink text-white'} text-[11px] font-semibold leading-none flex items-center justify-center ${className}`}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
