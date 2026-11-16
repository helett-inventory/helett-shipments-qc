import { useEffect, useRef, useState } from 'react'

// Date / date-and-time field. Tapping it opens a small calendar (and a time row when `withTime`);
// nothing changes in the form until the person presses OK.
// Values are the same strings a browser date input uses: 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm'.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const pad = (n: number) => String(n).padStart(2, '0')
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

interface Parts {
  date: Date // local, midnight
  hour12: number // 1..12
  minute: number // 0..59
  pm: boolean
}

function parse(v: string): Parts | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return null
  const h = m[4] ? Number(m[4]) : 9
  return { date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), hour12: h % 12 || 12, minute: m[5] ? Number(m[5]) : 0, pm: h >= 12 }
}

function build(p: Parts, withTime: boolean): string {
  const d = `${p.date.getFullYear()}-${pad(p.date.getMonth() + 1)}-${pad(p.date.getDate())}`
  if (!withTime) return d
  const h24 = (p.hour12 % 12) + (p.pm ? 12 : 0)
  return `${d}T${pad(h24)}:${pad(p.minute)}`
}

function show(v: string, withTime: boolean): string {
  const p = parse(v)
  if (!p) return ''
  const day = `${pad(p.date.getDate())} ${MON[p.date.getMonth()]} ${p.date.getFullYear()}`
  return withTime ? `${day}, ${p.hour12}:${pad(p.minute)} ${p.pm ? 'PM' : 'AM'}` : day
}

const Chevron = ({ dir }: { dir: 'l' | 'r' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'l' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
  </svg>
)

export function DateInput({
  value,
  onChange,
  withTime,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  withTime?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const [draft, setDraft] = useState<Parts>(() => parse(value) ?? blank())
  const [view, setView] = useState(() => new Date(draft.date.getFullYear(), draft.date.getMonth(), 1))
  const [hourText, setHourText] = useState('')
  const [minText, setMinText] = useState('')

  function blank(): Parts {
    const n = new Date()
    return { date: new Date(n.getFullYear(), n.getMonth(), n.getDate()), hour12: n.getHours() % 12 || 12, minute: 0, pm: n.getHours() >= 12 }
  }

  function begin() {
    if (disabled) return
    const d = parse(value) ?? blank()
    setDraft(d)
    setView(new Date(d.date.getFullYear(), d.date.getMonth(), 1))
    setHourText(String(d.hour12))
    setMinText(pad(d.minute))
    const r = ref.current?.getBoundingClientRect()
    if (r) {
      setUp(window.innerHeight - r.bottom < (withTime ? 430 : 380) && r.top > window.innerHeight - r.bottom)
      setAlignRight(r.left + 320 > window.innerWidth - 8)
    }
    setOpen(true)
  }

  function close(focus = true) {
    setOpen(false)
    if (focus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close(false)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation() // do not also close a dialog around this field
        close()
      }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // time inputs: keep what is typed, validate when leaving the box
  function commitHour(t: string) {
    const n = Math.min(12, Math.max(1, Number(t.replace(/\D/g, '')) || draft.hour12))
    setDraft((d) => ({ ...d, hour12: n }))
    setHourText(String(n))
  }
  function commitMin(t: string) {
    const n = Math.min(59, Math.max(0, Number(t.replace(/\D/g, '')) || 0))
    setDraft((d) => ({ ...d, minute: n }))
    setMinText(pad(n))
  }
  function ok() {
    // include a time still being typed
    const h = Math.min(12, Math.max(1, Number(hourText.replace(/\D/g, '')) || draft.hour12))
    const mi = Math.min(59, Math.max(0, Number(minText.replace(/\D/g, '')) || 0))
    onChange(build({ ...draft, hour12: h, minute: mi }, !!withTime))
    close()
  }

  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7
  const count = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1))]
  const today = new Date()
  const label = show(value, !!withTime)

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : begin())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full min-h-[44px] px-3 rounded-lg text-[15px] text-left flex items-center justify-between gap-2 bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none disabled:bg-canvas disabled:text-muted cursor-pointer disabled:cursor-default"
      >
        <span className={`truncate ${label ? 'text-ink' : 'text-muted'}`}>{label || (withTime ? 'Select date and time' : 'Select date')}</span>
        <svg className="w-[18px] h-[18px] text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={withTime ? 'Choose date and time' : 'Choose date'}
          className={`absolute z-40 w-[min(320px,calc(100vw-2rem))] bg-surface rounded-2xl shadow-[0_12px_40px_rgba(16,24,40,0.18)] ring-1 ring-black/5 p-3 ${up ? 'bottom-full mb-2' : 'top-full mt-2'} ${alignRight ? 'right-0' : 'left-0'}`}
          // Inside a <label> a click anywhere re-clicks the field's button (and would close this): stop that.
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault()
              ok()
            }
          }}
        >
          <div className="flex items-center justify-between h-9">
            <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} aria-label="Previous month" className="w-9 h-9 rounded-full hover:bg-canvas flex items-center justify-center">
              <Chevron dir="l" />
            </button>
            <span className="font-semibold text-[15px]">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </span>
            <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} aria-label="Next month" className="w-9 h-9 rounded-full hover:bg-canvas flex items-center justify-center">
              <Chevron dir="r" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-[12px] text-muted mt-1 mb-0.5">
            {WEEK.map((w) => (
              <span key={w} className="h-8 flex items-center justify-center">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) =>
              d ? (
                <div key={i} className="h-10 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, date: d }))}
                    aria-label={d.toDateString()}
                    aria-pressed={sameDay(d, draft.date)}
                    className={`w-9 h-9 rounded-full text-sm tabular-nums flex items-center justify-center ${
                      sameDay(d, draft.date) ? 'bg-ink text-white font-semibold' : 'hover:bg-[#e8eefb]'
                    } ${sameDay(d, today) && !sameDay(d, draft.date) ? 'ring-1 ring-ink' : ''}`}
                  >
                    {d.getDate()}
                  </button>
                </div>
              ) : (
                <span key={i} />
              )
            )}
          </div>

          {withTime && (
            <div className="flex items-center gap-2 mt-2 pt-3 border-t border-line">
              <span className="text-sm text-muted mr-1">Time</span>
              <input
                inputMode="numeric"
                aria-label="Hour"
                value={hourText}
                maxLength={2}
                onChange={(e) => setHourText(e.target.value.replace(/\D/g, ''))}
                onBlur={(e) => commitHour(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-12 min-h-[40px] rounded-lg bg-[#f0f2f4] text-center text-[15px] tabular-nums focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none"
              />
              <span className="font-semibold">:</span>
              <input
                inputMode="numeric"
                aria-label="Minute"
                value={minText}
                maxLength={2}
                onChange={(e) => setMinText(e.target.value.replace(/\D/g, ''))}
                onBlur={(e) => commitMin(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-12 min-h-[40px] rounded-lg bg-[#f0f2f4] text-center text-[15px] tabular-nums focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none"
              />
              <div className="flex rounded-lg bg-[#f0f2f4] p-0.5 ml-1" role="group" aria-label="AM or PM">
                {[false, true].map((pm) => (
                  <button
                    key={String(pm)}
                    type="button"
                    aria-pressed={draft.pm === pm}
                    onClick={() => setDraft((d) => ({ ...d, pm }))}
                    className={`min-h-[36px] px-3 rounded-md text-sm font-medium ${draft.pm === pm ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
                  >
                    {pm ? 'PM' : 'AM'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line">
            <div className="flex gap-3 text-sm">
              <button
                type="button"
                onClick={() => {
                  const n = new Date()
                  setDraft((p) => ({ ...p, date: new Date(n.getFullYear(), n.getMonth(), n.getDate()) }))
                  setView(new Date(n.getFullYear(), n.getMonth(), 1))
                }}
                className="font-medium underline underline-offset-4 decoration-[#c3c8d0] hover:decoration-ink"
              >
                Today
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('')
                    close()
                  }}
                  className="text-muted underline underline-offset-4 decoration-[#c3c8d0] hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => close()} className="min-h-[40px] px-4 rounded-lg bg-[#eceef1] hover:bg-[#e1e4e8] text-sm font-medium">
                Cancel
              </button>
              <button type="button" onClick={ok} className="min-h-[40px] px-5 rounded-lg bg-ink text-white text-sm font-medium">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
