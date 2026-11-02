import { useEffect, useState } from 'react'
import { signedUrl } from '../lib/signatures'

/* ------------------------------------------------------------ buttons */

type BtnTone = 'ink' | 'line' | 'lineDanger' | 'lineWarn' | 'danger' | 'warn' | 'ok'

const TONES: Record<BtnTone, string> = {
  ink: 'bg-ink text-white border border-ink hover:bg-ink/90',
  line: 'bg-surface text-ink border border-line hover:bg-canvas',
  // same white button as 'line', only the border carries the colour
  lineDanger: 'bg-surface text-ink border border-fail hover:bg-fail/5',
  lineWarn: 'bg-surface text-ink border border-warn hover:bg-warn/5',
  danger: 'bg-fail text-white border border-fail hover:bg-fail/90',
  ok: 'bg-ok text-white border border-ok hover:bg-ok/90',
  // Colour actions are solid: red = removes or releases, orange = cancels, green = approves, black = the main action
  warn: 'bg-warn text-white border border-warn hover:bg-warn/90'
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
  'w-full min-h-[44px] px-3 rounded-lg border border-line bg-surface text-[15px] focus:border-ink focus:outline-none disabled:bg-canvas disabled:text-muted'

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
    <div className="flex gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={`flex-1 min-h-[44px] px-3 rounded-lg border text-[15px] font-medium ${
            o === value ? 'bg-ink text-white border-ink' : 'bg-surface border-line hover:bg-canvas'
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
    <div className="flex items-start justify-between gap-3 mb-5">
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
    <section className={`bg-surface border border-line rounded-xl ${flush ? 'overflow-hidden' : ''}`}>
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

type Tone = 'gray' | 'warn' | 'info' | 'ok' | 'fail'

// Badges are labels, not buttons, so none is filled: done states (Closed, Label OK) are a green outline with green text, the rest a black outline.
const OUTLINE = 'bg-surface text-ink border-ink'
const CHIP: Record<Tone, string> = {
  gray: OUTLINE,
  warn: OUTLINE,
  info: OUTLINE,
  ok: 'bg-surface text-ok border-ok',
  fail: OUTLINE
}

const STATUS_TONE: Record<string, Tone> = {
  Created: 'gray',
  Cancelled: 'gray',
  'QC In Progress': 'warn',
  'QC Open': 'warn',
  Open: 'warn',
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
    <span className={`inline-flex items-center h-6 px-2.5 rounded-md border text-[13px] leading-none font-medium whitespace-nowrap ${CHIP[tone]}`}>
      {children}
    </span>
  )
}

export function StatusStamp({ status }: { status: string }) {
  return <Chip tone={STATUS_TONE[status] ?? 'gray'}>{status}</Chip>
}

export function HoldStamp() {
  return <Chip tone="fail">On hold</Chip>
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="border border-fail/30 bg-fail/5 text-fail rounded-lg px-3 py-2.5 text-sm my-3">
      {message}
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'fail' | 'warn'; children: React.ReactNode }) {
  const cls = tone === 'fail' ? 'border-fail/30 bg-fail/5 text-fail' : 'border-warn/30 bg-warn/5 text-warn'
  return (
    <div role="alert" className={`border rounded-lg px-4 py-3 mb-4 text-[15px] font-medium ${cls}`}>
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
