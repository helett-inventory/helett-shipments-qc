// One-time migration: old Google Sheet (via the existing Apps Script web app)
// -> Supabase. Signatures are re-uploaded to the private `signatures` bucket.
//
//   OLD_API_URL=...  SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...  node scripts/migrate-from-sheet.mjs            (dry run)
//   ... node scripts/migrate-from-sheet.mjs --commit                                                           (writes)
//
// The service-role key bypasses RLS. Use it only here, then rotate it. Never
// put it in .env that the app build reads (the app only uses VITE_* vars).

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const { OLD_API_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
const commit = process.argv.includes('--commit')
if (!OLD_API_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set OLD_API_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY.')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = { shipments: 0, lines: 0, signatures: 0, sigFailed: [], skipped: [] }

async function fetchOld() {
  const res = await fetch(OLD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'list' })
  })
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error('Unexpected response: ' + JSON.stringify(json).slice(0, 200))
  return json
}

async function toBytes(value) {
  if (!value) return null
  if (value.startsWith('data:')) {
    const [, b64] = value.split(',')
    return Buffer.from(b64, 'base64')
  }
  if (/^https?:/.test(value)) {
    const r = await fetch(value)
    if (!r.ok) return null
    return Buffer.from(await r.arrayBuffer())
  }
  return null
}

async function uploadSig(value, folder, ctx) {
  try {
    const bytes = await toBytes(value)
    if (!bytes) return null
    const path = `${folder}/${randomUUID()}.png`
    if (commit) {
      const { error } = await db.storage.from('signatures').upload(path, bytes, { contentType: 'image/png' })
      if (error) throw error
    }
    log.signatures++
    return path
  } catch (e) {
    log.sigFailed.push(`${ctx}: ${e.message}`)
    return null
  }
}

// Old Y/N fields -> new numbered checklist (see src/data/checklist.ts).
const LEGACY_ITEM = {
  fnskuPresent: 4,
  labelBarcode: 5,
  mrpPresent: 6,
  serialNumberPresent: 7,
  shippingLabelPresent: 8,
  properSealing: 11,
  accessoriesIncluded: 12
}

function legacyChecks(r) {
  const checks = {}
  for (let n = 1; n <= 12; n++) checks[String(n)] = { r: 'na' }
  for (const [field, no] of Object.entries(LEGACY_ITEM)) {
    if (r[field] === 'Y') checks[String(no)] = { r: 'ok' }
    else if (r[field] === 'N') checks[String(no)] = { r: 'no', n: 'Marked No in old app' }
  }
  checks['9'] = { r: r.productCondition === 'Bad' ? 'no' : r.productCondition === 'Good' ? 'ok' : 'na', n: r.productCondition === 'Bad' ? 'Marked Bad in old app' : undefined }
  checks['10'] = { r: r.packagingQuality === 'Bad' ? 'no' : r.packagingQuality === 'Good' ? 'ok' : 'na', n: r.packagingQuality === 'Bad' ? 'Marked Bad in old app' : undefined }
  return checks
}

const num = (v) => Math.max(0, parseInt(v, 10) || 0)

async function main() {
  const rows = await fetchOld()
  console.log(`Old sheet: ${rows.length} inspections. Mode: ${commit ? 'COMMIT' : 'dry run'}`)

  const { data: skus, error } = await db.from('sku_map').select('asin, product_name')
  if (error) throw error
  const byAsin = new Map(skus.map((s) => [s.asin, s.product_name]))

  const groups = new Map()
  for (const r of rows) {
    const key = (r.shipmentId || '').trim().toUpperCase()
    if (!key) {
      log.skipped.push(`${r.id}: no shipment ID`)
      continue
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  for (const [fba, items] of groups) {
    const first = items[0]
    const totalBoxes = Math.max(1, items.reduce((n, r) => n + num(r.qcQty), 0))
    let shipId = randomUUID()
    if (commit) {
      const { data, error } = await db
        .from('shipments')
        .insert({
          fba_id: fba,
          warehouse: 'Unknown (migrated)',
          dispatch_date: first.dispatchDate || null,
          box_qty_total: totalBoxes,
          remarks: 'Migrated from Google Sheet',
          dispatch_mode: ['ATS', 'Drop In'].includes(first.modelDispatched) ? first.modelDispatched : null,
          created_at: first.timestamp || undefined
        })
        .select('id')
        .single()
      if (error) {
        log.skipped.push(`${fba}: ${error.message}`)
        continue
      }
      shipId = data.id
    }
    log.shipments++

    for (const r of items) {
      const asin = (r.sku || '').trim()
      const productName = byAsin.get(asin) || r.productName
      if (!byAsin.has(asin)) {
        log.skipped.push(`${r.id}: ASIN "${asin}" is not in sku_map (add it, then rerun)`)
        continue
      }
      const closed = r.status === 'Closed'
      const qcDone = closed || !!r.qcSignatureUrl
      const dispatched = closed || !!r.dispatchSignUrl
      const units = Math.max(1, num(r.receivedQty))
      const accepted = num(r.acceptedQty)

      const qcSign = await uploadSig(r.qcSignatureUrl, 'qc', r.id)
      const dispSign = await uploadSig(r.dispatchSignUrl, 'dispatch', r.id)
      const finalSign = await uploadSig(r.signatureUrl, 'final', r.id)

      const lineStatus = closed ? 'Closed' : dispatched ? 'Dispatched' : qcDone ? 'QC Submitted' : 'QC Open'
      const inspStatus = closed ? 'Closed' : qcDone ? 'Submitted' : 'Open'
      log.lines++
      if (!commit) continue

      const { data: line, error: e1 } = await db
        .from('shipment_lines')
        .insert({ shipment_id: shipId, asin, product_name: productName, unit_qty: units, box_qty: num(r.qcQty) || null, status: lineStatus })
        .select('id')
        .single()
      if (e1) {
        log.skipped.push(`${r.id}: ${e1.message}`)
        continue
      }
      const { error: e2 } = await db.from('inspections').insert({
        line_id: line.id,
        status: inspStatus,
        inspection_date: r.inspectionDate || null,
        checks: legacyChecks(r),
        inspected_qty: units,
        accepted_qty: accepted,
        rejected_qty: num(r.rejectedQty),
        product_condition: r.productCondition || null,
        packaging_quality: r.packagingQuality || null,
        overall_result: r.overallResult || null,
        qc_remarks: [r.fullRemarks, r.qcRemarks].filter(Boolean).join('\n') || null,
        inspector_name: r.inspectorName || null,
        qc_sign_path: qcSign,
        submitted_at: qcDone ? r.updatedAt || r.timestamp || null : null
      })
      if (e2) log.skipped.push(`${r.id}: inspection ${e2.message}`)

      if (dispatched && accepted > 0) {
        const { data: disp, error: e3 } = await db
          .from('dispatches')
          .insert({
            shipment_id: shipId,
            dispatched_at: r.dispatchDate ? new Date(r.dispatchDate).toISOString() : new Date().toISOString(),
            dispatched_by_name: r.dispatchConfirmedBy || null,
            boxes_sent: num(r.qcQty),
            dispatch_sign_path: dispSign,
            wm_approved_at: closed ? (r.dispatchDate ? new Date(r.dispatchDate).toISOString() : new Date().toISOString()) : null,
            wm_name: closed ? r.finalConfirmationBy || null : null,
            wm_sign_path: closed ? finalSign : null
          })
          .select('id')
          .single()
        if (e3) log.skipped.push(`${r.id}: dispatch ${e3.message}`)
        else await db.from('dispatch_lines').insert({ dispatch_id: disp.id, line_id: line.id, units: accepted })
      }
    }
    if (commit) await db.rpc('refresh_shipment', { p_ship: shipId })
  }

  console.log(JSON.stringify({ ...log, sigFailed: log.sigFailed.length, skippedCount: log.skipped.length }, null, 2))
  if (log.sigFailed.length) console.log('Signature failures:\n' + log.sigFailed.join('\n'))
  if (log.skipped.length) console.log('Skipped:\n' + log.skipped.join('\n'))
  if (!commit) console.log('Dry run only. Nothing was written. Add --commit to write.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
