import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NEED_LABEL, type Need } from '../hooks/useNeeds'

// "Waiting on you": the logged-in person's own to-do items, shown at the top of a list page.
export function NeedsStrip({ items }: { items: Need[] }) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const shown = all ? items : items.slice(0, 4)
  return (
    <section aria-label="Waiting on you" className="mb-4 rounded-xl bg-surface shadow-card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2.5 bg-ink text-white">
        <span className="min-w-6 h-6 px-1.5 rounded-full bg-white text-ink text-[13px] font-semibold flex items-center justify-center">{items.length}</span>
        <h2 className="text-[15px] font-semibold">Waiting on you</h2>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((n) => (
          <li key={n.key}>
            <Link to={n.to} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] hover:bg-canvas">
              <span className="min-w-0">
                <span className="block font-medium truncate">{n.title}</span>
                <span className="block text-sm text-muted truncate">{n.sub}</span>
              </span>
              <span className="shrink-0 rounded-full bg-[#f0f1f3] px-3 py-1 text-[13px] font-medium">{NEED_LABEL[n.kind]}</span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 4 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full min-h-[44px] text-sm font-medium text-muted hover:text-ink border-t border-line">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  )
}

export function NavCount({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null
  return (
    <span
      aria-label={`${n} waiting`}
      className={`min-w-[18px] h-[18px] px-1 rounded-full bg-fail text-white text-[11px] font-semibold leading-none flex items-center justify-center ${className}`}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
