import { CHECK_SECTIONS } from '../data/checklist'
import { fmtDate, fmtDateTime, fmtTimeSec } from '../lib/format'
import { Chip, Panel } from './ui'
import { needsBoxLabels } from '../data/options'
import type { BoxCheck } from '../types/db'
import type { Draft, RecordBundle } from './RecordSheet'

// On-screen QC record (read-only). The approved A4 sheet is still what
// prints: see RecordSheet, rendered for print only in QCRecord.

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{k}</dt>
      <dd className={`font-medium break-words ${mono ? 'font-mono' : ''}`}>{v || '—'}</dd>
    </div>
  )
}

function resultTone(v: string): 'ok' | 'warn' | 'fail' | 'gray' {
  return v === 'Good' ? 'ok' : v === 'Satisfactory' ? 'warn' : v === 'Bad' ? 'fail' : 'gray'
}

export function RecordView({ data, draft, onScanBox }: { data: RecordBundle; draft: Draft; onScanBox?: (c: BoxCheck) => void }) {
  const { insp, line, ship, fn, boxes, dispatches } = data
  const rate = draft.inspected_qty > 0 ? ((draft.rejected_qty / draft.inspected_qty) * 100).toFixed(1) : '0.0'

  const myDispatches = dispatches
    .filter((d) => d.dispatch_lines.some((dl) => dl.line_id === line.id))
    .sort((a, b) => a.dispatched_at.localeCompare(b.dispatched_at))
  const lastDispatch = myDispatches[myDispatches.length - 1]
  const lastApproved = [...myDispatches].reverse().find((d) => d.wm_approved_at)

  const failed = CHECK_SECTIONS.flatMap((s) => s.items).filter((i) => draft.checks[String(i.no)]?.r === 'no').length

  return (
    <div className="print:hidden mx-auto max-w-2xl lg:max-w-6xl px-4 lg:px-8 pb-8 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
      {/* main column: what was checked */}
      <div className="space-y-5 min-w-0 order-2 lg:order-1">
        {CHECK_SECTIONS.map((sec) => (
          <Panel key={sec.id} title={sec.title.charAt(0) + sec.title.slice(1).toLowerCase()} flush>
            <ul>
              {sec.items.map((item) => {
                const c = draft.checks[String(item.no)]
                return (
                  <li
                    key={item.no}
                    className={`px-4 py-3 border-t first:border-t-0 border-line flex items-start justify-between gap-4 ${
                      c?.r === 'no' ? 'bg-fail/[0.04]' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[15px]">
                        <span className="text-muted mr-1.5">{item.no}.</span>
                        {item.text}
                      </div>
                      {c?.n && <div className="text-sm text-fail mt-0.5">{c.n}</div>}
                    </div>
                    {c?.r === 'ok' ? (
                      <Chip tone="ok">OK</Chip>
                    ) : c?.r === 'no' ? (
                      <Chip tone="fail">Not OK</Chip>
                    ) : (
                      <Chip tone="gray">N/A</Chip>
                    )}
                  </li>
                )
              })}
            </ul>
          </Panel>
        ))}

        <Panel title="FNSKU check" flush>
          <ul>
            {[...fn]
              .sort((a, b) => a.sample_no - b.sample_no)
              .map((c) => (
                <li key={c.id} className="px-4 py-3 border-t first:border-t-0 border-line flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm break-all">{c.scanned ?? 'Not scanned'}</div>
                    <div className="text-[13px] text-muted">
                      Unit {c.sample_no} of {fn.length}{c.scanned_at ? ` · ${fmtTimeSec(c.scanned_at)}` : ''}
                    </div>
                  </div>
                  {c.ok === null ? <Chip tone="gray">Not scanned</Chip> : c.ok ? <Chip tone="ok">FNSKU OK</Chip> : <Chip tone="fail">Mismatch</Chip>}
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Box label check" flush>
          {needsBoxLabels(ship.dispatch_mode ?? '') ? (
            <>
          <ul>
            {[...boxes]
              .sort((a, b) => a.sample_no - b.sample_no)
              .map((c) => (
                <li key={c.id} className="px-4 py-3 border-t first:border-t-0 border-line flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm break-all">{c.scanned ?? 'Not scanned'}</div>
                    <div className="text-[13px] text-muted">
                      Box {c.sample_no} of {boxes.length}
                      {c.scanned_at ? ` · ${fmtTimeSec(c.scanned_at)}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    {c.ok === null ? <Chip tone="gray">Not scanned</Chip> : c.ok ? <Chip tone="ok">Label OK</Chip> : <Chip tone="fail">Mismatch</Chip>}
                    {onScanBox && c.ok !== true && (
                      <button
                        type="button"
                        onClick={() => onScanBox(c)}
                        className="min-h-[40px] px-4 rounded-lg bg-ink text-white text-sm font-medium"
                      >
                        {c.scanned ? 'Scan again' : 'Scan'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
          </ul>
            </>
          ) : (
            <p className="p-4 text-sm text-muted">Not needed for {ship.dispatch_mode}. Amazon collects this shipment.</p>
          )}
        </Panel>

        <Panel title="Sign-off">
          <p className="text-sm text-muted mb-4">Each step is recorded under the login of the person who did it.</p>
          <ol className="grid sm:grid-cols-3 gap-4 sm:gap-0">
            {[
              { role: 'QC', verb: 'Inspected', name: draft.inspector_name, when: insp.submitted_at, wait: 'Waiting for QC' },
              { role: 'Dispatch', verb: 'Dispatched', name: lastDispatch?.dispatched_by_name ?? '', when: lastDispatch?.dispatched_at, wait: 'Not dispatched yet' },
              { role: 'Final confirmation', verb: 'Approved', name: lastApproved?.wm_name ?? '', when: lastApproved?.wm_approved_at, wait: 'Waiting for the manager' }
            ].map((st, i, all) => {
              const done = !!st.when
              return (
                <li key={st.role} className="relative flex sm:block gap-3 sm:pr-4">
                  {/* the line joining the steps */}
                  {i < all.length - 1 && <span aria-hidden="true" className={`absolute left-[15px] top-9 bottom-[-16px] w-0.5 sm:left-9 sm:top-[15px] sm:bottom-auto sm:h-0.5 sm:w-[calc(100%-40px)] ${done ? 'bg-ink' : 'bg-[#dfe2e6]'}`} />}
                  <span className={`relative w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${done ? 'bg-ink text-white' : 'bg-[#eceef2] text-[#9aa2ad]'}`}>
                    {done ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                    )}
                  </span>
                  <div className="sm:mt-3 min-w-0 pb-1">
                    <div className="text-[13px] text-muted">{st.role}</div>
                    {done ? (
                      <>
                        <div className="text-[15px] font-semibold break-words">{st.name || '—'}</div>
                        <div className="text-[13px] text-muted">
                          {st.verb} {fmtDateTime(st.when!)}
                        </div>
                      </>
                    ) : (
                      <div className="text-[15px] text-muted">{st.wait}</div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </Panel>
      </div>

      {/* side column: the outcome */}
      <aside className="space-y-5 order-1 lg:order-2">
        <Panel title="Result">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Chip tone={resultTone(draft.overall_result)}>{draft.overall_result || 'No result'}</Chip>
            {failed > 0 && <Chip tone="fail">{failed} check{failed > 1 ? 's' : ''} failed</Chip>}
          </div>
          <dl className="grid grid-cols-3 gap-3 text-center mb-4">
            <div className="rounded-lg bg-canvas py-3">
              <dd className="text-xl font-semibold">{draft.inspected_qty}</dd>
              <dt className="text-[13px] text-muted">Checked</dt>
            </div>
            <div className="rounded-lg bg-canvas py-3">
              <dd className="text-xl font-semibold text-ok">{draft.accepted_qty}</dd>
              <dt className="text-[13px] text-muted">Passed</dt>
            </div>
            <div className="rounded-lg bg-canvas py-3">
              <dd className={`text-xl font-semibold ${draft.rejected_qty > 0 ? 'text-fail' : ''}`}>{draft.rejected_qty}</dd>
              <dt className="text-[13px] text-muted">Failed</dt>
            </div>
          </dl>
          <dl className="space-y-3 text-sm">
            <Fact k="Fail rate" v={`${rate}%`} />
            <Fact k="Product condition" v={draft.product_condition} />
            <Fact k="Packaging quality" v={draft.packaging_quality} />
            {draft.qc_remarks && <Fact k="QC remarks" v={draft.qc_remarks} />}
          </dl>
        </Panel>

        <Panel title="Shipment">
          <dl className="space-y-3 text-sm">
            <Fact k="FBA shipment" v={ship.fba_id} mono />
            <Fact k="ASIN" v={line.asin} mono />
            <Fact k="Warehouse" v={ship.warehouse} />
            <Fact k="Mode of dispatch" v={ship.dispatch_mode ?? ''} />
            <Fact k="Appointment" v={ship.appointment_at ? fmtDateTime(ship.appointment_at) : ''} />
            <Fact k="Units received" v={String(line.unit_qty)} />
            <Fact k="Boxes (this SKU)" v={line.box_qty ? String(line.box_qty) : ''} />
            <Fact k="Inspected on" v={fmtDate(draft.inspection_date)} />
            <Fact k="Inspector" v={draft.inspector_name} />
          </dl>
        </Panel>

        <Panel title="Dispatch" flush>
          {myDispatches.length === 0 ? (
            <p className="p-4 text-sm text-muted">Not dispatched yet.</p>
          ) : (
            <ul>
              {myDispatches.map((d, n) => {
                const units = d.dispatch_lines.filter((x) => x.line_id === line.id).reduce((s, x) => s + x.units, 0)
                return (
                  <li key={d.id} className="px-4 py-3 border-t first:border-t-0 border-line text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        Dispatch {n + 1} · {fmtDate(d.dispatched_at)}
                      </span>
                      {d.wm_approved_at ? <Chip tone="ok">Approved</Chip> : <Chip tone="info">Awaiting WM</Chip>}
                    </div>
                    <div className="text-muted">
                      {units} units · {d.boxes_sent} boxes{d.transport ? ` · ${d.transport}` : ''}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </aside>
    </div>
  )
}
