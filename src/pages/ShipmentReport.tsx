import { Link, useParams } from 'react-router-dom'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtDateTime, todayISO } from '../lib/format'
import { failReason } from '../components/RecordSheet'
import { CHECK_SECTIONS } from '../data/checklist'
import { needsBoxLabels } from '../data/options'
import { printAs } from '../lib/printName'
import { Btn, ErrorBox, Loading } from '../components/ui'
import type { BoxCheck, Dispatch, DispatchLine, FnskuCheck, Inspection, Shipment, ShipmentLine } from '../types/db'
import '../report.css'

type Line = ShipmentLine & { inspections: (Inspection & { fnsku_checks: FnskuCheck[] }) | (Inspection & { fnsku_checks: FnskuCheck[] })[] | null }
type Bundle = Shipment & {
  shipment_lines: Line[]
  dispatches: (Dispatch & { dispatch_lines: DispatchLine[] })[]
  box_label_checks: BoxCheck[]
}

const one = (l: Line) => (Array.isArray(l.inspections) ? l.inspections[0] ?? null : l.inspections)

const RESULT: Record<string, { tone: 'ok' | 'warn' | 'fail'; label: string }> = {
  Good: { tone: 'ok', label: 'Passed' },
  Satisfactory: { tone: 'warn', label: 'Passed with remarks' },
  Bad: { tone: 'fail', label: 'Failed' }
}

const MAX_FINDINGS = 5

// One macro-level A4 report for a whole shipment: two pages, every SKU side by side.
export function ShipmentReport() {
  const { id } = useParams()
  const { data, error, loading } = useLive<Bundle | null>(
    async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*, shipment_lines(*, inspections(*, fnsku_checks(*))), dispatches(*, dispatch_lines(*)), box_label_checks(*)')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return data as unknown as Bundle | null
    },
    ['shipments', 'shipment_lines', 'inspections', 'fnsku_checks', 'box_label_checks', 'dispatches', 'dispatch_lines'],
    `ship-report-${id}`
  )

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox message={error} />
  if (!data) return null

  const ship = data
  const lines = ship.shipment_lines.filter((l) => l.status !== 'Cancelled')
  const rows = lines.map((l, i) => {
    const insp = one(l)
    const done = !!insp && insp.status !== 'Open'
    const checked = insp?.inspected_qty ?? 0
    const passed = insp?.accepted_qty ?? 0
    const failed = insp?.rejected_qty ?? 0
    const fn = insp?.fnsku_checks ?? []
    return {
      n: i + 1,
      line: l,
      insp,
      done,
      checked,
      passed,
      failed,
      rate: checked > 0 ? (failed / checked) * 100 : 0,
      result: done ? RESULT[insp?.overall_result ?? ''] ?? null : null,
      fnTotal: fn.length,
      fnOk: fn.filter((c) => c.ok === true).length,
      fnBad: fn.filter((c) => c.ok === false).length
    }
  })

  const tot = rows.reduce(
    (t, r) => ({ units: t.units + r.line.unit_qty, boxes: t.boxes + (r.line.box_qty ?? 0), checked: t.checked + r.checked, passed: t.passed + r.passed, failed: t.failed + r.failed }),
    { units: 0, boxes: 0, checked: 0, passed: 0, failed: 0 }
  )
  const totRate = tot.checked > 0 ? ((tot.failed / tot.checked) * 100).toFixed(1) : '0.0'

  const allDone = rows.length > 0 && rows.every((r) => r.done)
  const overall = !allDone
    ? { tone: 'warn' as const, label: 'QC in progress' }
    : rows.some((r) => r.result?.tone === 'fail')
      ? { tone: 'fail' as const, label: 'Failed' }
      : rows.some((r) => r.result?.tone === 'warn')
        ? { tone: 'warn' as const, label: 'Passed with remarks' }
        : { tone: 'ok' as const, label: 'Passed' }

  const boxChecks = [...ship.box_label_checks].sort((a, b) => a.sample_no - b.sample_no)
  const boxLabels = needsBoxLabels(ship.dispatch_mode ?? '')

  // Not OK points and remarks, flattened across SKUs.
  const findings: { n: number; ref: number; text: string; note: string }[] = []
  for (const r of rows) {
    for (const sec of CHECK_SECTIONS)
      for (const it of sec.items) {
        const c = r.insp?.checks?.[String(it.no)]
        if (c?.r === 'no') findings.push({ n: r.n, ref: it.no, text: it.text, note: c.n ?? '' })
      }
  }
  const remarks = rows
    .map((r) => ({ n: r.n, text: [failReason(r.insp?.checks) && `Failed units: ${failReason(r.insp?.checks)}`, r.insp?.qc_remarks?.trim()].filter(Boolean).join('. ') }))
    .filter((m) => m.text)

  const disp = [...ship.dispatches].sort((a, b) => a.dispatched_at.localeCompare(b.dispatched_at))
  const sentUnits = disp.reduce((n, d) => n + d.dispatch_lines.reduce((s, x) => s + x.units, 0), 0)
  const sentBoxes = disp.reduce((n, d) => n + d.boxes_sent, 0)
  const lastDisp = disp[disp.length - 1]
  const lastApproved = [...disp].reverse().find((d) => d.wm_approved_at)
  const inspectors = [...new Set(rows.map((r) => r.insp?.inspector_name).filter(Boolean))] as string[]
  const lastQc = rows.map((r) => r.insp?.submitted_at).filter(Boolean).sort().pop() ?? null

  const head = (
    <header className="head">
      <div>
        <div className="brand">Helett Enterprises</div>
        <div className="doctype">Shipment QC Summary · Outbound shipment</div>
      </div>
      <div className="ref">
        {ship.ref}
        <b className="mono" style={{ fontSize: '11pt' }}>
          {ship.fba_id}
        </b>
        Issued {fmtDate(todayISO())}
      </div>
    </header>
  )
  const foot = (page: number) => (
    <div className="foot">
      <span>
        Helett Enterprises · Shipment QC Summary · {ship.fba_id} · {ship.ref}
      </span>
      <span>Page {page} of 2</span>
    </div>
  )

  return (
    <div>
      <div className="no-print sticky top-14 lg:top-0 z-20 bg-canvas">
        <div className="mx-auto px-4 lg:px-6 pt-4 pb-3 max-w-[1100px] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Shipment QC report</h1>
            <p className="text-sm text-muted">
              Two pages for the whole shipment, {rows.length} SKU{rows.length === 1 ? '' : 's'} side by side.
              {!allDone && ' QC is not finished on every SKU yet, so the report shows what is done so far.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Link to={`/shipments/${ship.id}`} className="min-h-[44px] px-4 rounded-lg bg-[#eceef1] hover:bg-[#e1e4e8] font-medium flex items-center">
              Back
            </Link>
            <Btn onClick={() => printAs(ship.fba_id, 'QC-Report')}>Print or save PDF</Btn>
          </div>
        </div>
      </div>

      <div className="qcform-preview overflow-x-auto px-4 lg:px-6 pb-10 print:overflow-visible print:p-0">
        <div className="rpt qcform-sheets">
          {/* ------------------------------------------------------------ page 1 */}
          <section className="sheet">
            {head}
            <div className="title">
              <div>
                <h1 className="mono" style={{ fontSize: '19pt', fontFamily: 'inherit' }}>
                  {ship.fba_id}
                </h1>
                <div className="sub">
                  {ship.warehouse} · {ship.dispatch_mode ?? '—'} · {rows.length} SKU{rows.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className={`outcome ${overall.tone}`}>
                <small>Shipment QC outcome</small>
                <b>{overall.label}</b>
              </div>
            </div>

            <dl className="facts" style={{ margin: 0 }}>
              <div>
                <dt>Dispatch date</dt>
                <dd>{fmtDate(ship.dispatch_date) || '—'}</dd>
              </div>
              <div>
                <dt>Appointment</dt>
                <dd>{ship.appointment_at ? fmtDateTime(ship.appointment_at) : '—'}</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>{ship.transport || '—'}</dd>
              </div>
              <div>
                <dt>Units ordered</dt>
                <dd>{tot.units.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Boxes in shipment</dt>
                <dd>{ship.box_qty_total}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{ship.status}</dd>
              </div>
            </dl>

            <div className="figs">
              <div>
                <div className="n">{tot.checked.toLocaleString()}</div>
                <div className="l">Units checked</div>
              </div>
              <div>
                <div className="n" style={{ color: 'var(--ok)' }}>
                  {tot.passed.toLocaleString()}
                </div>
                <div className="l">Passed</div>
              </div>
              <div>
                <div className="n" style={tot.failed > 0 ? { color: 'var(--fail)' } : undefined}>
                  {tot.failed.toLocaleString()}
                </div>
                <div className="l">Failed</div>
              </div>
              <div>
                <div className="n">{totRate}%</div>
                <div className="l">Fail rate</div>
              </div>
            </div>

            <h2 style={{ marginTop: '6mm' }}>
              1. SKU summary <span>One row per product in the shipment</span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '7mm' }}>No.</th>
                  <th>Product</th>
                  <th className="num" style={{ width: '14mm' }}>
                    Units
                  </th>
                  <th className="num" style={{ width: '13mm' }}>
                    Boxes
                  </th>
                  <th className="num" style={{ width: '15mm' }}>
                    Passed
                  </th>
                  <th className="num" style={{ width: '14mm' }}>
                    Failed
                  </th>
                  <th className="num" style={{ width: '14mm' }}>
                    Fail %
                  </th>
                  <th style={{ width: '30mm' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line.id} className={r.result?.tone === 'fail' ? 'fail' : ''}>
                    <td className="ref-no">{r.n}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.line.product_name}</div>
                      <div className="muted" style={{ fontSize: '7.5pt' }}>
                        <span className="mono" style={{ fontSize: '7.5pt' }}>
                          {r.line.asin}
                        </span>
                        {r.insp ? ` · ${r.insp.record_no}` : ''}
                        {r.insp?.inspector_name ? ` · ${r.insp.inspector_name}` : ''}
                        {r.insp?.inspection_date ? ` · ${fmtDate(r.insp.inspection_date)}` : ''}
                      </div>
                    </td>
                    <td className="num">{r.line.unit_qty.toLocaleString()}</td>
                    <td className="num">{r.line.box_qty ?? '—'}</td>
                    <td className="num">{r.done ? r.passed.toLocaleString() : '—'}</td>
                    <td className="num">{r.done ? r.failed.toLocaleString() : '—'}</td>
                    <td className="num">{r.done ? r.rate.toFixed(1) : '—'}</td>
                    <td>
                      {r.result ? <span className={`res ${r.result.tone}`}>{r.result.label}</span> : <span className="res na">{r.insp ? 'In progress' : 'Not started'}</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td />
                  <td style={{ fontWeight: 600 }}>Total</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {tot.units.toLocaleString()}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {tot.boxes || '—'}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {tot.passed.toLocaleString()}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {tot.failed.toLocaleString()}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {totRate}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>

            <h2>
              2. Label verification <span>Scanned at inspection</span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '7mm' }}>No.</th>
                  <th>FNSKU scans</th>
                  <th className="num" style={{ width: '24mm' }}>
                    Samples
                  </th>
                  <th className="num" style={{ width: '24mm' }}>
                    Verified
                  </th>
                  <th className="num" style={{ width: '24mm' }}>
                    Mismatch
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line.id} className={r.fnBad > 0 ? 'fail' : ''}>
                    <td className="ref-no">{r.n}</td>
                    <td>{r.line.product_name}</td>
                    <td className="num">{r.fnTotal || '—'}</td>
                    <td className="num">{r.fnTotal ? r.fnOk : '—'}</td>
                    <td className="num">{r.fnTotal ? r.fnBad : '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td />
                  <td style={{ fontWeight: 600 }}>Carton labels</td>
                  <td className="num">{boxLabels ? boxChecks.length || '—' : '—'}</td>
                  <td className="num">{boxLabels && boxChecks.length ? boxChecks.filter((c) => c.ok === true).length : '—'}</td>
                  <td className="num">{boxLabels && boxChecks.length ? boxChecks.filter((c) => c.ok === false).length : '—'}</td>
                </tr>
              </tbody>
            </table>
            {!boxLabels && (
              <p className="muted" style={{ margin: '1.5mm 0 0', fontSize: '8pt' }}>
                Carton label check not required for {ship.dispatch_mode} shipments (collected by Amazon).
              </p>
            )}

            {foot(1)}
          </section>

          {/* ------------------------------------------------------------ page 2 */}
          <section className="sheet">
            {head}

            <h2 style={{ marginTop: '5mm' }}>
              3. Checklist by SKU <span>Column numbers match the SKU summary</span>
            </h2>
            <table style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '8mm' }}>Ref</th>
                  <th>Inspection point</th>
                  {rows.map((r) => (
                    <th key={r.line.id} style={{ textAlign: 'center', width: `${Math.max(7, Math.min(14, 84 / Math.max(rows.length, 1)))}mm` }}>
                      {r.n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CHECK_SECTIONS.map((sec) => (
                  <MatrixGroup key={sec.id} title={sec.title.charAt(0) + sec.title.slice(1).toLowerCase()} items={sec.items} cols={rows.length} rows={rows.map((r) => r.insp?.checks ?? {})} />
                ))}
              </tbody>
            </table>

            <h2>4. Findings</h2>
            {findings.length === 0 && remarks.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {allDone ? 'No failed checks and no QC remarks.' : 'Nothing recorded yet.'}
              </p>
            ) : (
              <table>
                <tbody>
                  {findings.slice(0, MAX_FINDINGS).map((f, i) => (
                    <tr key={`f${i}`} className="fail">
                      <td className="ref-no" style={{ width: '8mm' }}>
                        {f.n}
                      </td>
                      <td>
                        <span className="res fail">Not OK</span> · {f.text}
                        {f.note ? <span className="note"> — {f.note}</span> : null}
                      </td>
                    </tr>
                  ))}
                  {findings.length > MAX_FINDINGS && (
                    <tr>
                      <td />
                      <td className="muted">+{findings.length - MAX_FINDINGS} more failed checks, see the SKU records.</td>
                    </tr>
                  )}
                  {remarks.slice(0, 3).map((m) => (
                    <tr key={`r${m.n}`}>
                      <td className="ref-no" style={{ width: '8mm' }}>
                        {m.n}
                      </td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{m.text.length > 220 ? `${m.text.slice(0, 220)}…` : m.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h2>5. Dispatch</h2>
            <table style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '9mm' }}>No.</th>
                  <th style={{ width: '25mm' }}>Date</th>
                  <th style={{ width: '24mm' }}>Transport</th>
                  <th className="num" style={{ width: '24mm' }}>
                    Boxes
                  </th>
                  <th className="num" style={{ width: '28mm' }}>
                    Units
                  </th>
                  <th style={{ paddingLeft: '6mm' }}>Approved by</th>
                </tr>
              </thead>
              <tbody>
                {disp.map((d, n) => (
                  <tr key={d.id}>
                    <td className="ref-no">{n + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.dispatched_at)}</td>
                    <td>{d.transport || '—'}</td>
                    <td className="num">{d.boxes_sent}</td>
                    <td className="num">{d.dispatch_lines.reduce((s, x) => s + x.units, 0).toLocaleString()}</td>
                    <td style={{ paddingLeft: '6mm' }}>{d.wm_approved_at ? d.wm_name || '—' : <span className="muted">Pending</span>}</td>
                  </tr>
                ))}
                {disp.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Not dispatched at the time of issue.
                    </td>
                  </tr>
                )}
                {disp.length > 0 && (
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 600 }}>
                      Sent so far
                    </td>
                    <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {sentBoxes} of {ship.box_qty_total}
                    </td>
                    <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {sentUnits.toLocaleString()} of {tot.units.toLocaleString()}
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>

            <h2>6. Authorisation</h2>
            <div className="auth">
              {[
                { role: 'Quality control', who: inspectors.join(', '), when: allDone ? lastQc : null },
                { role: 'Dispatch confirmed by', who: lastDisp?.dispatched_by_name ?? '', when: lastDisp?.dispatched_at },
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
      </div>
    </div>
  )
}

function MatrixGroup({
  title,
  items,
  cols,
  rows
}: {
  title: string
  items: { no: number; text: string }[]
  cols: number
  rows: Inspection['checks'][]
}) {
  return (
    <>
      <tr className="group">
        <td colSpan={2 + cols}>{title}</td>
      </tr>
      {items.map((it) => (
        <tr key={it.no} className={rows.some((c) => c[String(it.no)]?.r === 'no') ? 'fail' : ''}>
          <td className="ref-no">{it.no}</td>
          <td style={{ padding: '1.1mm 2mm' }}>{it.text}</td>
          {rows.map((c, i) => {
            const r = c[String(it.no)]?.r
            return (
              <td key={i} style={{ textAlign: 'center', padding: '1.1mm 1mm' }}>
                {r === 'ok' ? <span className="res ok">✓</span> : r === 'no' ? <span className="res fail">✗</span> : <span className="res na">–</span>}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
