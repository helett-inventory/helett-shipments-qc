import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtDateTime } from '../lib/format'
import { CHECK_SECTIONS } from '../data/checklist'
import { printAs } from '../lib/printName'
import { qrPayload } from '../lib/manualQc'
import { Btn, ErrorBox, Loading } from '../components/ui'
import type { Shipment, ShipmentLine } from '../types/db'
import '../report.css'

type Bundle = Shipment & { shipment_lines: ShipmentLine[] }

export function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 0, width: 240, errorCorrectionLevel: 'M' }).then(setSrc, () => setSrc(''))
  }, [value])
  return src ? <img src={src} alt="QR code that links this paper to the app" className="qr" /> : <div className="qr" />
}

export const Box = () => <span className="tick" />

function Head({ line, ship, sub }: { line: ShipmentLine; ship: Shipment; sub: string }) {
  return (
    <header className="head">
      <div>
        <div className="brand">Helett Enterprises</div>
        <div className="doctype">{sub}</div>
      </div>
      <div className="ref qrref">
        <div>
          Shipment
          <b className="mono">{ship.fba_id}</b>
          {line.product_name}
        </div>
        <Qr value={qrPayload(line.id)} />
      </div>
    </header>
  )
}

// Blank A4 QC form for one SKU line: the shipment details are filled in, everything QC records is left for pen.
function LineForm({ ship, line, page }: { ship: Shipment; line: ShipmentLine; page: 'one' | 'two' }) {
  const foot = (n: number) => (
    <div className="foot">
      <span>Helett Enterprises · Quality Inspection Form · {ship.fba_id} · scan the QR once QC is done</span>
      <span>Page {n} of 2</span>
    </div>
  )

  if (page === 'one') {
    return (
      <section className="sheet">
        <Head line={line} ship={ship} sub="Quality Inspection Form · Outbound shipment" />
        <div className="title">
          <div>
            <h1>{line.product_name}</h1>
            <div className="sub">
              FBA shipment <span className="mono">{ship.fba_id}</span> · {ship.warehouse}
            </div>
          </div>
        </div>

        <dl className="facts" style={{ margin: 0 }}>
          <div><dt>FBA shipment ID</dt><dd className="mono">{ship.fba_id}</dd></div>
          <div><dt>ASIN</dt><dd className="mono">{line.asin}</dd></div>
          <div><dt>Mode of dispatch</dt><dd>{ship.dispatch_mode ?? '—'}</dd></div>
          <div><dt>Warehouse</dt><dd>{ship.warehouse}</dd></div>
          <div><dt>Dispatch date</dt><dd>{ship.dispatch_date ? fmtDate(ship.dispatch_date) : '—'}</dd></div>
          <div><dt>Appointment</dt><dd>{ship.appointment_at ? fmtDateTime(ship.appointment_at) : '—'}</dd></div>
          <div><dt>Units ordered</dt><dd>{line.unit_qty}</dd></div>
          <div><dt>Boxes (this SKU)</dt><dd>{line.box_qty ?? '—'}</dd></div>
          <div><dt>Inspection date</dt><dd className="blank" /></div>
        </dl>

        <div className="figs">
          {['Units checked', 'Passed', 'Failed', 'Inspector'].map((l) => (
            <div key={l}>
              <div className="n blank" style={{ height: '8mm' }} />
              <div className="l">{l}</div>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: '7mm' }}>1. Inspection findings</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: '9mm' }}>Ref</th>
              <th>Inspection point</th>
              <th style={{ width: '12mm', textAlign: 'center' }}>OK</th>
              <th style={{ width: '12mm', textAlign: 'center' }}>Not OK</th>
              <th style={{ width: '12mm', textAlign: 'center' }}>N/A</th>
              <th style={{ width: '42mm' }}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {CHECK_SECTIONS.map((sec) => (
              <FindingRows key={sec.id} title={sec.title.charAt(0) + sec.title.slice(1).toLowerCase()} items={sec.items} />
            ))}
          </tbody>
        </table>
        {foot(1)}
      </section>
    )
  }

  const slots = [1, 2, 3]
  return (
    <section className="sheet">
      <Head line={line} ship={ship} sub={`Quality Inspection Form · ${line.product_name}`} />

      <h2 style={{ marginTop: '6mm' }}>
        2. Label verification <span>Write what you see on the unit</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: '14mm' }}>Sample</th>
            <th>FNSKU printed on the unit</th>
            <th style={{ width: '14mm', textAlign: 'center' }}>Match</th>
            <th style={{ width: '14mm', textAlign: 'center' }}>No match</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((n) => (
            <tr key={n}>
              <td className="ref-no">{n}</td>
              <td className="blank-cell" />
              <td style={{ textAlign: 'center' }}>
                <Box />
              </td>
              <td style={{ textAlign: 'center' }}>
                <Box />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>3. Disposition</h2>
      <dl className="dispo" style={{ margin: 0 }}>
        <div>
          <dt>Overall result</dt>
          <dd>
            <Box /> Good &nbsp; <Box /> Satisfactory &nbsp; <Box /> Bad
          </dd>
        </div>
        <div>
          <dt>Product condition</dt>
          <dd>
            <Box /> Good &nbsp; <Box /> Bad
          </dd>
        </div>
        <div>
          <dt>Packaging quality</dt>
          <dd>
            <Box /> Good &nbsp; <Box /> Bad
          </dd>
        </div>
      </dl>
      <div className="remarks" style={{ minHeight: '24mm' }}>
        <small>QC remarks</small>
      </div>

      <h2>4. Authorisation</h2>
      <div className="auth" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {['Quality control', 'Manager'].map((r) => (
          <div key={r}>
            <div className="box" style={{ height: '18mm' }} />
            <div className="role">{r}: signature</div>
            <div className="signrow">
              <div>
                <div className="blank" style={{ height: '7mm' }} />
                <div className="when">Name</div>
              </div>
              <div>
                <div className="blank" style={{ height: '7mm' }} />
                <div className="when">Date and time</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {foot(2)}
    </section>
  )
}

function FindingRows({ title, items }: { title: string; items: { no: number; text: string }[] }) {
  return (
    <>
      <tr className="group">
        <td colSpan={6}>{title}</td>
      </tr>
      {items.map((it) => (
        <tr key={it.no}>
          <td className="ref-no">{it.no}</td>
          <td>{it.text}</td>
          {[0, 1, 2].map((k) => (
            <td key={k} style={{ textAlign: 'center' }}>
              <Box />
            </td>
          ))}
          <td className="blank-cell" />
        </tr>
      ))}
    </>
  )
}

export function QCFormPrint() {
  const { id } = useParams()
  const { data, error, loading } = useLive<Bundle | null>(
    async () => {
      const { data, error } = await supabase.from('shipments').select('*, shipment_lines(*)').eq('id', id!).maybeSingle()
      if (error) throw error
      return data as unknown as Bundle | null
    },
    ['shipments', 'shipment_lines'],
    `qc-form-${id}`
  )

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox message={error} />
  if (!data) return null
  const lines = data.shipment_lines.filter((l) => l.status !== 'Cancelled')

  return (
    <div>
      <div className="no-print sticky top-14 lg:top-0 z-20 bg-canvas"><div className="mx-auto px-4 lg:px-6 pt-4 pb-3 max-w-[1100px] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">QC form</h1>
          <p className="text-sm text-muted">
            {lines.length} SKU line{lines.length === 1 ? '' : 's'}, 2 pages each. Print it, fill it in by hand, then scan its QR code under “Mark QC done”.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/shipments/${data.id}`} className="min-h-[44px] px-4 rounded-lg bg-[#eceef1] hover:bg-[#e1e4e8] font-medium flex items-center">
            Back
          </Link>
          <Btn onClick={() => printAs(data.fba_id, 'QC-Form')}>Print or save PDF</Btn>
        </div>
      </div>
      </div>
      <div className="qcform-preview overflow-x-auto px-4 lg:px-6 pb-10 print:overflow-visible print:p-0">
        <div className="rpt qcform-sheets">
          {lines.map((l) => (
            <div key={l.id} className="contents">
              <LineForm ship={data} line={l} page="one" />
              <LineForm ship={data} line={l} page="two" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
