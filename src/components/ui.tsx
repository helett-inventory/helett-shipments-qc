import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { signedUrl } from '../lib/signatures'

/* ------------------------------------------------------------ buttons */

type BtnTone = 'ink' | 'line' | 'lineDanger' | 'lineWarn' | 'danger' | 'warn' | 'ok'

const TONES: Record<BtnTone, string> = {
  ink: 'bg-ink text-white hover:bg-ink/90',
  line: 'bg-[#eceef1] text-ink hover:bg-[#e1e4e8]',
  lineDanger: 'bg-[#fde8e6] text-fail hover:bg-[#fbd8d4]',
  lineWarn: 'bg-[#fdeedb] text-warn hover:bg-[#fbe2c3]',
  danger: 'bg-fail text-white hover:bg-fail/90',
  ok: 'bg-ok text-white hover:bg-ok/90',
  // Colour actions are solid: red = removes or releases, orange = cancels, green = approves, black = the main action
  warn: 'bg-warn text-white hover:bg-warn/90'
}

export function Btn({
  tone = 'ink',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }) {
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-[44px] px-4 rounded-lg text-[15px] font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${TONES[tone]} ${className}`}
    />
  )
}

/* ------------------------------------------------------------ tooltip */

// The app's own hover hint (replaces the browser's plain title tooltip). Shows on hover, keyboard focus, and a tap on touch screens.
export function Tip({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)

  function show() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const below = r.top < 64
    const x = Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130)
    setPos({ x, y: below ? r.bottom : r.top, below })
  }
  function hide() {
    window.clearTimeout(timer.current)
    setPos(null)
  }
  useEffect(() => {
    if (!pos) return
    const off = () => setPos(null)
    window.addEventListener('scroll', off, true)
    return () => window.removeEventListener('scroll', off, true)
  }, [pos])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={() => {
        show()
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(hide, 1800)
      }}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', left: pos.x, top: pos.y, transform: pos.below ? 'translate(-50%, 8px)' : 'translate(-50%, calc(-100% - 8px))' }}
            className="tip z-[60] pointer-events-none w-max max-w-[260px] rounded-lg bg-ink text-white text-[12.5px] font-medium leading-snug px-2.5 py-1.5 shadow-lg text-center"
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  )
}

/* ------------------------------------------------------------ forms */

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[13px] text-muted mt-1">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full min-h-[44px] px-3 rounded-lg bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none text-[15px] disabled:bg-canvas disabled:text-muted'

// Pick one of a few options (replaces native radios).
export function Choice<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: T[]
  value: T | ''
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div
      className="flex gap-2"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        // Arrow keys move the selection, like a spreadsheet cell: Tab leaves the group.
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
        if (!dir) return
        e.preventDefault()
        const at = Math.max(0, options.indexOf(value as T))
        const next = options[(at + dir + options.length) % options.length]
        onChange(next)
        ;(e.currentTarget.querySelectorAll('button')[options.indexOf(next)] as HTMLElement | undefined)?.focus()
      }}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          tabIndex={o === value || (value === '' && o === options[0]) ? 0 : -1}
          onClick={() => onChange(o)}
          className={`flex-1 min-h-[44px] px-3 rounded-lg text-[15px] font-medium ${
            o === value ? 'bg-ink text-white' : 'bg-[#eceef1] hover:bg-[#e1e4e8]'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ layout */

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`mx-auto px-4 py-5 lg:py-8 ${wide ? 'max-w-[1760px] lg:px-6' : 'max-w-4xl lg:px-8'}`}>{children}</div>
}

export function PageTitle({
  title,
  sub,
  action
}: {
  title: string
  sub?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="page-title flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-2xl lg:text-[28px] font-semibold tracking-tight leading-tight break-words">{title}</h1>
        {sub && <div className="text-sm text-muted mt-1">{sub}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Panel({
  title,
  action,
  children,
  flush
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  flush?: boolean
}) {
  return (
    <section className={`bg-surface shadow-card rounded-xl ${flush ? 'overflow-hidden' : ''}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-4 min-h-[48px] border-b border-line">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  )
}

// Back link + title stay pinned under the mobile top bar (and at the very top on desktop) while the page scrolls.
export function StickyHead({ wide, children }: { wide?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`sticky top-14 lg:top-0 z-20 bg-canvas -mx-4 px-4 pt-3 -mt-3 pb-1 print:static ${
        wide ? 'lg:-mx-6 lg:px-6' : 'lg:-mx-8 lg:px-8'
      } [&_.page-title]:!mb-3`}
    >
      {children}
    </div>
  )
}

export function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a href={`#${to}`} className="inline-flex items-center gap-1 min-h-[44px] text-sm text-muted hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {children}
    </a>
  )
}

/* ------------------------------------------------------------ modal */

export function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-40 bg-ink/40 flex items-end sm:items-center justify-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-surface w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between px-5 h-14 sticky top-0 bg-surface border-b border-line z-10">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 w-11 h-11 text-2xl leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ status */

type Tone = 'gray' | 'new' | 'warn' | 'info' | 'ok' | 'fail'

// Badges are labels, not buttons: a rounded pill with no outline, bold text, and a small coloured glyph that carries the meaning.
// Done states (Closed, Label OK) also turn the text green.
const CHIP: Record<Tone, string> = {
  gray: 'bg-[#eceef2] text-ink',
  new: 'bg-[#fdf1c4] text-[#6b4a05]', // Created, Open: yellow
  warn: 'bg-[#eceef2] text-ink',
  info: 'bg-[#eceef2] text-ink',
  ok: 'bg-[#d8f2e0] text-[#0f6b32]', // Closed: green
  fail: 'bg-[#eceef2] text-ink'
}

function Glyph({ tone }: { tone: Tone }) {
  const c = { className: 'shrink-0', width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true } as const
  switch (tone) {
    case 'ok':
      return (
        <svg {...c} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 5.5 4 8l4.5-6" />
        </svg>
      )
    case 'warn':
      return (
        <svg {...c} className="shrink-0 text-warn">
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 1a4 4 0 0 1 0 8z" fill="currentColor" />
        </svg>
      )
    case 'info':
      return (
        <svg {...c} className="shrink-0 text-info">
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
      )
    case 'fail':
      return (
        <svg {...c} className="shrink-0 text-fail">
          <path d="M5 1 9.5 9h-9z" fill="currentColor" />
        </svg>
      )
    case 'new':
      return (
        <svg {...c}>
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )
    default:
      return (
        <svg {...c} className="shrink-0 text-muted">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )
  }
}

const STATUS_TONE: Record<string, Tone> = {
  Created: 'new',
  Cancelled: 'gray',
  'QC In Progress': 'warn',
  'QC Open': 'new',
  Open: 'new',
  'Not Dispatched': 'warn',
  'QC Done': 'info',
  'QC Submitted': 'info',
  Submitted: 'info',
  'Partially Dispatched': 'info',
  Dispatched: 'info',
  'Awaiting WM': 'info',
  Closed: 'ok'
}

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-7 pl-2.5 pr-3 rounded-full text-[13px] leading-none font-semibold whitespace-nowrap ${CHIP[tone]}`}>
      <Glyph tone={tone} />
      {children}
    </span>
  )
}

export function StatusStamp({ status }: { status: string }) {
  // A new shipment is simply "Open" to people; the stored status stays "Created". A shipment the manager has approved reads "Dispatched"; the stored status stays "Closed".
  const label = status === 'Created' ? 'Open' : status === 'Closed' ? 'Dispatched' : status
  return <Chip tone={STATUS_TONE[status] ?? 'gray'}>{label}</Chip>
}

// Dispatch mode label: same neutral pill as the status badges. An optional dot (e.g. Amazon receiving) sits inside it.
// Three modes, three clearly different weights from the app's own palette: Drop In solid black, ATS grey, Bluedart soft blue.
const MODE_LOOK: Record<string, string> = {
  ATS: 'bg-[#e1e4e9] text-ink',
  'Drop In': 'bg-ink text-white',
  Bluedart: 'bg-[#dde7fb] text-[#1d4fb8]'
}

// A cancelled shipment drops its type colour for a pale red, so it never reads as live.
export function ModePill({ mode, dot, large, cancelled }: { mode: string | null | undefined; dot?: React.ReactNode; large?: boolean; cancelled?: boolean }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full font-semibold leading-none whitespace-nowrap text-center ${
        large ? 'h-9 w-28 text-[15px]' : 'h-7 px-3 gap-2 text-[13px]'
      } ${cancelled ? 'bg-[#fde8e6] text-fail/75' : (MODE_LOOK[mode ?? ''] ?? 'bg-[#eceef2] text-muted')}`}
    >
      {mode || 'No mode'}
      {dot && (large ? <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex">{dot}</span> : dot)}
    </span>
  )
}

export function HoldStamp() {
  return <Chip tone="fail">On hold</Chip>
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="bg-[#fde8e6] text-fail rounded-lg px-3 py-2.5 text-sm my-3">
      {message}
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'fail' | 'warn'; children: React.ReactNode }) {
  const cls = tone === 'fail' ? 'bg-[#fde8e6] text-fail' : 'bg-[#fdeedb] text-warn'
  return (
    <div role="alert" className={`rounded-lg px-4 py-3 mb-4 text-[15px] font-medium ${cls}`}>
      {children}
    </div>
  )
}

export function Loading() {
  return <div className="p-10 text-center text-muted">Loading…</div>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-12 text-center text-muted">{children}</p>
}

/* ------------------------------------------------------------ signatures */

export function SignImg({ path, className = '' }: { path: string | null | undefined; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (path) signedUrl(path).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [path])
  if (!path || !url) return <span className="text-xs text-muted">{path ? '…' : ''}</span>
  return <img src={url} alt="Signature" className={className} />
}
