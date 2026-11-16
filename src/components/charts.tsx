import { useState } from 'react'

// Small chart pieces for the dashboard. No chart library: bars are plain HTML, lines and the donut are SVG.
// Palette is the app's own: ink, greys, and the one blue already used for Bluedart.

// Mostly ink and grey; blue, green and amber appear only as soft accents (growth, good, needs attention).
export const CHART = {
  ink: '#12161c',
  grey: '#c3c8d0',
  mid: '#7b8490',
  track: '#eef0f2',
  blue: '#3d63c4',
  blueSoft: '#c9d6f3',
  green: '#2f8f66',
  greenSoft: '#bfe3d0',
  amber: '#c98a1b',
  amberSoft: '#f1d9a6'
}
export type Tone = 'ink' | 'grey' | 'blue' | 'blueSoft' | 'green' | 'greenSoft' | 'amber' | 'amberSoft'

// ---------------------------------------------------------------- horizontal bars
export interface BarRow {
  label: string
  value: number
  right?: string // text on the right (defaults to the value)
  note?: string // small grey text under the label
  tone?: Tone
}

export function HBars({ rows, empty = 'Nothing to show yet.' }: { rows: BarRow[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="text-sm text-muted py-2">{empty}</p>
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums">{r.right ?? r.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full" style={{ background: CHART.track }}>
            <div
              className="h-2 rounded-full"
              style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, background: CHART[r.tone ?? 'ink'] }}
            />
          </div>
          {r.note && <div className="text-[13px] text-muted mt-0.5">{r.note}</div>}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- paired columns (per week)
export interface PairPoint {
  label: string
  a: number
  b: number
}

export function PairBars({ points, aName, bName }: { points: PairPoint[]; aName: string; bName: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]))
  const shown = hover != null ? points[hover] : null
  const totA = points.reduce((n, p) => n + p.a, 0)
  const totB = points.reduce((n, p) => n + p.b, 0)
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap text-sm mb-3 min-h-[24px]">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART.blueSoft }} />
            {aName}
            <b className="tabular-nums">{shown ? shown.a : totA}</b>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART.blue }} />
            {bName}
            <b className="tabular-nums">{shown ? shown.b : totB}</b>
          </span>
        </div>
        <span className="text-muted">{shown ? shown.label : 'Last 12 weeks'}</span>
      </div>
      <div className="relative h-[180px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: `${i * 50}%` }} />
        ))}
        <span className="absolute -top-2.5 right-0 text-[11px] text-muted bg-surface pl-1 tabular-nums">{max}</span>
        <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2.5" onMouseLeave={() => setHover(null)}>
          {points.map((p, i) => (
            <div
              key={i}
              className="flex-1 h-full flex items-end justify-center gap-[3px] rounded-md"
              style={{ background: hover === i ? 'rgba(61,99,196,0.07)' : undefined }}
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            >
              <div className="w-1/2 max-w-[14px] rounded-t-[3px]" style={{ height: `${(p.a / max) * 100}%`, minHeight: p.a ? 2 : 0, background: CHART.blueSoft }} />
              <div className="w-1/2 max-w-[14px] rounded-t-[3px]" style={{ height: `${(p.b / max) * 100}%`, minHeight: p.b ? 2 : 0, background: CHART.blue }} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1.5 sm:gap-2.5 mt-1.5">
        {points.map((p, i) => (
          <span key={i} className={`flex-1 text-center text-[11px] whitespace-nowrap ${hover === i ? 'text-ink font-medium' : 'text-muted'}`}>
            {i % 2 === 0 || points.length < 8 ? p.label.split(' ').slice(0, 2).join(' ') : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- area / line (per day)
export function AreaChart({ values, labels, unit }: { values: number[]; labels: string[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = values.length
  const max = Math.max(1, ...values)
  const W = 300
  const H = 100
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W)
  const y = (v: number) => H - (v / max) * (H - 6) - 2
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm mb-3 min-h-[24px]">
        <span>
          <b className="tabular-nums">{hover != null ? values[hover] : total}</b> {unit}
        </span>
        <span className="text-muted">{hover != null ? labels[hover] : `${labels[0] ?? ''} to ${labels[n - 1] ?? ''}`}</span>
      </div>
      <div className="relative h-[180px]" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: `${i * 50}%` }} />
        ))}
        <span className="absolute -top-2.5 right-0 text-[11px] text-muted bg-surface pl-1 tabular-nums">{max}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden="true">
          <path d={area} fill={CHART.blue} opacity="0.12" />
          <path d={line} fill="none" stroke={CHART.blue} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke={CHART.mid} strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />}
        </svg>
        {hover != null && (
          <span
            className="absolute w-2.5 h-2.5 rounded-full ring-2 ring-white -translate-x-1/2 -translate-y-1/2"
            style={{ background: CHART.blue, left: `${(x(hover) / W) * 100}%`, top: `${(y(values[hover]) / H) * 100}%` }}
          />
        )}
        <div className="absolute inset-0 flex">
          {values.map((_, i) => (
            <div key={i} className="flex-1" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-muted mt-1.5">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor((n - 1) / 2)]}</span>
        <span>{labels[n - 1]}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- units by dispatch type
export interface ModePart {
  label: string
  units: number
  shipments: number
  color: string
}

// Total on top, one segmented bar for the split, then a row per type with its units.
export function ModeSplit({ parts, unit }: { parts: ModePart[]; unit: string }) {
  const total = parts.reduce((n, p) => n + p.units, 0)
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[34px] leading-none font-semibold tracking-tight tabular-nums">{total.toLocaleString()}</span>
        <span className="text-sm text-muted">{unit}</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden gap-[3px] mt-4" role="img" aria-label="Share of units by dispatch type" style={{ background: total ? undefined : CHART.track }}>
        {total > 0 &&
          parts
            .filter((p) => p.units > 0)
            .map((p) => <div key={p.label} style={{ width: `${(p.units / total) * 100}%`, background: p.color }} className="first:rounded-l-full last:rounded-r-full" />)}
      </div>
      <ul className="mt-4 divide-y divide-line">
        {parts.map((p) => (
          <li key={p.label} className="py-3 flex items-center gap-3">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: p.color }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{p.label}</div>
              <div className="text-[13px] text-muted">
                {p.shipments} shipment{p.shipments === 1 ? '' : 's'}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-semibold tabular-nums leading-tight">{p.units.toLocaleString()}</div>
              <div className="text-[13px] text-muted tabular-nums">{total ? Math.round((p.units / total) * 100) : 0}%</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- donut
export interface Part {
  label: string
  value: number
  color: string
}

export function Donut({ parts, centre }: { parts: Part[]; centre: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  const R = 38
  const C = 2 * Math.PI * R
  let off = 0
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative w-[140px] h-[140px] shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={R} fill="none" stroke={CHART.track} strokeWidth="14" />
          {total > 0 &&
            parts.map((p) => {
              const len = (p.value / total) * C
              const el = <circle key={p.label} cx="50" cy="50" r={R} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />
              off += len
              return el
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold leading-none tabular-nums">{total}</span>
          <span className="text-[12px] text-muted mt-1">{centre}</span>
        </div>
      </div>
      <ul className="space-y-2 text-sm min-w-0 flex-1">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="flex-1 min-w-0 truncate">{p.label}</span>
            <span className="tabular-nums font-medium">{p.value}</span>
            <span className="tabular-nums text-muted w-10 text-right">{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
