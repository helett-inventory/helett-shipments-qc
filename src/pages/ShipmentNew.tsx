import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, errText, callRpc } from '../lib/supabase'
import { fromLocalInput, todayISO } from '../lib/format'
import { SearchableSelect } from '../components/SearchableSelect'
import { DateInput } from '../components/DateInput'
import { BackLink, Btn, Choice, ErrorBox, Field, Page, PageTitle, Panel, inputCls } from '../components/ui'
import type { SkuRow } from '../types/db'
import { getSkus } from '../services/lookups'
import { invalidateAll } from '../lib/cache'
import { DISPATCH_MODES, FULFILMENT_CENTRES, TRANSPORTS, needsAppointment, needsTransport, type DispatchMode } from '../data/options'

interface LineDraft {
  key: number
  product: string
  units: string
  boxes: string
}

export function ShipmentNew() {
  const navigate = useNavigate()
  const [skus, setSkus] = useState<SkuRow[]>([])
  const [fba, setFba] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [mode, setMode] = useState<DispatchMode | ''>('')
  const [dispatchDate, setDispatchDate] = useState(todayISO())
  const [appointment, setAppointment] = useState('')
  const [transport, setTransport] = useState('')
  const [boxes, setBoxes] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, product: '', units: '', boxes: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSkus()
      .then(setSkus)
      .catch((e) => setError(errText(e)))
  }, [])

  // A message about an earlier attempt must not outlive the fix: clear it on any edit.
  useEffect(() => {
    setError(null)
  }, [fba, warehouse, mode, dispatchDate, appointment, transport, boxes, remarks, lines])

  // A field that does not apply to the chosen mode stays in place but is greyed out.
  const transportOn = !mode || needsTransport(mode)
  const appointmentOn = !mode || needsAppointment(mode)

  const byName = useMemo(() => new Map(skus.map((s) => [s.product_name, s])), [skus])
  const sumLineBoxes = lines.reduce((n, l) => n + (parseInt(l.boxes, 10) || 0), 0)

  function setLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!fba.trim()) return setError('Enter the FBA shipment ID.')
    if (!warehouse.trim()) return setError('Choose the Amazon FC.')
    if (!mode) return setError('Choose the mode of dispatch.')
    const totalBoxes = parseInt(boxes, 10)
    if (!totalBoxes || totalBoxes < 1) return setError('Enter the total number of boxes.')
    const payloadLines = []
    for (const l of lines) {
      const sku = byName.get(l.product)
      const units = parseInt(l.units, 10)
      if (!sku) return setError('Choose a product for every SKU line.')
      if (!units || units < 1) return setError(`Enter unit quantity for ${l.product}.`)
      payloadLines.push({ asin: sku.asin, unit_qty: units, box_qty: l.boxes ? parseInt(l.boxes, 10) : null })
    }
    if (new Set(lines.map((l) => l.product)).size !== lines.length) return setError('Each product can appear once. Merge duplicate lines.')

    setBusy(true)
    const { data, error: err } = await callRpc('create_shipment', {
      p: {
        fba_id: fba,
        warehouse,
        dispatch_mode: mode,
        dispatch_date: dispatchDate,
        appointment_at: needsAppointment(mode) ? fromLocalInput(appointment) : null,
        transport: needsTransport(mode) ? transport : '',
        remarks,
        box_qty_total: totalBoxes,
        lines: payloadLines
      }
    })
    setBusy(false)
    if (err) return setError(err.message.includes('duplicate key') ? 'A shipment with this FBA ID already exists.' : errText(err))
    invalidateAll()
    navigate(`/shipments/${data as string}`, { replace: true })
  }

  return (
    <Page>
      <BackLink to="/">Shipments</BackLink>
      <PageTitle title="New shipment" sub="QC cases open automatically for each SKU line." />

      <form onSubmit={submit} className="space-y-5">
        <Panel title="Shipment">
          <Field label="FBA shipment ID">
            <input
              value={fba}
              onChange={(e) => setFba(e.target.value)}
              className={`${inputCls} font-mono uppercase`}
              placeholder="FBA15K7T2QX9"
              autoCapitalize="characters"
            />
          </Field>
          <div className="mb-4">
            <span className="block text-sm font-medium mb-1.5">Mode of dispatch</span>
            <div className="max-w-md">
              <Choice label="Mode of dispatch" options={[...DISPATCH_MODES]} value={mode} onChange={(v) => {
                  setMode(v)
                  if (!needsTransport(v)) setTransport('')
                  if (!needsAppointment(v)) setAppointment('')
                }} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Amazon FC">
              <SearchableSelect options={[...FULFILMENT_CENTRES]} value={warehouse} onChange={setWarehouse} placeholder="Select FC" />
            </Field>
            <Field label="Type of transport" hint={!transportOn ? `Not needed for ${mode}.` : undefined}>
              <SearchableSelect
                options={[...TRANSPORTS]}
                value={transportOn ? transport : ''}
                onChange={setTransport}
                placeholder={transportOn ? 'Select' : 'Not needed'}
                allowClear
                disabled={!transportOn}
              />
            </Field>
            <Field label="Date of dispatch">
              <DateInput value={dispatchDate} onChange={setDispatchDate} />
            </Field>
            <Field label="Appointment date and time" hint={!appointmentOn ? `Not needed for ${mode}.` : undefined}>
              <DateInput value={appointmentOn ? appointment : ''} onChange={setAppointment} withTime disabled={!appointmentOn} />
            </Field>
          </div>
          <Field label="Total boxes in shipment" hint="Used for the box label check and dispatch count.">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={boxes}
              onChange={(e) => setBoxes(e.target.value)}
              className={`${inputCls} max-w-[160px]`}
            />
          </Field>
          <Field label="Remarks">
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={`${inputCls} py-2`} />
          </Field>
        </Panel>

        <Panel
          title="SKU lines"
          action={
            <button
              type="button"
              className="min-h-[44px] text-sm font-medium underline underline-offset-4"
              onClick={() => setLines((p) => [...p, { key: Date.now(), product: '', units: '', boxes: '' }])}
            >
              Add SKU
            </button>
          }
        >
          <div className="space-y-5">
            {lines.map((l, i) => (
              <div key={l.key} className={i > 0 ? 'pt-5 border-t border-line' : ''}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted">Line {i + 1}</span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                      className="min-h-[44px] text-sm text-fail"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <Field label="Product">
                  <SearchableSelect
                    options={skus.map((s) => s.product_name)}
                    value={l.product}
                    onChange={(v) => setLine(l.key, { product: v })}
                    placeholder="Select product"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Unit quantity">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={l.units}
                      onChange={(e) => setLine(l.key, { units: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Boxes for this SKU">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={l.boxes}
                      onChange={(e) => setLine(l.key, { boxes: e.target.value })}
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
          {sumLineBoxes > 0 && boxes && sumLineBoxes !== parseInt(boxes, 10) && (
            <p className="text-sm text-warn mt-3">
              Boxes per SKU add up to {sumLineBoxes}, total says {boxes}. Fine if boxes hold mixed SKUs.
            </p>
          )}
        </Panel>

        {error && <ErrorBox message={error} />}
        <Btn type="submit" disabled={busy} className="w-full sm:w-auto sm:px-8">
          {busy ? 'Creating…' : 'Create shipment'}
        </Btn>
      </form>
    </Page>
  )
}
