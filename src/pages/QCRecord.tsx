import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from '../hooks/useLive'
import { errText, supabase } from '../lib/supabase'
import { uploadSignature } from '../lib/signatures'
import { todayISO } from '../lib/format'
import { ALL_ITEMS } from '../data/checklist'
import { BackLink, Btn, ErrorBox, HoldStamp, Loading, Modal, Notice, Page, StatusStamp } from '../components/ui'
import { ConfirmModal } from '../components/ReasonModal'
import { QCFillForm } from '../components/QCFillForm'
import { usePeople } from '../hooks/usePeople'
import { invalidateAll } from '../lib/cache'
import { RecordView } from '../components/RecordView'
import { RecordSheet, draftFromInspection, type Draft, type RecordBundle } from '../components/RecordSheet'
import type { BoxCheck, FnskuCheck, Inspection, Shipment, ShipmentLine } from '../types/db'

const BarcodeScanner = lazy(() => import('../components/BarcodeScanner'))

type Target = { kind: 'fn' | 'box'; id: string; title: string; hint: string }

const draftKey = (id: string) => `helett-qc-draft-${id}`

function loadDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id))
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}


export function QCRecord() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const { data, error, loading, reload } = useLive<RecordBundle>(
    async () => {
      const { data: i, error: e1 } = await supabase
        .from('inspections')
        .select('*, shipment_lines(*, shipments(*)), fnsku_checks(*)')
        .eq('id', id!)
        .single()
      if (e1) throw e1
      const row = i as unknown as Inspection & {
        shipment_lines: ShipmentLine & { shipments: Shipment }
        fnsku_checks: FnskuCheck[]
      }
      const ship = row.shipment_lines.shipments
      const [{ data: boxes, error: e2 }, { data: dispatches, error: e3 }] = await Promise.all([
        supabase.from('box_label_checks').select('*').eq('shipment_id', ship.id),
        supabase.from('dispatches').select('*, dispatch_lines(*)').eq('shipment_id', ship.id)
      ])
      if (e2) throw e2
      if (e3) throw e3
      const { shipment_lines, fnsku_checks, ...insp } = row
      const { shipments: _s, ...line } = shipment_lines
      return {
        insp: insp as Inspection,
        line: line as ShipmentLine,
        ship,
        fn: fnsku_checks,
        boxes: (boxes ?? []) as BoxCheck[],
        dispatches: (dispatches ?? []) as RecordBundle['dispatches']
      }
    },
    ['inspections', 'shipment_lines', 'shipments', 'fnsku_checks', 'box_label_checks', 'dispatches', 'dispatch_lines'],
    `qc-${id}`
  )

  // Inventory is the admin and may fill QC cases too (the database allows it).
  const editing = (profile?.role === 'qc' || profile?.role === 'inventory' || !!profile?.is_admin) && data?.insp.status === 'Open'

  const [draft, setDraft] = useState<Draft | null>(null)
  const [qcSign, setQcSign] = useState('')
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (!data || !editing || seeded.current === data.insp.id) return
    seeded.current = data.insp.id
    const base = draftFromInspection(data.insp, profile?.name ?? '')
    if (!base.inspection_date) base.inspection_date = todayISO()
    setDraft(loadDraft(data.insp.id) ?? base)
  }, [data, editing, profile?.name])

  // Per-device convenience only: the checklist is not in the database until
  // Submit, so keep a local copy in case the app is closed mid-way.
  useEffect(() => {
    if (!draft || !data || !editing) return
    try {
      localStorage.setItem(draftKey(data.insp.id), JSON.stringify(draft))
    } catch {
      /* private mode etc. */
    }
  }, [draft, data, editing])

  // Inspector is picked from the people who have an account, never typed.
  const people = usePeople((p) => p.role === 'qc' || p.role === 'inventory' || !!p.is_admin, [profile?.name ?? ''])

  // The 'fix before submitting' list goes away as soon as the case is edited.
  useEffect(() => {
    setSubmitErrors([])
  }, [draft, qcSign])

  const [target, setTarget] = useState<Target | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const scanning = useRef(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [reopen, setReopen] = useState(false)
  const [submitErrors, setSubmitErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)


  if (loading && !data) return <Loading />
  if (error && !data) return <Page><ErrorBox message={error} /></Page>
  if (!data) return null

  const view: Draft = editing && draft ? draft : draftFromInspection(data.insp)
  const canReopen =
    (profile?.role === 'inventory' || profile?.role === 'wm' || !!profile?.is_admin) &&
    data.insp.status === 'Submitted' &&
    !data.dispatches.some((d) => d.dispatch_lines.some((x) => x.line_id === data.line.id))

  // The result of a scan stays on its own row (green done, red rejected).
  // Only a failure to scan at all, such as the same box twice, shows here.
  async function handleScan(code: string) {
    if (!target || scanning.current) return
    scanning.current = true
    const t = target
    setTarget(null)
    setScanError(null)
    try {
      const { error: err } =
        t.kind === 'fn'
          ? await supabase.rpc('scan_fnsku', { p_check: t.id, p_code: code })
          : await supabase.rpc('scan_box_label', { p_check: t.id, p_code: code })
      if (err) throw err
      invalidateAll()
    } catch (e) {
      setScanError(errText(e))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      scanning.current = false
    }
  }

  function validate(): string[] {
    if (!draft) return ['Nothing to submit.']
    const errs: string[] = []
    for (const it of ALL_ITEMS) {
      const c = draft.checks[String(it.no)]
      if (!c) errs.push(`Item ${it.no} is not marked.`)
      else if (c.r === 'no' && !c.n?.trim()) errs.push(`Item ${it.no} is Not OK. Write what is wrong.`)
    }
    if (draft.inspected_qty < 1) errs.push('Enter units checked.')
    if (draft.rejected_qty > draft.inspected_qty) errs.push('Failed cannot be more than checked.')
    if (data!.fn.some((c) => !c.scanned)) errs.push('Scan all FNSKU samples.')
    if (!draft.overall_result) errs.push('Choose the overall result.')
    if (!draft.product_condition) errs.push('Choose product condition.')
    if (!draft.packaging_quality) errs.push('Choose packaging quality.')
    if (!draft.inspector_name.trim()) errs.push('Choose the inspector.')
    if (!qcSign) errs.push('Sign the QC box.')
    return errs
  }

  function askSubmit() {
    const errs = validate()
    setSubmitErrors(errs)
    setSubmitError(null)
    if (errs.length === 0) setConfirmSubmit(true)
    else window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    if (!draft || !data) return
    setBusy(true)
    setSubmitError(null)
    try {
      const sign_path = await uploadSignature(qcSign, 'qc')
      const { error: err } = await supabase.rpc('submit_inspection', { p_id: data.insp.id, p: { ...draft, accepted_qty: Math.max(0, draft.inspected_qty - draft.rejected_qty), sign_path } })
      if (err) throw err
      try {
        localStorage.removeItem(draftKey(data.insp.id))
      } catch {
        /* ignore */
      }
      invalidateAll()
      navigate('/qc', { replace: true })
    } catch (e) {
      setSubmitError(errText(e))
      setBusy(false)
    }
  }

  const hasMismatch = data.fn.some((c) => c.ok === false) || data.boxes.some((c) => c.ok === false)

  return (
    <div>
      <div className={`no-print mx-auto px-4 lg:px-8 pt-4 max-w-2xl lg:max-w-6xl`}>
        <BackLink to="/qc">QC cases</BackLink>
        <div className="flex items-start justify-between gap-3 mt-1 mb-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight leading-tight break-words">{data.line.product_name}</h1>
            <p className="text-sm text-muted mt-1">
              {data.insp.record_no} · <span className="font-mono">{data.ship.fba_id}</span>
            </p>
          </div>
          <span className="flex gap-1.5 items-center flex-wrap justify-end">
            {data.ship.on_hold && <HoldStamp />}
            <StatusStamp status={data.insp.status} />
          </span>
        </div>

        {data.ship.on_hold && <Notice tone="fail">On hold: {data.ship.hold_reason}. Only Inventory can clear this.</Notice>}
        {scanError && <Notice tone="fail">{scanError}</Notice>}
        {data.insp.needs_recheck && <Notice tone="warn">Shipment quantity changed after QC. Recheck this case.</Notice>}
        {submitErrors.length > 0 && (
          <div role="alert" className="border border-fail/30 bg-fail/5 text-fail rounded-lg px-4 py-3 mb-4 text-sm">
            <b className="font-semibold">Fix before submitting</b>
            <ul className="list-disc pl-5 mt-1">
              {submitErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {data.insp.status === 'Open' ? (
        <QCFillForm
          data={data}
          draft={view}
          readOnly={!editing}
          setDraft={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          qcSign={qcSign}
          setQcSign={setQcSign}
          onScanFn={(c) => setTarget({ kind: 'fn', id: c.id, title: `Scan FNSKU, unit ${c.sample_no} of ${data.fn.length}`, hint: 'FNSKU printed on any unit' })}
          people={people}
        />
      ) : (
        <>
          {/* App-style record on screen; the approved A4 sheet is what prints or saves as PDF. */}
          <RecordView
            data={data}
            draft={view}
          />
          <div className="hidden print:block">
            <RecordSheet data={data} draft={view} />
          </div>
        </>
      )}

      {editing && (
        <div
          className="fixed bottom-0 inset-x-0 lg:left-60 z-30 bg-surface border-t border-line px-4 pt-3 no-print"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-2xl lg:max-w-6xl mx-auto lg:px-4 lg:flex lg:items-center lg:justify-end lg:gap-6">
            {hasMismatch && (
              <p className="text-[13px] text-fail mb-1.5 lg:mb-0 lg:flex-1">A scan mismatched. The shipment stays on hold until Inventory clears it.</p>
            )}
            <button
              type="button"
              onClick={askSubmit}
              className="w-full lg:w-72 min-h-[52px] rounded-lg bg-ink text-white font-medium text-base"
            >
              Save and submit
            </button>
          </div>
        </div>
      )}

      <div className="no-print px-4 lg:px-8 max-w-2xl lg:max-w-6xl mx-auto flex gap-2 flex-wrap pb-8">
        {canReopen && (
          <Btn tone="line" onClick={() => setReopen(true)}>
            Reopen case
          </Btn>
        )}
        {data.insp.status !== 'Open' && (
          <Btn onClick={() => window.print()}>Print or save PDF</Btn>
        )}
      </div>

      {target && (
        <Suspense fallback={null}>
          <BarcodeScanner title={target.title} hint={target.hint} onScan={handleScan} onClose={() => setTarget(null)} />
        </Suspense>
      )}

      {confirmSubmit && (
        <Modal title="Submit QC case" onClose={() => !busy && setConfirmSubmit(false)}>
          <p className="text-sm mb-4">You cannot edit this case after submitting. Only Inventory or the warehouse manager can reopen it.</p>
          {submitError && <ErrorBox message={submitError} />}
          <div className="flex gap-2">
            <Btn tone="line" onClick={() => setConfirmSubmit(false)} disabled={busy}>
              Back
            </Btn>
            <Btn className="flex-1" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit'}
            </Btn>
          </div>
        </Modal>
      )}

      {reopen && (
        <ConfirmModal
          title="Reopen QC case"
          intro="QC will have to fill and sign it again."
          confirmLabel="Reopen"
          onClose={() => setReopen(false)}
          onConfirm={async () => {
            const { error: err } = await supabase.rpc('reopen_inspection', { p_id: data.insp.id })
            if (err) throw err
            invalidateAll()
          }}
        />
      )}
    </div>
  )
}
