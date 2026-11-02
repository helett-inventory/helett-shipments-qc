import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../hooks/useLive'
import { errText, supabase, callRpc } from '../lib/supabase'
import { uploadSignature } from '../lib/signatures'
import { fmtDate, fmtDateTime, fromLocalInput, toLocalInput } from '../lib/format'
import { BackLink, Btn, Choice, Chip, ErrorBox, Field, HoldStamp, Loading, Modal, Notice, Page, PageTitle, Panel, StatusStamp, inputCls } from '../components/ui'
import { SearchableSelect } from '../components/SearchableSelect'
import { DateInput } from '../components/DateInput'
import { SignaturePad } from '../components/SignaturePad'
import { usePeople } from '../hooks/usePeople'
import { getSkus } from '../services/lookups'
import { invalidateAll } from '../lib/cache'
import { DISPATCH_MODES, FULFILMENT_CENTRES, TRANSPORTS, needsAppointment, needsBoxLabels, needsTransport, type DispatchMode } from '../data/options'
import { ConfirmModal, ReviewStep, type Change } from '../components/ReasonModal'
import type { AuditRow, BoxCheck, Dispatch, Inspection, Shipment, ShipmentLine, SkuRow } from '../types/db'

const BarcodeScanner = lazy(() => import('../components/BarcodeScanner'))

const BOX_REASON: Record<string, string> = {
  unreadable: 'This is not an Amazon carton label.',
  wrong_fba: 'This label is for a different FBA shipment.'
}

type LineRow = ShipmentLine & { inspections: Inspection | Inspection[] | null }
type Bundle = Shipment & {
  shipment_lines: LineRow[]
  dispatches: Dispatch[]
  box_label_checks: BoxCheck[]
  audit: AuditRow[]
}

// Units this line can send: what passed QC, never more than the shipment ordered.
const shipQty = (l: LineRow, i: Inspection | null) => Math.min(i?.accepted_qty ?? 0, l.unit_qty)

const insp = (l: LineRow): Inspection | null => (Array.isArray(l.inspections) ? l.inspections[0] ?? null : l.inspections)

function dispatchedUnits(b: Bundle, lineId: string): number {
  let n = 0
  for (const d of b.dispatches) for (const dl of d.dispatch_lines ?? []) if (dl.line_id === lineId) n += dl.units
  return n
}

export function ShipmentDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const isInv = profile?.role === 'inventory' || !!profile?.is_admin
  const isWm = profile?.role === 'wm' || !!profile?.is_admin
  const isAdmin = !!profile?.is_admin
  const canFillQc = profile?.role === 'qc' || profile?.role === 'inventory' || isAdmin
  const navigate = useNavigate()

  const { data: b, error, loading, reload } = useLive<Bundle>(
    async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select(
          '*, shipment_lines(*, inspections(id, record_no, status, accepted_qty, rejected_qty, needs_recheck)), dispatches(*, dispatch_lines(*)), box_label_checks(*)'
        )
        .eq('id', id!)
        .single()
      if (error) throw error
      const row = data as unknown as Omit<Bundle, 'audit'>
      const ids = [row.id, ...row.shipment_lines.map((l) => l.id), ...row.dispatches.map((d) => d.id)]
      const { data: audit } = await supabase
        .from('audit_log')
        .select('*')
        .in('entity_id', ids)
        .order('at', { ascending: false })
        .limit(60)
      return { ...row, audit: (audit ?? []) as AuditRow[] }
    },
    ['shipments', 'shipment_lines', 'inspections', 'dispatches', 'dispatch_lines', 'box_label_checks'],
    `shipment-${id}`
  )

  const [modal, setModal] = useState<null | { kind: string; line?: LineRow; dispatch?: Dispatch }>(null)
  const close = () => setModal(null)
  const [showAudit, setShowAudit] = useState(false)
  const [scanId, setScanId] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanning = useRef(false)

  if (loading && !b) return <Loading />
  if (error && !b) return <Page><ErrorBox message={error} /></Page>
  if (!b) return null

  const finished = b.status === 'Closed' || b.status === 'Cancelled'
  const boxesSent = b.dispatches.reduce((n, d) => n + d.boxes_sent, 0)
  const boxChecksDone = !needsBoxLabels(b.dispatch_mode ?? '') || (b.box_label_checks.length > 0 && b.box_label_checks.every((c) => c.scanned !== null))
  const sortedBoxes = [...b.box_label_checks].sort((x, y) => x.sample_no - y.sample_no)
  const readyLines = b.shipment_lines.filter(
    (l) => (l.status === 'QC Submitted' || l.status === 'Partially Dispatched') && shipQty(l, insp(l)) - dispatchedUnits(b, l.id) > 0
  )

  async function handleBoxScan(code: string) {
    if (!scanId || scanning.current) return
    scanning.current = true
    const id = scanId
    setScanId(null)
    setScanError(null)
    try {
      const { error: err } = await callRpc('scan_box_label', { p_check: id, p_code: code })
      if (err) throw err
      invalidateAll()
    } catch (e) {
      setScanError(errText(e))
    } finally {
      scanning.current = false
    }
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const { error } = await callRpc(name, args)
    if (error) throw error
    invalidateAll() // refetches this page and marks the lists stale
  }

  return (
    <Page wide>
      <BackLink to="/">Shipments</BackLink>
      <PageTitle
        title={b.fba_id}
        sub={
          <>
            {b.ref} · {b.warehouse}
          </>
        }
        action={
          <div className="flex gap-1.5 items-center flex-wrap justify-end">
            {b.on_hold && <HoldStamp />}
            <StatusStamp status={b.status} />
          </div>
        }
      />

      {scanError && <Notice tone="fail">{scanError}</Notice>}
      {b.on_hold && (
        <Notice tone="fail">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span>On hold: {b.hold_reason ?? 'flag open'}</span>
            {isInv && (
              <Btn tone="danger" onClick={() => setModal({ kind: 'clearHold' })}>
                Clear hold
              </Btn>
            )}
          </div>
        </Notice>
      )}

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="space-y-5 min-w-0 order-2 lg:order-1">
          <Panel title="SKU lines" flush>
            <ul>
              {b.shipment_lines.map((l) => {
                const i = insp(l)
                const sent = dispatchedUnits(b, l.id)
                return (
                  <li key={l.id} className="p-4 border-t first:border-t-0 border-line">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium">{l.product_name}</div>
                        <div className="text-sm text-muted">
                          {l.unit_qty} units{l.box_qty ? ` · ${l.box_qty} boxes` : ''} · <span className="font-mono">{l.asin}</span>
                        </div>
                        {i && i.status !== 'Open' && (
                          <div className="text-sm mt-1">
                            Passed {i.accepted_qty} · Failed {i.rejected_qty} · Dispatched {sent}
                          </div>
                        )}
                        {i && i.status !== 'Open' && i.accepted_qty < l.unit_qty && l.status !== 'Cancelled' && (
                          <div className="text-sm text-warn mt-1">{l.unit_qty - i.accepted_qty} short of the {l.unit_qty} ordered.</div>
                        )}
                        {i?.needs_recheck && <div className="text-sm text-warn mt-1">Quantity changed after QC. Reopen the case to recheck.</div>}
                      </div>
                      <StatusStamp status={l.status} />
                    </div>
                    <div className="flex gap-2 flex-wrap mt-3">
                      {i && (
                        <Link
                          to={`/qc/${i.id}`}
                          className={`min-h-[40px] px-3 rounded-lg border flex items-center text-sm font-medium ${
                            i.status === 'Open' && canFillQc ? 'bg-ok text-white border-ok hover:bg-ok/90' : 'bg-ink text-white border-ink hover:bg-ink/90'
                          }`}
                        >
                          {i.status === 'Open' ? (canFillQc ? 'Open QC case' : 'View QC case') : 'View QC record'}
                        </Link>
                      )}
                      {isInv && !finished && l.status !== 'Cancelled' && (
                        <>
                          <Btn tone="line" className="!min-h-[40px] text-sm" onClick={() => setModal({ kind: 'editLine', line: l })}>
                            Edit quantity
                          </Btn>
                          {l.status !== 'Not Dispatched' && l.status !== 'Closed' && (
                            <Btn tone="line" className="!min-h-[40px] text-sm" onClick={() => setModal({ kind: 'parkLine', line: l })}>
                              Not dispatched
                            </Btn>
                          )}
                          {l.status !== 'Closed' && (
                            <Btn tone="lineDanger" className="!min-h-[40px] text-sm" onClick={() => setModal({ kind: 'cancelLine', line: l })}>
                              Cancel line
                            </Btn>
                          )}
                        </>
                      )}
                      {isInv && l.status === 'Not Dispatched' && (
                        <Btn tone="line" className="!min-h-[40px] text-sm" onClick={() => setModal({ kind: 'restoreLine', line: l })}>
                          Restore
                        </Btn>
                      )}
                      {isInv && !finished && (l.status === 'QC Submitted' || l.status === 'Partially Dispatched') && shipQty(l, i) - sent > 0 && (
                        <Btn tone="ok" className="!min-h-[44px] w-full sm:w-auto sm:ml-auto text-sm sm:!min-h-[40px]" onClick={() => setModal({ kind: 'dispatch', line: l })}>
                          Dispatch{shipQty(l, i) - sent < shipQty(l, i) ? ' rest' : ''}
                        </Btn>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <Panel title="Dispatches" flush>
            {b.dispatches.length === 0 ? (
              <p className="p-4 text-muted text-sm">
                {isInv && !finished && readyLines.length === 0 ? 'Nothing to dispatch until QC submits a line.' : 'No dispatches yet. Use Dispatch on a SKU line above.'}
              </p>
            ) : (
              <ul>
                {[...b.dispatches]
                  .sort((x, y) => x.dispatched_at.localeCompare(y.dispatched_at))
                  .map((d, n) => {
                    const units = (d.dispatch_lines ?? []).reduce((s, x) => s + x.units, 0)
                    return (
                      <li key={d.id} className="p-4 border-t first:border-t-0 border-line">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <div className="font-medium">
                              Dispatch {n + 1} · {fmtDateTime(d.dispatched_at)}
                            </div>
                            <div className="text-sm text-muted">
                              {d.boxes_sent} boxes · {units} units{d.transport ? ` · ${d.transport}` : ''} · {d.dispatched_by_name}
                            </div>
                            {d.remarks && <div className="text-sm mt-1">{d.remarks}</div>}
                            {d.wm_approved_at && (
                              <div className="text-sm text-ok mt-1">
                                Approved by {d.wm_name}, {fmtDateTime(d.wm_approved_at)}
                              </div>
                            )}
                          </div>
                          <StatusStamp status={d.wm_approved_at ? 'Closed' : 'Awaiting WM'} />
                        </div>
                        {isWm && !d.wm_approved_at && (
                          <Btn tone="ok" className="mt-3" onClick={() => setModal({ kind: 'approve', dispatch: d })}>
                            Approve and sign
                          </Btn>
                        )}
                      </li>
                    )
                  })}
              </ul>
            )}
          </Panel>

          <Panel title="Box label check" flush>
            {needsBoxLabels(b.dispatch_mode ?? '') ? (
              <>
            <ul>
              {sortedBoxes.map((c) => (
                <li key={c.id} className="px-4 py-3 border-t first:border-t-0 border-line flex items-center justify-between gap-3">
                  <span>
                    Box {c.sample_no} of {sortedBoxes.length}
                    {c.scanned && <span className="block font-mono text-xs text-muted break-all">{c.scanned}</span>}
                    {c.ok === false && <span className="block text-sm text-fail">{BOX_REASON[c.reason ?? ''] ?? 'Label does not match this shipment.'}</span>}
                  </span>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    {c.ok === null ? <Chip tone="gray">Not scanned</Chip> : c.ok ? <Chip tone="ok">Label OK</Chip> : <Chip tone="fail">Rejected</Chip>}
                    {isInv && !finished && c.ok !== true && (
                      <Btn className="!min-h-[40px] text-sm" onClick={() => setScanId(c.id)}>
                        {c.scanned ? 'Scan again' : 'Scan'}
                      </Btn>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="px-4 py-3 text-[13px] text-muted border-t border-line">{`Scan ${sortedBoxes.length === 1 ? '1 box label' : `any ${sortedBoxes.length} different box labels`} once they are pasted. Dispatch opens once ${sortedBoxes.length === 1 ? 'it is' : 'all are'} scanned and the shipment is not on hold.`}</p>
              </>
            ) : (
              <p className="p-4 text-sm text-muted">Not needed for {b.dispatch_mode}. Amazon collects this shipment, so no box labels are scanned.</p>
            )}
          </Panel>

          <div>
            <button
              type="button"
              onClick={() => setShowAudit((s) => !s)}
              aria-expanded={showAudit}
              className="min-h-[44px] font-semibold flex items-center gap-2"
            >
              Activity log <span className="text-muted font-normal">{b.audit.length}</span>
            </button>
            {showAudit && (
              <ul className="bg-surface border border-line rounded-xl text-sm overflow-hidden">
                {b.audit.length === 0 && <li className="p-4 text-muted">No entries.</li>}
                {b.audit.map((a) => (
                  <li key={a.id} className="p-4 border-t first:border-t-0 border-line">
                    <div>
                      <b className="font-medium">{a.action}</b> <span className="text-muted">on {a.entity.replace('_', ' ')}</span>
                    </div>
                    <div className="text-muted">
                      {a.user_name ?? 'system'} · {fmtDateTime(a.at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {((isInv && !finished && b.dispatches.length === 0) || isAdmin) && (
            <div className="flex flex-col sm:flex-row gap-2 pt-2 sm:justify-start">
              {isInv && !finished && b.dispatches.length === 0 && (
                <Btn tone="lineWarn" className="sm:px-6" onClick={() => setModal({ kind: 'cancelShipment' })}>
                  Cancel shipment
                </Btn>
              )}
              {isAdmin && (
                <Btn tone="danger" className="sm:px-6" onClick={() => setModal({ kind: 'deleteShipment' })}>
                  Delete shipment
                </Btn>
              )}
            </div>
          )}
        </div>

        <aside className="order-1 lg:order-2 lg:sticky lg:top-6">
          <Panel title="Details">
            <dl className="space-y-3 text-sm">
              <Fact k="Mode of dispatch" v={b.dispatch_mode ?? ''} />
              <Fact k="Appointment" v={needsAppointment(b.dispatch_mode ?? '') ? (b.appointment_at ? fmtDateTime(b.appointment_at) : '') : 'Not needed'} />
              <Fact k="Transport" v={needsTransport(b.dispatch_mode ?? '') ? b.transport ?? '' : (b.dispatch_mode === 'Bluedart' ? 'Collected by Bluedart' : 'Collected by Amazon')} />
              <Fact k="Dispatch date" v={fmtDate(b.dispatch_date)} />
              <Fact k="Boxes sent" v={`${boxesSent} of ${b.box_qty_total}`} />
              <Fact k="Created" v={fmtDate(b.created_at)} />
              {b.remarks && <Fact k="Remarks" v={b.remarks} />}
            </dl>
            {isInv && !finished && (
              <div className="flex flex-col gap-2 mt-5 pt-4 border-t border-line">
                <Btn onClick={() => setModal({ kind: 'editShipment' })}>Edit details</Btn>
                <Btn tone="line" onClick={() => setModal({ kind: 'addLine' })}>
                  Add SKU line
                </Btn>
              </div>
            )}
          </Panel>
        </aside>
      </div>

      {scanId && (
        <Suspense fallback={null}>
          <BarcodeScanner title="Scan box label" hint="Carton ID on any box label" onScan={handleBoxScan} onClose={() => setScanId(null)} />
        </Suspense>
      )}
      {modal?.kind === 'deleteShipment' && (
        <DeleteModal
          fbaId={b.fba_id}
          onClose={close}
          onDelete={async () => {
            const { data: paths, error: err } = await callRpc('delete_shipment', { p_ship: b.id })
            if (err) throw err
            // remove the signature files too (best effort; the database rows are already gone)
            const files = (paths ?? []) as string[]
            if (files.length) await supabase.storage.from('signatures').remove(files)
            invalidateAll()
            navigate('/', { replace: true })
          }}
        />
      )}
      {modal?.kind === 'clearHold' && (
        <ConfirmModal
          title="Clear hold"
          intro={`This releases the hold: ${b.hold_reason ?? ''}.`}
          confirmLabel="Clear hold"
          tone="danger"
          onClose={close}
          onConfirm={() => rpc('clear_hold', { p_ship: b.id })}
        />
      )}
      {modal?.kind === 'cancelShipment' && (
        <ConfirmModal
          title="Cancel shipment"
          intro="All lines are cancelled. This cannot be undone."
          confirmLabel="Cancel shipment"
          tone="danger"
          onClose={close}
          onConfirm={() => rpc('cancel_shipment', { p_ship: b.id })}
        />
      )}
      {modal?.kind === 'cancelLine' && modal.line && (
        <ConfirmModal
          title={`Cancel ${modal.line.product_name}`}
          intro="This line will not ship. It no longer counts toward the shipment."
          confirmLabel="Cancel line"
          tone="danger"
          onClose={close}
          onConfirm={() => rpc('set_line_state', { p_line: modal.line!.id, p_state: 'Cancelled' })}
        />
      )}
      {modal?.kind === 'parkLine' && modal.line && (
        <ConfirmModal
          title={`Not dispatched: ${modal.line.product_name}`}
          intro="Parks this line. The shipment cannot close until it is dispatched or cancelled."
          confirmLabel="Mark not dispatched"
          onClose={close}
          onConfirm={() => rpc('set_line_state', { p_line: modal.line!.id, p_state: 'Not Dispatched' })}
        />
      )}
      {modal?.kind === 'restoreLine' && modal.line && (
        <ConfirmModal
          title={`Restore ${modal.line.product_name}`}
          confirmLabel="Restore line"
          onClose={close}
          onConfirm={() => rpc('set_line_state', { p_line: modal.line!.id, p_state: 'Restore' })}
        />
      )}
      {modal?.kind === 'editShipment' && <EditShipmentModal b={b} onClose={close} onSave={(c) => rpc('update_shipment', { p_id: b.id, p_changes: c })} />}
      {modal?.kind === 'editLine' && modal.line && (
        <EditLineModal line={modal.line} onClose={close} onSave={(u, bx) => rpc('update_line', { p_line: modal.line!.id, p_units: u, p_boxes: bx })} />
      )}
      {modal?.kind === 'addLine' && (
        <AddLineModal onClose={close} onSave={(asin, u, bx) => rpc('add_line', { p_ship: b.id, p_asin: asin, p_units: u, p_boxes: bx })} />
      )}
      {modal?.kind === 'dispatch' && (
        <DispatchModal
          b={b}
          readyLines={readyLines}
          boxChecksDone={boxChecksDone}
          boxesSent={boxesSent}
          onlyLine={modal.line?.id}
          onClose={close}
          onSave={async (payload, dataUrl) => {
            const sign_path = await uploadSignature(dataUrl, 'dispatch')
            await rpc('confirm_dispatch', { p_ship: b.id, p: { ...payload, sign_path } })
          }}
        />
      )}
      {modal?.kind === 'approve' && modal.dispatch && (
        <ApproveModal
          onClose={close}
          onSave={async (dataUrl, name) => {
            const path = await uploadSignature(dataUrl, 'final')
            await rpc('approve_dispatch', { p_dispatch: modal.dispatch!.id, p_sign_path: path, p_name: name })
          }}
        />
      )}
    </Page>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className="font-medium">{v || '—'}</dd>
    </div>
  )
}

/* ------------------------------------------------------------ edit shipment */

function EditShipmentModal({
  b,
  onClose,
  onSave
}: {
  b: Shipment
  onClose: () => void
  onSave: (changes: Record<string, unknown>) => Promise<void>
}) {
  const [f, setF] = useState({
    fba_id: b.fba_id,
    warehouse: b.warehouse,
    dispatch_mode: b.dispatch_mode ?? '',
    transport: b.transport ?? '',
    dispatch_date: b.dispatch_date ?? '',
    appointment: toLocalInput(b.appointment_at),
    box_qty_total: String(b.box_qty_total),
    remarks: b.remarks ?? ''
  })
  const [step, setStep] = useState<1 | 2>(1)

  const { changes, payload } = useMemo(() => {
    const ch: Change[] = []
    const pl: Record<string, unknown> = {}
    const add = (label: string, from: string, to: string, key: string, value: unknown) => {
      if (from !== to) {
        ch.push({ label, from, to })
        pl[key] = value
      }
    }
    add('FBA shipment ID', b.fba_id, f.fba_id.trim().toUpperCase(), 'fba_id', f.fba_id.trim().toUpperCase())
    add('Warehouse', b.warehouse, f.warehouse.trim(), 'warehouse', f.warehouse.trim())
    add('Mode of dispatch', b.dispatch_mode ?? '', f.dispatch_mode, 'dispatch_mode', f.dispatch_mode)
    const transportNow = needsTransport(f.dispatch_mode) ? f.transport : ''
    add('Transport', b.transport ?? '', transportNow, 'transport', transportNow)
    add('Dispatch date', b.dispatch_date ?? '', f.dispatch_date, 'dispatch_date', f.dispatch_date)
    const appointmentNow = needsAppointment(f.dispatch_mode) ? f.appointment : ''
    add('Appointment', toLocalInput(b.appointment_at), appointmentNow, 'appointment_at', fromLocalInput(appointmentNow) ?? '')
    add('Total boxes', String(b.box_qty_total), f.box_qty_total, 'box_qty_total', parseInt(f.box_qty_total, 10) || b.box_qty_total)
    add('Remarks', b.remarks ?? '', f.remarks, 'remarks', f.remarks)
    return { changes: ch, payload: pl }
  }, [f, b])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))
  const boxReset = 'fba_id' in payload || 'box_qty_total' in payload

  return (
    <Modal title={step === 1 ? 'Edit shipment' : 'Review changes'} onClose={onClose}>
      {step === 1 ? (
        <>
          <Field label="FBA shipment ID"><input value={f.fba_id} onChange={set('fba_id')} className={`${inputCls} font-mono uppercase`} /></Field>
          <Field label="Amazon FC">
            <SearchableSelect
              options={[...new Set([...FULFILMENT_CENTRES, ...(f.warehouse ? [f.warehouse] : [])])]}
              value={f.warehouse}
              onChange={(v) => setF((p) => ({ ...p, warehouse: v }))}
              placeholder="Select FC"
            />
          </Field>
          <div className="mb-4">
            <span className="block text-sm font-medium mb-1.5">Mode of dispatch</span>
            <Choice label="Mode of dispatch" options={[...DISPATCH_MODES]} value={f.dispatch_mode as DispatchMode | ''} onChange={(v) => setF((p) => ({ ...p, dispatch_mode: v, transport: needsTransport(v) ? p.transport : '', appointment: needsAppointment(v) ? p.appointment : '' }))} />
          </div>
          <Field label="Transport" hint={!needsTransport(f.dispatch_mode) ? `Not needed for ${f.dispatch_mode}.` : undefined}>
            <SearchableSelect
              options={[...new Set([...TRANSPORTS, ...(f.transport ? [f.transport] : [])])]}
              value={needsTransport(f.dispatch_mode) ? f.transport : ''}
              onChange={(v) => setF((p) => ({ ...p, transport: v }))}
              placeholder={needsTransport(f.dispatch_mode) ? 'Select' : 'Not needed'}
              allowClear
              disabled={!needsTransport(f.dispatch_mode)}
            />
          </Field>
          <Field label="Date of dispatch"><DateInput value={f.dispatch_date} onChange={(v) => setF((p) => ({ ...p, dispatch_date: v }))} /></Field>
          <Field label="Appointment" hint={!needsAppointment(f.dispatch_mode) ? `Not needed for ${f.dispatch_mode}.` : undefined}>
            <DateInput
              value={needsAppointment(f.dispatch_mode) ? f.appointment : ''}
              onChange={(v) => setF((p) => ({ ...p, appointment: v }))}
              withTime
              disabled={!needsAppointment(f.dispatch_mode)}
            />
          </Field>
          <Field label="Total boxes"><input type="number" min={1} value={f.box_qty_total} onChange={set('box_qty_total')} className={inputCls} /></Field>
          <Field label="Remarks"><textarea value={f.remarks} onChange={set('remarks')} rows={2} className={`${inputCls} py-2`} /></Field>
          <Btn className="w-full" disabled={changes.length === 0} onClick={() => setStep(2)}>
            Review changes
          </Btn>
        </>
      ) : (
        <>
          {boxReset && (
            <p className="text-sm text-warn mb-3">Changing the FBA ID or box count picks new random boxes for the label check.</p>
          )}
          <ReviewStep
            changes={changes}
            confirmLabel="Save changes"
            onBack={() => setStep(1)}
            onConfirm={async () => {
              await onSave(payload)
              onClose()
            }}
          />
        </>
      )}
    </Modal>
  )
}

function EditLineModal({
  line,
  onClose,
  onSave
}: {
  line: LineRow
  onClose: () => void
  onSave: (units: number, boxes: number | null) => Promise<void>
}) {
  const [units, setUnits] = useState(String(line.unit_qty))
  const [boxes, setBoxes] = useState(line.box_qty == null ? '' : String(line.box_qty))
  const [step, setStep] = useState<1 | 2>(1)
  const u = parseInt(units, 10)
  const bx = boxes === '' ? null : parseInt(boxes, 10)
  const changes: Change[] = []
  if (u !== line.unit_qty) changes.push({ label: 'Unit quantity', from: String(line.unit_qty), to: String(u) })
  if (bx !== line.box_qty) changes.push({ label: 'Boxes for this SKU', from: String(line.box_qty ?? ''), to: String(bx ?? '') })
  return (
    <Modal title={step === 1 ? `Edit ${line.product_name}` : 'Review changes'} onClose={onClose}>
      {step === 1 ? (
        <>
          <Field label="Unit quantity"><input type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} className={inputCls} /></Field>
          <Field label="Boxes for this SKU"><input type="number" min={0} value={boxes} onChange={(e) => setBoxes(e.target.value)} className={inputCls} /></Field>
          <Btn className="w-full" disabled={changes.length === 0 || !u || u < 1} onClick={() => setStep(2)}>
            Review changes
          </Btn>
        </>
      ) : (
        <>
          {u !== line.unit_qty && (
            <p className="text-sm text-warn mb-3">New random units are picked for the FNSKU scan. If QC already submitted, the case is flagged for recheck.</p>
          )}
          <ReviewStep
            changes={changes}
            confirmLabel="Save changes"
            onBack={() => setStep(1)}
            onConfirm={async () => {
              await onSave(u, bx)
              onClose()
            }}
          />
        </>
      )}
    </Modal>
  )
}

function AddLineModal({
  onClose,
  onSave
}: {
  onClose: () => void
  onSave: (asin: string, units: number, boxes: number | null) => Promise<void>
}) {
  const [skus, setSkus] = useState<SkuRow[] | null>(null)
  const [product, setProduct] = useState('')
  const [units, setUnits] = useState('')
  const [boxes, setBoxes] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    getSkus()
      .then(setSkus)
      .catch((e) => setErr(errText(e)))
  }, [])
  const sku = skus?.find((s) => s.product_name === product)
  const u = parseInt(units, 10)
  return (
    <Modal title={step === 1 ? 'Add SKU line' : 'Review changes'} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      {step === 1 ? (
        <>
          <Field label="Product">
            <SearchableSelect options={(skus ?? []).map((s) => s.product_name)} value={product} onChange={setProduct} placeholder="Select product" />
          </Field>
          <Field label="Unit quantity"><input type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} className={inputCls} /></Field>
          <Field label="Boxes for this SKU"><input type="number" min={0} value={boxes} onChange={(e) => setBoxes(e.target.value)} className={inputCls} /></Field>
          <Btn className="w-full" disabled={!sku || !u || u < 1} onClick={() => setStep(2)}>
            Review
          </Btn>
        </>
      ) : (
        <ReviewStep
          changes={[{ label: 'New line', from: '', to: `${product}, ${u} units${boxes ? `, ${boxes} boxes` : ''}` }]}
          confirmLabel="Add line"
          onBack={() => setStep(1)}
          onConfirm={async () => {
            await onSave(sku!.asin, u, boxes === '' ? null : parseInt(boxes, 10))
            onClose()
          }}
        />
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------ dispatch */

function DispatchModal({
  b,
  readyLines,
  boxChecksDone,
  boxesSent,
  onlyLine,
  onClose,
  onSave
}: {
  b: Bundle
  readyLines: LineRow[]
  boxChecksDone: boolean
  boxesSent: number
  onlyLine?: string
  onClose: () => void
  onSave: (payload: Record<string, unknown>, signDataUrl: string) => Promise<void>
}) {
  const remaining = (l: LineRow) => shipQty(l, insp(l)) - dispatchedUnits(b, l.id)
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(readyLines.map((l) => [l.id, String(remaining(l))]))
  )
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(readyLines.map((l) => [l.id, onlyLine ? l.id === onlyLine : true]))
  )
  const [boxes, setBoxes] = useState('')
  const [transport, setTransport] = useState(b.transport ?? '')
  const [remarks, setRemarks] = useState('')
  const { profile } = useAuth()
  const people = usePeople((p) => p.role === 'inventory' || !!p.is_admin, [profile?.name ?? ''])
  const [by, setBy] = useState(profile?.name ?? '')
  const [sign, setSign] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = readyLines.filter((l) => on[l.id])
  const fullAfter = readyLines.every((l) => !on[l.id] || parseInt(picked[l.id], 10) === remaining(l))
  const allLinesDone = b.shipment_lines.every(
    (l) => ['Cancelled', 'Not Dispatched'].includes(l.status) || (on[l.id] && fullAfter) || (['Dispatched', 'Closed'].includes(l.status))
  )
  const nBoxes = parseInt(boxes, 10)
  const totalAfter = boxesSent + (nBoxes || 0)

  const blocker = b.on_hold
    ? `Shipment is on hold: ${b.hold_reason ?? 'flag open'}. Clear the hold first.`
    : !boxChecksDone
    ? 'Box label check is not complete. Scan the box labels in the Box label check panel first.'
    : null

  async function go() {
    setError(null)
    if (chosen.length === 0) return setError('Choose at least one line.')
    const lines = []
    for (const l of chosen) {
      const n = parseInt(picked[l.id], 10)
      if (!n || n < 1 || n > remaining(l)) return setError(`${l.product_name}: units must be 1 to ${remaining(l)}.`)
      lines.push({ line_id: l.id, units: n })
    }
    if (isNaN(nBoxes) || nBoxes < 0) return setError('Enter the number of boxes loaded.')
    if (!by) return setError('Choose who is confirming the dispatch.')
    if (!sign) return setError('Sign to confirm dispatch.')
    setBusy(true)
    try {
      await onSave({ boxes_sent: nBoxes, transport: needsTransport(b.dispatch_mode ?? '') ? transport : '', remarks, lines, by_name: by }, sign)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={onlyLine ? `Dispatch ${readyLines.find((l) => l.id === onlyLine)?.product_name ?? ""}` : "Confirm dispatch"} onClose={onClose}>
      {blocker && <ErrorBox message={blocker} />}
      <div className="mb-4 border border-line rounded-lg bg-surface overflow-hidden">
        {readyLines.map((l) => (
          <div key={l.id} className="p-3 border-t first:border-t-0 border-line">
            <label className="flex items-start gap-3 min-h-[44px]">
              <input
                type="checkbox"
                checked={!!on[l.id]}
                onChange={(e) => setOn((p) => ({ ...p, [l.id]: e.target.checked }))}
                className="mt-1 w-5 h-5"
              />
              <span className="flex-1">
                <span className="block font-semibold">{l.product_name}</span>
                <span className="block text-sm text-muted">QC accepted, {remaining(l)} left to send</span>
              </span>
            </label>
            {on[l.id] && (
              <input
                type="number"
                min={1}
                max={remaining(l)}
                value={picked[l.id]}
                onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.value }))}
                aria-label={`Units of ${l.product_name} on this truck`}
                className={`${inputCls} mt-2 max-w-[160px]`}
              />
            )}
          </div>
        ))}
      </div>
      <Field label="Boxes loaded on this truck" hint={`${boxesSent} sent before, ${b.box_qty_total} in shipment`}>
        <input type="number" min={0} value={boxes} onChange={(e) => setBoxes(e.target.value)} className={`${inputCls} max-w-[160px]`} />
      </Field>
      {allLinesDone && nBoxes >= 0 && totalAfter !== b.box_qty_total && (
        <p className="text-sm text-warn -mt-2 mb-3">
          This closes out all lines but total boxes sent would be {totalAfter} of {b.box_qty_total}. Add a remark if that is right.
        </p>
      )}
      <Field label="Transport" hint={!needsTransport(b.dispatch_mode ?? '') ? `Not needed for ${b.dispatch_mode}.` : undefined}>
        <SearchableSelect
          options={[...new Set([...TRANSPORTS, ...(transport ? [transport] : [])])]}
          value={needsTransport(b.dispatch_mode ?? '') ? transport : ''}
          onChange={setTransport}
          placeholder={needsTransport(b.dispatch_mode ?? '') ? 'Select' : 'Not needed'}
          allowClear
          disabled={!needsTransport(b.dispatch_mode ?? '')}
        />
      </Field>
      <Field label="Remarks"><textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={`${inputCls} py-2`} /></Field>
      <div className="mb-4">
        <span className="block text-sm font-medium mb-1.5">Dispatch confirmed by</span>
        <SearchableSelect options={people} value={by} onChange={setBy} placeholder="Choose name" />
      </div>
      {/* Not a <Field>: a <label> forwards every click inside it to its first button (Clear). */}
      <div className="mb-4">
        <span className="block text-sm font-medium mb-1.5">Dispatch signature</span>
        <SignaturePad value={sign} onChange={setSign} />
      </div>
      {error && <ErrorBox message={error} />}
      <Btn className="w-full" onClick={go} disabled={busy || !!blocker}>
        {busy ? 'Saving…' : 'Confirm dispatch'}
      </Btn>
    </Modal>
  )
}

function ApproveModal({ onClose, onSave }: { onClose: () => void; onSave: (signDataUrl: string, name: string) => Promise<void> }) {
  const { profile } = useAuth()
  const people = usePeople((p) => p.role === 'wm' || !!p.is_admin, [profile?.name ?? ''])
  const [by, setBy] = useState(profile?.name ?? '')
  const [sign, setSign] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    if (!by) return setError('Choose who is approving.')
    if (!sign) return setError('Sign to approve.')
    setBusy(true)
    try {
      await onSave(sign, by)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="Final confirmation" onClose={onClose}>
      <p className="text-sm mb-3">Signing approves this dispatch and closes the QC cases it completes.</p>
      <div className="mb-4">
        <span className="block text-sm font-medium mb-1.5">Approved by</span>
        <SearchableSelect options={people} value={by} onChange={setBy} placeholder="Choose name" />
      </div>
      <div className="mb-4">
        <span className="block text-sm font-medium mb-1.5">Signature</span>
        <SignaturePad value={sign} onChange={setSign} />
      </div>
      {error && <ErrorBox message={error} />}
      <Btn tone="ok" className="w-full" onClick={go} disabled={busy}>
        {busy ? 'Saving…' : 'Approve'}
      </Btn>
    </Modal>
  )
}

function DeleteModal({ fbaId, onClose, onDelete }: { fbaId: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const match = typed.trim().toUpperCase() === fbaId.toUpperCase()

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await onDelete()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Delete shipment" onClose={() => !busy && onClose()}>
      <p className="text-sm mb-2">
        This permanently deletes shipment <b className="font-mono">{fbaId}</b> with all of its SKU lines, QC cases, scans, dispatches, signatures and activity log.
      </p>
      <p className="text-sm text-fail font-medium mb-4">It cannot be undone.</p>
      <label className="block mb-4">
        <span className="block text-sm font-medium mb-1.5">Type the FBA ID to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputCls} font-mono uppercase`} placeholder={fbaId} autoComplete="off" />
      </label>
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2">
        <Btn tone="line" onClick={onClose} disabled={busy}>
          Cancel
        </Btn>
        <Btn tone="danger" className="flex-1" onClick={go} disabled={!match || busy}>
          {busy ? 'Deleting…' : 'Delete everything'}
        </Btn>
      </div>
    </Modal>
  )
}
