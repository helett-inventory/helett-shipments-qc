import { useState } from 'react'
import { Tip } from './ui'
import { getSkus } from '../services/lookups'
import type { Shipment, ShipmentLine } from '../types/db'

const cell = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').replace(/"/g, "'").trim()

type Source = Pick<Shipment, 'fba_id' | 'warehouse' | 'irn'> & {
  shipment_lines: Pick<ShipmentLine, 'asin' | 'unit_qty' | 'box_qty' | 'status'>[]
}

// Tab-separated rows (one per SKU line) that paste straight into a spreadsheet, for the accounts team's invoice.
// With several shipments, a blank row separates one FBA ID from the next. Cancelled lines are left out.
export function CopyInvoiceData({ shipments, label = 'Copy invoice data' }: { shipments: Source[]; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  async function copy() {
    setState('busy')
    try {
      const skus = await getSkus()
      const groups = shipments.map((s) =>
        s.shipment_lines
          .filter((l) => l.status !== 'Cancelled')
          .map((l) => {
            const m = skus.find((x) => x.asin?.trim().toUpperCase() === l.asin?.trim().toUpperCase())
            return [s.fba_id, s.warehouse, l.asin, m?.sku ?? '', m?.fnsku ?? '', l.box_qty ?? '', l.unit_qty, s.irn ?? ''].map(cell)
          })
      )
      const rows = [
        ['FBA number', 'Destination FC', 'ASIN', 'SKU', 'FNSKU', 'Box qty', 'Qty', 'IRN'],
        ...groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? g : [[], ...g]))
      ]
      const text = rows.map((r) => r.join('\t')).join('\n')
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('copy failed')
      }
      setState('done')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2200)
  }
  return (
    <Tip label="Copies FBA number, destination FC, ASIN, SKU, FNSKU, box qty, qty and IRN for every SKU, tab separated, ready to paste into a spreadsheet">
      <button
        type="button"
        onClick={copy}
        disabled={state === 'busy'}
        className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] font-semibold ${
          state === 'done' ? 'bg-[#d8f2e0] text-[#0f6b32]' : state === 'failed' ? 'bg-[#fde8e6] text-fail' : 'bg-[#eceef1] text-ink hover:bg-[#e1e4e8]'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {state === 'done' ? (
            <path d="M5 12.5 10 17.5 19 7" />
          ) : (
            <>
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a2 2 0 0 1 2-2h9" />
            </>
          )}
        </svg>
        {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </button>
    </Tip>
  )
}
