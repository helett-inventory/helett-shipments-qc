import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NEED_LABEL, type Need, type NeedKind } from '../hooks/useNeeds'

const KEY = 'helett.needs.open'
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

// "3 receiving pending, 1 on hold": one line that says what is waiting.
function summary(items: Need[]) {
  const by = new Map<NeedKind, number>()
  for (const n of items) by.set(n.kind, (by.get(n.kind) ?? 0) + 1)
  return [...by.entries()].map(([k, c]) => `${c} ${NEED_LABEL[k].toLowerCase()}`).join(', ')
}

const Bell = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
)

// Your own to-do alerts, a collapsible bar above the list. Collapsed it is one quiet line;
// open, it lists each item as a small row. Looks unlike the shipment cards so it reads as a notice.
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
  return (
    <section aria-label="Waiting on you" className="mb-4 rounded-2xl bg-[#e8eaee] p-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full min-h-[48px] flex items-center gap-3 pl-2 pr-3 rounded-xl text-left hover:bg-black/[0.03]"
      >
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
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5 max-h-[320px] overflow-y-auto">
          {items.map((n) => (
            <li key={n.key}>
              <Link to={n.to} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 min-h-[48px] hover:ring-1 hover:ring-ink/20">
                <span className="w-[116px] shrink-0 text-[13px] font-medium text-muted">{NEED_LABEL[n.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{n.title}</span>
                  <span className="block text-[13px] text-muted truncate">{n.sub}</span>
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Black on white; flips to white on black when it sits on the active (black) tab.
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
