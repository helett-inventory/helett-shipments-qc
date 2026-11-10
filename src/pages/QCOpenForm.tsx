import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CHECK_SECTIONS } from '../data/checklist'
import { printAs } from '../lib/printName'
import { Btn } from '../components/ui'
import { Box, MANAGER_NAME, Qr } from './QCFormPrint'
import '../report.css'

// A one-page QC checklist that is not tied to any shipment, for stock inspected outside the app.
// Each sheet carries its own code (and a QR of it). QC writes that code in the serial sheet,
// and the serial sheet's ref number on the paper, so the two can always be matched.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L: easy to read and copy by hand

// Short on purpose: DDMMYY, then 4 characters (about 920,000 combinations per day).
// Two forms printed on the same day would have to draw the same 4 characters to clash.
function makeCode(): string {
  const d = new Date()
  const dm = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(2)}`
  const r = new Uint32Array(4)
  crypto.getRandomValues(r)
  return `${dm}-${[...r].map((n) => ALPHABET[n % ALPHABET.length]).join('')}`
}

const makeCodes = (n: number) => {
  const set = new Set<string>()
  while (set.size < n) set.add(makeCode())
  return [...set]
}

function Sheet({ code }: { code: string }) {
  return (
    <section className="sheet openform">
      <header className="head">
        <div>
          <div className="brand">Helett Enterprises</div>
          <div className="doctype">Quality Inspection Form · Stock check</div>
        </div>
        <div className="ref qrref">
          <div>
            Form code
            <b className="mono code">{code}</b>
          </div>
          <Qr value={code} />
        </div>
      </header>

      <div className="keyband">
        <div>
          <small>Serial sheet ref no.</small>
          <b className="blank" style={{ height: '6mm' }} />
        </div>
        <div>
          <small>Inspection date</small>
          <b className="blank" style={{ height: '6mm' }} />
        </div>
      </div>

      <dl className="facts" style={{ margin: 0, gridTemplateColumns: '1fr 1fr' }}>
        <div className="wide"><dt>Product name</dt><dd className="blank" /></div>
        <div><dt>Batch / PO no.</dt><dd className="blank" /></div>
        <div><dt>Inspector</dt><dd className="blank" /></div>
      </dl>

      <div className="figs" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {['Units in lot', 'Units checked', 'Passed', 'Failed', 'Fail rate %'].map((l) => (
          <div key={l}>
            <div className="n blank" style={{ height: '6mm' }} />
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      <h2>1. Inspection findings</h2>
      <table className="tight">
        <colgroup>
          <col style={{ width: '9mm' }} />
          <col style={{ width: '82mm' }} />
          <col style={{ width: '11mm' }} />
          <col style={{ width: '11mm' }} />
          <col style={{ width: '11mm' }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Ref</th>
            <th>Inspection point</th>
            <th style={{ textAlign: 'center' }}>OK</th>
            <th style={{ textAlign: 'center' }}>Not OK</th>
            <th style={{ textAlign: 'center' }}>N/A</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {CHECK_SECTIONS.map((sec) => (
            <FindingRows key={sec.id} title={sec.title.charAt(0) + sec.title.slice(1).toLowerCase()} items={sec.items} />
          ))}
        </tbody>
      </table>

      <h2>2. Result</h2>
      <dl className="dispo" style={{ margin: 0, gridTemplateColumns: '1.8fr 1fr 1fr' }}>
        <div>
          <dt>Overall result</dt>
          <dd>
            <Box /> Good &nbsp;&nbsp;&nbsp;&nbsp; <Box /> Satisfactory &nbsp;&nbsp;&nbsp;&nbsp; <Box /> Bad
          </dd>
        </div>
        <div>
          <dt>Product condition</dt>
          <dd>
            <Box /> Good &nbsp;&nbsp;&nbsp;&nbsp; <Box /> Bad
          </dd>
        </div>
        <div>
          <dt>Packaging quality</dt>
          <dd>
            <Box /> Good &nbsp;&nbsp;&nbsp;&nbsp; <Box /> Bad
          </dd>
        </div>
      </dl>
      <div className="remarks" style={{ minHeight: '16mm' }}>
        <small>QC remarks</small>
      </div>

      <h2>3. Authorisation</h2>
      <div className="auth" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 0 }}>
        {['Quality control', 'Manager'].map((r) => (
          <div key={r}>
            <div className="box" style={{ height: '17mm' }} />
            <div className="role">{r}: signature</div>
            <div className="signrow">
              <div>
                <div className="blank" style={{ height: '7mm', display: 'flex', alignItems: 'flex-end', fontWeight: 600, fontSize: '10pt', paddingBottom: '0.6mm' }}>
                  {r === 'Manager' ? MANAGER_NAME : ''}
                </div>
                <div className="when">Name</div>
              </div>
              <div>
                <div className="blank" style={{ height: '6mm' }} />
                <div className="when">Date and time</div>
              </div>
            </div>
          </div>
        ))}
      </div>

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

export function QCOpenForm() {
  const [count, setCount] = useState(1)
  const [seed, setSeed] = useState(0) // a new seed = a fresh set of codes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const codes = useMemo(() => makeCodes(count), [count, seed])

  return (
    <div>
      <div className="no-print sticky top-14 lg:top-0 z-20 bg-canvas">
        <div className="mx-auto px-4 lg:px-6 pt-4 pb-3 max-w-[1100px] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">QC checklist, no shipment</h1>
            <p className="text-sm text-muted">
              One A4 page per code. Print it, fill it in by hand, and write the same code in your serial sheet.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-muted">
              Copies
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="min-h-[44px] px-3 rounded-lg bg-surface ring-1 ring-[#cfd4da] text-ink"
              >
                {[1, 2, 3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setSeed((s) => s + 1)} className="min-h-[44px] px-4 rounded-lg bg-[#eceef1] hover:bg-[#e1e4e8] font-medium">
              New codes
            </button>
            <Link to="/qc" className="min-h-[44px] px-4 rounded-lg bg-[#eceef1] hover:bg-[#e1e4e8] font-medium flex items-center">
              Back
            </Link>
            <Btn onClick={() => printAs('QC-Checklist', codes[0])}>Print or save PDF</Btn>
          </div>
        </div>
      </div>
      <div className="qcform-preview overflow-x-auto px-4 lg:px-6 pb-10 print:overflow-visible print:p-0">
        <div className="rpt qcform-sheets">
          {codes.map((c) => (
            <div key={c} className="contents">
              <Sheet code={c} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
