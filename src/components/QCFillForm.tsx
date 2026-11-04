import { CHECK_SECTIONS, ALL_ITEMS } from '../data/checklist'
import { fmtTimeSec } from '../lib/format'
import { SignaturePad } from './SignaturePad'
import { SearchableSelect } from './SearchableSelect'
import { DateInput } from './DateInput'
import type { FnskuCheck } from '../types/db'
import type { Draft, RecordBundle } from './RecordSheet'

type Mark = 'ok' | 'no' | 'na'

interface Props {
  data: RecordBundle
  draft: Draft
  readOnly: boolean
  setDraft: (patch: Partial<Draft>) => void
  qcSign: string
  setQcSign: (v: string) => void
  onScanFn: (c: FnskuCheck) => void
  people: string[]
}

function Card({ title, aside, className = '', children }: { title: string; aside?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`bg-surface rounded-xl shadow-card mb-4 overflow-visible ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 min-h-[48px] border-b border-line">
        <h2 className="font-semibold">{title}</h2>
        {aside && <span className="text-[13px] text-muted">{aside}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="block text-sm font-medium mb-1.5">{children}</span>
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  colors,
  label
}: {
  options: T[]
  value: T | ''
  onChange: (v: T) => void
  disabled?: boolean
  colors?: Partial<Record<T, string>>
  label: string
}) {
  return (
    <div className="flex gap-2" role="group" aria-label={label}>
      {options.map((opt) => {
        const active = opt === value
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={`flex-1 min-h-[48px] px-2 rounded-lg text-sm font-medium disabled:opacity-60 ${
              active ? colors?.[opt] ?? 'bg-ink text-white' : 'bg-[#eceef1] text-ink'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function Stepper({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="w-12 h-12 rounded-lg bg-[#eceef1] text-xl font-semibold text-ink disabled:opacity-50"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        disabled={disabled}
        value={value === 0 ? '' : value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(isNaN(n) ? 0 : Math.max(0, n))
        }}
        className="w-20 h-12 text-center text-lg font-medium rounded-lg bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none disabled:bg-canvas"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled}
        onClick={() => onChange(value + 1)}
        className="w-12 h-12 rounded-lg bg-[#eceef1] text-xl font-semibold text-ink disabled:opacity-50"
      >
        +
      </button>
    </div>
  )
}

const SECTION_ORDER: Record<string, string> = { A: 'order-3', B: 'order-4', C: 'order-5' }

const GOOD_BAD = {
  Good: 'bg-ok text-white',
  Bad: 'bg-fail text-white',
  Satisfactory: 'bg-warn text-white'
}

function ScanRow({
  title,
  scanned,
  ok,
  at,
  reason,
  readOnly,
  onScan
}: {
  title: string
  scanned: string | null
  ok: boolean | null
  at: string | null
  reason: string
  readOnly: boolean
  onScan: () => void
}) {
  const box = ok === true ? 'bg-ok/10' : ok === false ? 'bg-fail/10' : 'bg-[#f6f7f8]'
  return (
    <div className={`rounded-lg p-3 mb-2 last:mb-0 ${box}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {scanned && (
            <div className="mt-0.5 font-mono text-xs text-muted break-all">
              {scanned} <span className="text-muted/70">{fmtTimeSec(at)}</span>
            </div>
          )}
        </div>
        {ok === true && (
          <span className="shrink-0 flex items-center gap-1.5 text-ok font-semibold" aria-label="Done">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
            Done
          </span>
        )}
        {ok === false && (
          <span className="shrink-0 flex items-center gap-1.5 text-fail font-semibold" aria-label="Rejected">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            Rejected
          </span>
        )}
        {ok === null && <span className="shrink-0 text-sm text-muted">Not scanned</span>}
      </div>
      {ok === false && <p className="mt-1.5 text-sm text-fail">{reason}</p>}
      {!readOnly && ok !== true && (
        <button
          type="button"
          onClick={onScan}
          className="mt-3 w-full min-h-[48px] rounded-lg bg-ink text-white font-medium flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M20 7V5a1 1 0 00-1-1h-2M20 17v2a1 1 0 01-1 1h-2M4 12h16" />
          </svg>
          {scanned ? 'Scan again' : 'Scan'}
        </button>
      )}
    </div>
  )
}

const BOX_REASON: Record<string, string> = {
  unreadable: 'This is not an Amazon carton label.',
  wrong_fba: 'This label is for a different FBA shipment.'
}

export function QCFillForm({ data, draft, readOnly, setDraft, qcSign, setQcSign, onScanFn, people }: Props) {
  const { line, ship, fn, boxes, insp } = data
  const answered = ALL_ITEMS.filter((i) => draft.checks[String(i.no)]).length
  const rate = draft.inspected_qty > 0 ? ((draft.rejected_qty / draft.inspected_qty) * 100).toFixed(1) : '0.0'
  const passed = Math.max(0, draft.inspected_qty - draft.rejected_qty)
  // Passed always follows from checked and failed, so it is never typed.
  const setQty = (patch: Partial<{ inspected_qty: number; rejected_qty: number }>) => {
    const checked = patch.inspected_qty ?? draft.inspected_qty
    const failed = patch.rejected_qty ?? draft.rejected_qty
    setDraft({ ...patch, accepted_qty: Math.max(0, checked - failed) })
  }

  function setCheck(no: number, patch: { r?: Mark; n?: string }) {
    const cur = draft.checks[String(no)] ?? { r: 'ok' as Mark }
    setDraft({ checks: { ...draft.checks, [String(no)]: { ...cur, ...patch } } })
  }

  const MARK_STYLE: Record<Mark, string> = {
    ok: 'bg-ok text-white',
    no: 'bg-fail text-white',
    na: 'bg-ink text-white'
  }
  const MARK_LABEL: Record<Mark, string> = { ok: 'OK', no: 'Not OK', na: 'N/A' }

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8 py-5 pb-28 text-ink flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-x-6 lg:items-start">
      <div className="contents lg:block">
      {CHECK_SECTIONS.map((sec) => (
        <Card key={sec.id} title={sec.title.charAt(0) + sec.title.slice(1).toLowerCase()} aside={sec.id === 'A' ? `${answered} of ${ALL_ITEMS.length} checked` : undefined} className={SECTION_ORDER[sec.id]}>
          {sec.items.map((item) => {
            const c = draft.checks[String(item.no)]
            return (
              <div key={item.no} className="py-3 border-t first:border-t-0 first:pt-0 last:pb-0 border-line">
                <div className="lg:flex lg:items-center lg:gap-6">
                <p className="text-[15px] mb-2 lg:mb-0 lg:flex-1">
                  <span className="text-muted mr-1.5">{item.no}.</span>
                  {item.text}
                </p>
                <div className="flex gap-2 lg:w-[280px] lg:shrink-0" role="group" aria-label={`Item ${item.no}`}>
                  {(['ok', 'no', 'na'] as Mark[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={c?.r === m}
                      onClick={() => setCheck(item.no, { r: m })}
                      className={`flex-1 min-h-[48px] lg:min-h-[40px] rounded-lg text-sm font-medium disabled:opacity-60 ${
                        c?.r === m ? MARK_STYLE[m] : 'bg-[#eceef1] text-ink'
                      }`}
                    >
                      {MARK_LABEL[m]}
                    </button>
                  ))}
                </div>
                </div>
                {c?.r === 'no' && (
                  <input
                    type="text"
                    disabled={readOnly}
                    value={c.n ?? ''}
                    onChange={(e) => setCheck(item.no, { n: e.target.value })}
                    placeholder="What is wrong? (required)"
                    aria-label={`Item ${item.no} remark`}
                    className={`mt-2 w-full h-12 px-3 rounded-lg text-sm disabled:bg-canvas focus:outline-none focus:ring-2 ${
                      c.n?.trim() ? 'bg-[#f0f2f4] focus:ring-ink' : 'bg-[#fde8e6] focus:ring-fail'
                    }`}
                  />
                )}
              </div>
            )
          })}
        </Card>
      ))}

      <Card title="FNSKU check" aside={`Scan any ${fn.length} unit${fn.length === 1 ? '' : 's'}`} className="order-7">
        {[...fn].sort((a, b) => a.sample_no - b.sample_no).map((c) => (
          <ScanRow
            key={c.id}
            title={`Unit ${c.sample_no} of ${fn.length}`}
            scanned={c.scanned}
            ok={c.ok}
            at={c.scanned_at}
            reason="FNSKU does not match this product."
            readOnly={readOnly}
            onScan={() => onScanFn(c)}
          />
        ))}
      </Card>

      </div>

      <div className="contents lg:block">
      <Card title={line.product_name} aside={insp.record_no} className="order-1">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-muted">FBA shipment</dt>
            <dd className="font-mono font-medium break-all">{ship.fba_id}</dd>
          </div>
          <div>
            <dt className="text-muted">Warehouse</dt>
            <dd className="font-medium">{ship.warehouse}</dd>
          </div>
          <div>
            <dt className="text-muted">Units received</dt>
            <dd className="font-medium">{line.unit_qty}</dd>
          </div>
          <div>
            <dt className="text-muted">Boxes (this SKU)</dt>
            <dd className="font-medium">{line.box_qty ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Details" className="order-2">
        <div className="mb-4">
          <Label>Inspection date</Label>
          <DateInput value={draft.inspection_date} onChange={(v) => setDraft({ inspection_date: v })} disabled={readOnly} />
        </div>
        <div>
          <Label>Units checked</Label>
          <Stepper label="Units checked" value={draft.inspected_qty} onChange={(n) => setQty({ inspected_qty: n })} disabled={readOnly} />
          <p className="text-[13px] text-muted mt-1.5">Count every unit you tested, including the ones that failed.</p>
        </div>
      </Card>

      <Card title="Quantity" aside={`Fail rate ${rate}%`} className="order-6">
        <div className="mb-4">
          <Label>Failed QC</Label>
          <Stepper label="Failed QC" value={draft.rejected_qty} onChange={(n) => setQty({ rejected_qty: n })} disabled={readOnly} />
        </div>
        <div className="rounded-lg bg-canvas px-4 py-3 flex items-baseline justify-between">
          <span className="text-sm text-muted">Passed, ready to ship</span>
          <span className="text-2xl font-semibold">{passed}</span>
        </div>
        {draft.inspected_qty > 0 && passed < line.unit_qty && (
          <p className="text-sm text-warn mt-3">
            {line.unit_qty - passed} short of the {line.unit_qty} this shipment needs.
          </p>
        )}
        {draft.rejected_qty > draft.inspected_qty && <p className="text-sm text-fail mt-3">Failed cannot be more than checked.</p>}
      </Card>

      <Card title="Result" className="order-9">
        <div className="mb-4">
          <Label>Overall result</Label>
          <Segmented
            label="Overall result"
            options={['Good', 'Satisfactory', 'Bad']}
            value={(draft.overall_result as 'Good' | 'Satisfactory' | 'Bad') || ''}
            onChange={(v) => setDraft({ overall_result: v })}
            disabled={readOnly}
            colors={GOOD_BAD}
          />
        </div>
        <div className="mb-4">
          <Label>Product condition</Label>
          <Segmented
            label="Product condition"
            options={['Good', 'Bad']}
            value={(draft.product_condition as 'Good' | 'Bad') || ''}
            onChange={(v) => setDraft({ product_condition: v })}
            disabled={readOnly}
            colors={GOOD_BAD}
          />
        </div>
        <div className="mb-4">
          <Label>Packaging quality</Label>
          <Segmented
            label="Packaging quality"
            options={['Good', 'Bad']}
            value={(draft.packaging_quality as 'Good' | 'Bad') || ''}
            onChange={(v) => setDraft({ packaging_quality: v })}
            disabled={readOnly}
            colors={GOOD_BAD}
          />
        </div>
        <div>
          <Label>QC remarks</Label>
          <textarea
            disabled={readOnly}
            value={draft.qc_remarks}
            onChange={(e) => setDraft({ qc_remarks: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink focus:outline-none disabled:bg-canvas"
          />
        </div>
      </Card>

      {!readOnly && (
        <Card title="Sign off" className="order-10">
          <div className="mb-4">
            <Label>Inspector name</Label>
            <SearchableSelect
              options={[...new Set([...people, ...(draft.inspector_name ? [draft.inspector_name] : [])])]}
              value={draft.inspector_name}
              onChange={(v) => setDraft({ inspector_name: v })}
              placeholder="Choose inspector"
            />
          </div>
          <Label>QC signature</Label>
          <SignaturePad value={qcSign} onChange={setQcSign} />
        </Card>
      )}
      </div>
    </div>
  )
}
