import { useEffect, useMemo, useRef, useState } from 'react'
import { customRange, PRESETS, preset, spanText, type DRange } from '../lib/dateRange'

// A calendar range picker: presets on the side, click a first day and then a last day, then Apply.
// Phones get one month and the presets on top; wider screens get two months side by side.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

function Month({
  year,
  month,
  start,
  end,
  hover,
  today,
  onPick,
  onHover
}: {
  year: number
  month: number
  start: Date | null
  end: Date | null
  hover: Date | null
  today: Date
  onPick: (d: Date) => void
  onHover: (d: Date | null) => void
}) {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const count = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(year, month, i + 1))]
  // while choosing the last day, preview the span up to the day under the pointer
  const lo = start && (end ?? hover) ? (start <= (end ?? hover!) ? start : (end ?? hover!)) : start
  const hi = start && (end ?? hover) ? (start <= (end ?? hover!) ? (end ?? hover!) : start) : start

  return (
    <div className="w-full">
      <div className="text-center font-semibold text-[15px] h-9 flex items-center justify-center">
        {MONTHS[month]} {year}
      </div>
      <div className="grid grid-cols-7 text-center text-[12px] text-muted mb-1">
        {WEEK.map((w) => (
          <span key={w} className="h-8 flex items-center justify-center">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7" onMouseLeave={() => onHover(null)}>
        {cells.map((d, i) => {
          if (!d) return <span key={i} />
          const future = d > today
          const isStart = !!lo && sameDay(d, lo)
          const isEnd = !!hi && sameDay(d, hi)
          const inside = !!lo && !!hi && d > lo && d < hi
          const edge = isStart || isEnd
          return (
            <div key={i} className={`h-10 flex items-center justify-center ${inside ? 'bg-[#e8eefb]' : ''} ${isStart && hi && !sameDay(lo!, hi) ? 'bg-gradient-to-r from-transparent from-50% to-[#e8eefb] to-50%' : ''} ${isEnd && lo && !sameDay(lo, hi!) ? 'bg-gradient-to-l from-transparent from-50% to-[#e8eefb] to-50%' : ''}`}>
              <button
                type="button"
                disabled={future}
                onClick={() => onPick(d)}
                onMouseEnter={() => onHover(d)}
                aria-label={d.toDateString()}
                aria-pressed={edge}
                className={`w-9 h-9 rounded-full text-sm tabular-nums flex items-center justify-center ${
                  edge ? 'bg-ink text-white font-semibold' : future ? 'text-[#c3c8d0] cursor-not-allowed' : 'hover:bg-[#e8eefb]'
                } ${sameDay(d, today) && !edge ? 'ring-1 ring-ink' : ''}`}
              >
                {d.getDate()}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const Chevron = ({ dir }: { dir: 'l' | 'r' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'l' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
  </svg>
)

export function DateRangePicker({ value, onChange }: { value: DRange; onChange: (r: DRange) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const today = useMemo(() => day0(new Date()), [])

  // what is being picked in the calendar (not applied until "Apply")
  const [start, setStart] = useState<Date | null>(null)
  const [end, setEnd] = useState<Date | null>(null)
  const [hover, setHover] = useState<Date | null>(null)
  // the left month shown; the right one is the next month
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth() - 1, 1))

  const begin = () => {
    setStart(value.from != null ? day0(new Date(value.from)) : null)
    setEnd(value.to != null ? day0(new Date(value.to)) : null)
    const anchor = value.to != null ? new Date(value.to) : today
    // two months side by side on wide screens (the last day sits in the right one); one month on phones (show it)
    const wide = window.innerWidth >= 640
    setView(new Date(anchor.getFullYear(), anchor.getMonth() - (wide ? 1 : 0), 1))
    setHover(null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const pick = (d: Date) => {
    if (!start || end) {
      setStart(d)
      setEnd(null)
    } else {
      setEnd(d)
    }
  }
  const choose = (id: string) => {
    onChange(preset(id))
    setOpen(false)
  }
  const apply = () => {
    if (!start) return
    onChange(customRange(start, end ?? start))
    setOpen(false)
  }
  const shift = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1))
  const right = new Date(view.getFullYear(), view.getMonth() + 1, 1)
  const canNext = right < new Date(today.getFullYear(), today.getMonth(), 1)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : begin())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="min-h-[44px] pl-3 pr-3.5 rounded-lg bg-surface ring-1 ring-[#cfd4da] hover:ring-ink/40 flex items-center gap-2.5 text-left max-w-full"
      >
        <svg className="shrink-0 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span className="min-w-0 flex items-baseline gap-2 truncate">
          <span className="font-medium text-sm">{value.title}</span>
          <span className="text-[13px] text-muted hidden sm:inline truncate">{spanText(value)}</span>
        </span>
        <svg className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date range"
          className="absolute right-0 top-full mt-2 z-40 w-[min(calc(100vw-2rem),700px)] bg-surface rounded-2xl shadow-[0_12px_40px_rgba(16,24,40,0.18)] ring-1 ring-black/5 p-3 sm:p-4"
        >
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-5">
            {/* presets */}
            <div className="no-scrollbar flex sm:flex-col gap-1.5 overflow-x-auto sm:overflow-visible sm:w-[130px] shrink-0 -mx-1 px-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p.id)}
                  className={`shrink-0 min-h-[38px] px-3 rounded-full sm:rounded-lg text-sm text-left whitespace-nowrap ${
                    value.id === p.id ? 'bg-ink text-white font-medium' : 'bg-[#f0f1f3] sm:bg-transparent hover:bg-[#e8eefb]'
                  }`}
                >
                  {p.title}
                </button>
              ))}
            </div>

            {/* calendar */}
            <div className="flex-1 min-w-0">
              <div className="relative">
                <button type="button" onClick={() => shift(-1)} aria-label="Earlier months" className="absolute left-0 top-0 w-9 h-9 rounded-full hover:bg-canvas flex items-center justify-center z-10">
                  <Chevron dir="l" />
                </button>
                <button
                  type="button"
                  onClick={() => shift(1)}
                  disabled={!canNext}
                  aria-label="Later months"
                  className="absolute right-0 top-0 w-9 h-9 rounded-full hover:bg-canvas flex items-center justify-center z-10 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Chevron dir="r" />
                </button>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                  <Month year={view.getFullYear()} month={view.getMonth()} start={start} end={end} hover={hover} today={today} onPick={pick} onHover={setHover} />
                  <div className="hidden sm:block">
                    <Month year={right.getFullYear()} month={right.getMonth()} start={start} end={end} hover={hover} today={today} onPick={pick} onHover={setHover} />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap mt-3 pt-3 border-t border-line">
                <span className="text-sm text-muted min-w-0">
                  {start ? (
                    <>
                      <b className="text-ink">{customRange(start, end ?? start).label}</b>
                      {!end && ' · pick the last day'}
                    </>
                  ) : (
                    'Pick the first day'
                  )}
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="min-h-[40px] px-4 rounded-lg bg-[#eceef1] hover:bg-[#e1e4e8] text-sm font-medium">
                    Cancel
                  </button>
                  <button type="button" onClick={apply} disabled={!start} className="min-h-[40px] px-4 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-40">
                    Apply
                  </button>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
