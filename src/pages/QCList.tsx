import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { Empty, ErrorBox, HoldStamp, Loading, Page, PageTitle, StatusStamp } from '../components/ui'
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

const COLS = 'lg:grid-cols-[1.6fr_1.2fr_.7fr_1fr_1fr]'

export function QCList() {
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

  return (
    <Page wide>
      <PageTitle title="QC cases" />

      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, FBA ID, record"
          aria-label="Search QC cases"
          className="w-full lg:w-80 min-h-[44px] px-3 rounded-lg bg-surface shadow-card focus:ring-2 focus:ring-ink focus:outline-none"
        />
        <div className="flex gap-1.5" role="tablist" aria-label="Case status">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 lg:flex-none min-h-[40px] px-4 rounded-full text-sm font-medium ${
                tab === t.id ? 'bg-ink text-white' : 'bg-surface shadow-card text-muted hover:text-ink'
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

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && rows.length === 0 && <Empty>{tab === 'Open' ? 'Nothing to inspect right now.' : 'No cases here.'}</Empty>}

      {rows.length > 0 && (
        <div className="bg-surface shadow-card rounded-xl overflow-hidden">
          <div className={`hidden lg:grid ${COLS} gap-x-4 px-5 py-2.5 border-b border-line text-[13px] text-muted font-medium`}>
            <span>Product</span>
            <span>Shipment</span>
            <span>Units</span>
            <span>Mode</span>
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
                    className={`grid grid-cols-[1fr_auto] ${COLS} gap-x-4 gap-y-1 px-4 lg:px-5 py-3.5 items-center hover:bg-canvas ${
                      s.on_hold ? 'bg-fail/[0.04]' : ''
                    }`}
                  >
                    <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                      <div className="font-medium truncate">{l.product_name}</div>
                      <div className="text-[13px] text-muted">{r.record_no}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5 lg:justify-start lg:col-start-5 lg:row-start-1">
                      {s.on_hold && <HoldStamp />}
                      <StatusStamp status={r.status} />
                    </div>
                    <div className="col-span-2 text-sm lg:col-span-1 lg:col-start-2 lg:row-start-1">
                      <span className="font-mono">{s.fba_id}</span>
                      <span className="text-muted"> · {s.warehouse}</span>
                    </div>
                    <div className="col-span-2 text-sm text-muted lg:text-ink lg:col-span-1 lg:col-start-3 lg:row-start-1">
                      {l.unit_qty} units
                    </div>
                    <div className="col-span-2 text-sm text-muted lg:col-span-1 lg:col-start-4 lg:row-start-1">
                      {s.dispatch_mode ?? ''}
                    </div>
                    {r.needs_recheck && <div className="col-span-2 text-sm text-warn lg:col-span-5">Quantity changed. Recheck needed.</div>}
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
