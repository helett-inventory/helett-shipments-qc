import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLive } from '../hooks/useLive'
import { useNeeds } from '../hooks/useNeeds'
import { NeedsStrip } from '../components/NeedsStrip'
import { supabase } from '../lib/supabase'
import { ModePill, Tip, Empty, ErrorBox, Loading, Page, StickyHead, PageTitle } from '../components/ui'
import { Glyph, INK, RED } from '../components/statusIcons'
import type { Inspection, Shipment, ShipmentLine } from '../types/db'

type Row = Pick<Inspection, 'id' | 'record_no' | 'status' | 'needs_recheck'> & {
  shipment_lines: Pick<ShipmentLine, 'product_name' | 'unit_qty' | 'status'> & {
    shipments: Pick<Shipment, 'fba_id' | 'ref' | 'on_hold' | 'status' | 'warehouse' | 'dispatch_mode'>
  }
}

const TABS: { id: Inspection['status']; label: string }[] = [
  { id: 'Open', label: 'To do' },
  { id: 'Submitted', label: 'Submitted' },
  { id: 'Closed', label: 'Closed' }
]

const COLS = 'lg:grid-cols-[7rem_1.2fr_1.8fr_.6fr_6rem]'

// QC case state as one icon, same language as the shipments list. Hold and recheck sit beside it as small chips.
function CaseStatus({ status, hold, recheck }: { status: string; hold: boolean; recheck: boolean }) {
  const main =
    status === 'Closed'
      ? { glyph: 'check' as const, label: 'Closed', bg: INK, fg: '#fff' }
      : status === 'Submitted'
        ? { glyph: 'clipCheck' as const, label: 'Submitted, waiting for manager', bg: INK, fg: '#fff' }
        : { glyph: 'clipCheck' as const, label: 'QC to do', bg: '#e6e9ed', fg: INK }
  const extras = [
    hold && { key: 'h', glyph: 'pause' as const, label: 'On hold', bg: RED },
    recheck && { key: 'r', glyph: 'half' as const, label: 'Quantity changed, recheck needed', bg: INK }
  ].filter(Boolean) as { key: string; glyph: 'pause' | 'half'; label: string; bg: string }[]
  if (extras.length === 0) {
    return (
      <Tip label={main.label}>
        <span role="img" aria-label={main.label} className="inline-flex items-center justify-center h-9 w-20 rounded-full" style={{ background: main.bg, color: main.fg }}>
          <Glyph glyph={main.glyph} size={18} />
        </span>
      </Tip>
    )
  }
  return (
    <span className="inline-flex items-center justify-center gap-1.5 h-9 w-24 rounded-full bg-[#f0f1f3]">
      {[{ key: 'm', glyph: main.glyph, label: main.label, bg: main.bg, fg: main.fg }, ...extras.map((x) => ({ ...x, fg: '#fff' }))].map((it) => (
        <Tip key={it.key} label={it.label}>
          <span role="img" aria-label={it.label} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: it.bg, color: it.fg }}>
            <Glyph glyph={it.glyph} size={14} />
          </span>
        </Tip>
      ))}
    </span>
  )
}

export function QCList() {
  const needs = useNeeds()
  const { data, error, loading } = useLive<Row[]>(
    async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select(
          'id, record_no, status, needs_recheck, shipment_lines(product_name, unit_qty, status, shipments(fba_id, ref, on_hold, status, warehouse, dispatch_mode))'
        )
        .order('record_no', { ascending: false })
        .limit(500)
      if (error) throw error
      return data as unknown as Row[]
    },
    ['inspections', 'shipment_lines', 'shipments'],
    'qc-list'
  )
  const [tab, setTab] = useState<Inspection['status']>('Open')
  const [query, setQuery] = useState('')

  const live = useMemo(() => (data ?? []).filter((r) => r.shipment_lines.status !== 'Cancelled'), [data])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return live
      .filter((r) => r.status === tab)
      .filter(
        (r) =>
          !q ||
          [r.record_no, r.shipment_lines.product_name, r.shipment_lines.shipments.fba_id].some((v) => v.toLowerCase().includes(q))
      )
  }, [live, tab, query])

  const filterBar = (cls: string) => (
      <div className={`flex-col lg:flex-row lg:items-center gap-3 pt-1 pb-3 ${cls}`}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, FBA ID, record"
          aria-label="Search QC cases"
          className="w-full lg:w-80 min-h-[44px] px-3 rounded-lg bg-surface ring-1 ring-[#cfd4da] focus:ring-2 focus:ring-ink focus:outline-none"
        />
        <div className="flex gap-1.5 p-1 -m-1" role="tablist" aria-label="Case status">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 lg:flex-none min-h-[44px] px-4 rounded-full text-sm font-medium ${
                tab === t.id ? 'bg-ink text-white' : 'bg-surface ring-1 ring-[#cfd4da] text-muted hover:text-ink'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 ${tab === t.id ? 'text-white/65' : 'text-muted/70'}`}>
                {live.filter((r) => r.status === t.id).length}
              </span>
            </button>
          ))}
        </div>
      </div>
  )

  return (
    <Page wide>
      <StickyHead wide>
        <PageTitle title="QC cases" />
      {filterBar('hidden lg:flex')}
      </StickyHead>
      {filterBar('flex lg:hidden pt-3')}
      <NeedsStrip items={needs.qc} />

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && rows.length === 0 && <Empty>{tab === 'Open' ? 'Nothing to inspect right now.' : 'No cases here.'}</Empty>}

      {rows.length > 0 && (
        <div className="bg-surface shadow-card rounded-xl overflow-hidden">
          <div className={`hidden lg:grid ${COLS} gap-x-4 px-5 py-2.5 border-b border-line text-[13px] text-muted font-medium`}>
            <span>Type</span>
            <span>Shipment</span>
            <span>Product</span>
            <span>Units</span>
            <span>Status</span>
          </div>
          <ul>
            {rows.map((r) => {
              const l = r.shipment_lines
              const s = l.shipments
              return (
                <li key={r.id} className="border-t first:border-t-0 border-line">
                  <Link
                    to={`/qc/${r.id}`}
                    className={`flex flex-col gap-2.5 lg:grid ${COLS} lg:gap-x-4 px-4 lg:px-5 py-4 lg:py-3.5 lg:items-center hover:bg-canvas ${
                      s.on_hold ? 'bg-fail/[0.04]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 lg:contents">
                      <div className="lg:col-start-1 lg:row-start-1">
                        <ModePill large mode={s.dispatch_mode} cancelled={s.status === 'Cancelled'} />
                      </div>
                      <div className="lg:col-start-5 lg:row-start-1">
                        <CaseStatus status={r.status} hold={s.on_hold} recheck={r.needs_recheck} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3 text-sm lg:contents">
                      <div className="font-mono font-medium lg:col-start-2 lg:row-start-1 lg:text-[15px]">{s.fba_id}</div>
                                          </div>
                    <div className="min-w-0 lg:col-start-3 lg:row-start-1">
                      <div className="font-medium">{l.product_name}</div>
                      <div className="text-[13px] text-muted">
                        {r.record_no} · {s.warehouse}
                        <span className="lg:hidden"> · {l.unit_qty} units</span>
                      </div>
                    </div>
                    <div className="hidden lg:block text-sm lg:col-start-4 lg:row-start-1">{l.unit_qty}</div>
                    {r.needs_recheck && <div className="text-sm text-warn lg:hidden">Quantity changed. Recheck needed.</div>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Page>
  )
}
