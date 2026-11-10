import { CHECK_SECTIONS } from '../data/checklist'
import { fmtDate, fmtDateTime, fmtTimeSec } from '../lib/format'
import { needsBoxLabels } from '../data/options'
import type { BoxCheck, Dispatch, DispatchLine, FnskuCheck, Inspection, Shipment, ShipmentLine } from '../types/db'

export interface RecordBundle {
  insp: Inspection
  line: ShipmentLine
  ship: Shipment
  fn: FnskuCheck[]
  boxes: BoxCheck[]
  dispatches: (Dispatch & { dispatch_lines: DispatchLine[] })[]
}

export interface Draft {
  inspection_date: string
  checks: Inspection['checks']
  inspected_qty: number
  accepted_qty: number
  rejected_qty: number
  product_condition: string
  packaging_quality: string
  overall_result: string
  qc_remarks: string
  inspector_name: string
}

export function draftFromInspection(i: Inspection, fallbackName = ''): Draft {
  return {
    inspection_date: i.inspection_date ?? '',
    checks: i.checks ?? {},
    inspected_qty: i.inspected_qty,
    accepted_qty: i.accepted_qty,
    rejected_qty: i.rejected_qty,
    product_condition: i.product_condition ?? '',
    packaging_quality: i.packaging_quality ?? '',
    overall_result: i.overall_result ?? '',
    qc_remarks: i.qc_remarks ?? '',
    inspector_name: i.inspector_name ?? fallbackName
  }
}

const OUTCOME: Record<string, { tone: 'ok' | 'warn' | 'fail'; label: string }> = {
  Good: { tone: 'ok', label: 'Passed' },
  Satisfactory: { tone: 'warn', label: 'Passed with remarks' },
  Bad: { tone: 'fail', label: 'Failed' }
}

function ScanTable({
  rows,
  kind
}: {
  rows: { id: string; sample_no: number; scanned: string | null; ok: boolean | null; scanned_at: string | null; extra?: string }[]
  kind: 'FNSKU' | 'Box label'
}) {
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: '14mm' }}>Sample</th>
          <th>{kind === 'FNSKU' ? 'FNSKU as scanned' : 'Carton barcode as scanned'}</th>
          <th style={{ width: '24mm' }}>Time</th>
          <th style={{ width: '26mm' }}>Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.ok === false ? 'fail' : ''}>
            <td className="ref-no">{r.sample_no}</td>
            <td>
              <span className="mono">{r.scanned ?? '—'}</span>
              {r.extra && <span className="muted"> · {r.extra}</span>}
            </td>
            <td>{fmtTimeSec(r.scanned_at)}</td>
            <td>
              {r.ok === null ? (
                <span className="res na">Not scanned</span>
              ) : r.ok ? (
                <span className="res ok">Verified</span>
              ) : (
                <span className="res fail">Mismatch</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FindingGroup({
  title,
  items,
  checks
}: {
  title: string
  items: { no: number; text: string }[]
  checks: Inspection['checks']
}) {
  return (
    <>
      <tr className="group">
        <td colSpan={4}>{title}</td>
      </tr>
      {items.map((it) => {
        const c = checks[String(it.no)]
        return (
          <tr key={it.no} className={c?.r === 'no' ? 'fail' : ''}>
            <td className="ref-no">{it.no}</td>
            <td>{it.text}</td>
            <td>
              {c?.r === 'ok' ? (
                <span className="res ok">OK</span>
              ) : c?.r === 'no' ? (
                <span className="res fail">Not OK</span>
              ) : (
                <span className="res na">N/A</span>
              )}
            </td>
            <td className="note">{c?.n ?? ''}</td>
          </tr>
        )
      })}
    </>
  )
}

// Printed A4 report. Two pages. Rendered for print only (see QCRecord).
export function RecordSheet({ data, draft }: { data: RecordBundle; draft: Draft }) {
  const { insp, line, ship, fn, boxes, dispatches } = data

  const outcome = OUTCOME[draft.overall_result]
  const rate = draft.inspected_qty > 0 ? ((draft.rejected_qty / draft.inspected_qty) * 100).toFixed(1) : '0.0'
  const issued = insp.submitted_at ?? insp.inspection_date ?? ''

  const myDispatches = dispatches
    .filter((d) => d.dispatch_lines.some((dl) => dl.line_id === line.id))
    .sort((a, b) => a.dispatched_at.localeCompare(b.dispatched_at))
  const lastDispatch = myDispatches[myDispatches.length - 1]
  const lastApproved = [...myDispatches].reverse().find((d) => d.wm_approved_at)
  let running = 0

  const foot = (page: number) => (
    <div className="foot">
      <span>
        Helett Enterprises · Quality Inspection Report · {insp.record_no} · {insp.status}
      </span>
      <span>Page {page} of 2</span>
    </div>
  )

  return (
    <div className="rpt">
      {/* ------------------------------------------------------------ page 1 */}
      <section className="sheet">
        <header className="head">
          <div>
            <div className="brand">Helett Enterprises</div>
            <div className="doctype">Quality Inspection Report · Outbound shipment</div>
          </div>
          <div className="ref">
            Report no.
            <b>{insp.record_no}</b>
            Issued {fmtDate(issued)}
          </div>
        </header>

        <div className="title">
          <div>
            <h1>{line.product_name}</h1>
            <div className="sub">
              FBA shipment <span className="mono">{ship.fba_id}</span> · {ship.warehouse}
            </div>
          </div>
          {outcome && (
            <div className={`outcome ${outcome.tone}`}>
              <small>Inspection outcome</small>
              <b>{outcome.label}</b>
            </div>
          )}
        </div>

        <dl className="facts" style={{ margin: 0 }}>
          <div>
            <dt>FBA shipment ID</dt>
            <dd className="mono">{ship.fba_id}</dd>
          </div>
          <div>
            <dt>ASIN</dt>
            <dd className="mono">{line.asin}</dd>
          </div>
          <div>
            <dt>Mode of dispatch</dt>
            <dd>{ship.dispatch_mode ?? '—'}</dd>
          </div>
          <div>
            <dt>Warehouse</dt>
            <dd>{ship.warehouse}</dd>
          </div>
          <div>
            <dt>Appointment</dt>
            <dd>{ship.appointment_at ? fmtDateTime(ship.appointment_at) : '—'}</dd>
          </div>
          <div>
            <dt>Inspection date</dt>
            <dd>{fmtDate(draft.inspection_date) || '—'}</dd>
          </div>
          <div>
            <dt>Units received</dt>
            <dd>{line.unit_qty}</dd>
          </div>
          <div>
            <dt>Boxes (this SKU)</dt>
            <dd>{line.box_qty ?? '—'}</dd>
          </div>
          <div>
            <dt>Inspector</dt>
            <dd>{draft.inspector_name || '—'}</dd>
          </div>
        </dl>

        <div className="figs">
          <div>
            <div className="n">{draft.inspected_qty}</div>
            <div className="l">Units checked</div>
          </div>
          <div>
            <div className="n" style={{ color: 'var(--ok)' }}>
              {draft.accepted_qty}
            </div>
            <div className="l">Passed</div>
          </div>
          <div>
            <div className="n" style={draft.rejected_qty > 0 ? { color: 'var(--fail)' } : undefined}>
              {draft.rejected_qty}
            </div>
            <div className="l">Failed</div>
          </div>
          <div>
            <div className="n">{rate}%</div>
            <div className="l">Fail rate</div>
          </div>
        </div>

        <h2 style={{ marginTop: '7mm' }}>
          1. Inspection findings
        </h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '9mm' }}>Ref</th>
              <th>Inspection point</th>
              <th style={{ width: '30mm' }}>Finding</th>
              <th style={{ width: '48mm' }}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {CHECK_SECTIONS.map((sec) => (
              <FindingGroup key={sec.id} title={sec.title.charAt(0) + sec.title.slice(1).toLowerCase()} items={sec.items} checks={draft.checks} />
            ))}
          </tbody>
        </table>

        {foot(1)}
      </section>

      {/* ------------------------------------------------------------ page 2 */}
      <section className="sheet">
        <header className="head">
          <div>
            <div className="brand">Helett Enterprises</div>
            <div className="doctype">Quality Inspection Report · {line.product_name}</div>
          </div>
          <div className="ref">
            Report no.
            <b>{insp.record_no}</b>
          </div>
        </header>

        <h2 style={{ marginTop: '6mm' }}>
          2. Label verification <span>Scanned on the unit or carton at inspection</span>
        </h2>
        <ScanTable kind="FNSKU" rows={[...fn].sort((a, b) => a.sample_no - b.sample_no)} />
        <div style={{ height: '3mm' }} />
        {needsBoxLabels(ship.dispatch_mode ?? '') ? (
          <ScanTable
            kind="Box label"
            rows={[...boxes]
              .sort((a, b) => a.sample_no - b.sample_no)
              .map((b) => ({ ...b, extra: `Box ${b.sample_no} of ${boxes.length}` }))}
          />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Box label check: not required for {ship.dispatch_mode} shipments (collected by Amazon).
          </p>
        )}

        <h2>3. Disposition</h2>
        <dl className="dispo" style={{ margin: 0 }}>
          <div>
            <dt>Overall result</dt>
            <dd>{draft.overall_result || '—'}</dd>
          </div>
          <div>
            <dt>Product condition</dt>
            <dd>{draft.product_condition || '—'}</dd>
          </div>
          <div>
            <dt>Packaging quality</dt>
            <dd>{draft.packaging_quality || '—'}</dd>
          </div>
        </dl>
        <div className="remarks">
          <small>QC remarks</small>
          <span style={{ whiteSpace: 'pre-wrap' }}>{draft.qc_remarks || 'None.'}</span>
        </div>

        <h2>4. Dispatch record</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '9mm' }}>No.</th>
              <th style={{ width: '26mm' }}>Date</th>
              <th>Transport</th>
              <th className="num" style={{ width: '18mm' }}>
                Boxes
              </th>
              <th className="num" style={{ width: '18mm' }}>
                Units
              </th>
              <th className="num" style={{ width: '26mm' }}>
                Cumulative
              </th>
            </tr>
          </thead>
          <tbody>
            {myDispatches.map((d, n) => {
              const units = d.dispatch_lines.filter((x) => x.line_id === line.id).reduce((s, x) => s + x.units, 0)
              running += units
              return (
                <tr key={d.id}>
                  <td className="ref-no">{n + 1}</td>
                  <td>{fmtDate(d.dispatched_at)}</td>
                  <td>{d.transport ?? '—'}</td>
                  <td className="num">{d.boxes_sent}</td>
                  <td className="num">{units}</td>
                  <td className="num">
                    {running} of {Math.min(draft.accepted_qty, line.unit_qty)}
                  </td>
                </tr>
              )
            })}
            {myDispatches.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Not dispatched at the time of issue.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h2>5. Authorisation</h2>
        <div className="auth">
          {[
            { role: 'Quality control', who: draft.inspector_name, when: insp.submitted_at },
            { role: 'Dispatch confirmed by', who: lastDispatch?.dispatched_by_name ?? '', when: lastDispatch?.dispatched_at },
            { role: 'Final confirmation', who: lastApproved?.wm_name ?? '', when: lastApproved?.wm_approved_at }
          ].map((a) => (
            <div key={a.role} className={`cell ${a.when ? 'done' : 'todo'}`}>
              <div className="role">{a.role}</div>
              <div className="who">{a.when ? a.who || '—' : 'Pending'}</div>
              <div className="when">{a.when ? fmtDateTime(a.when) : ''}</div>
              {a.when && <div className="via">Recorded under the person's login</div>}
            </div>
          ))}
        </div>

        {foot(2)}
      </section>
    </div>
  )
}
