import { useMemo } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useLive } from './useLive'
import { supabase } from '../lib/supabase'
import { needsBoxLabels } from '../data/options'

// "Needs you": what is waiting on the logged-in person, by role. In-app only.
// One light query, kept live through the same cache and realtime as the other pages.

type Ship = {
  id: string
  fba_id: string
  warehouse: string
  status: string
  on_hold: boolean
  hold_reason: string | null
  dispatch_mode: string | null
  dispatches: { wm_approved_at: string | null }[]
  box_label_checks: { scanned: string | null }[]
  shipment_lines: { status: string; unit_qty: number; received_qty: number | null }[]
}
type Insp = {
  id: string
  record_no: string
  status: string
  needs_recheck: boolean
  shipment_lines: { status: string; product_name: string; shipments: { on_hold: boolean; fba_id: string } }
}
type Bundle = { ships: Ship[]; insps: Insp[] }

export type NeedKind = 'approve' | 'hold' | 'dispatch' | 'labels' | 'receive' | 'qc' | 'recheck' | 'review'
export interface Need {
  key: string
  kind: NeedKind
  title: string
  sub: string
  to: string
}

export const NEED_LABEL: Record<NeedKind, string> = {
  approve: 'Approve dispatch',
  hold: 'On hold',
  dispatch: 'Ready to dispatch',
  labels: 'Box labels to scan',
  receive: 'Receiving pending',
  qc: 'QC to do',
  recheck: 'Recheck needed',
  review: 'Submitted QC'
}

export function useNeeds() {
  const { profile } = useAuth()
  const { data } = useLive<Bundle>(
    async () => {
      const [s, i] = await Promise.all([
        supabase
          .from('shipments')
          .select('id, fba_id, warehouse, status, on_hold, hold_reason, dispatch_mode, dispatches(wm_approved_at), box_label_checks(scanned), shipment_lines(status, unit_qty, received_qty)')
          .neq('status', 'Cancelled'),
        supabase
          .from('inspections')
          .select('id, record_no, status, needs_recheck, shipment_lines(status, product_name, shipments(on_hold, fba_id))')
          .in('status', ['Open', 'Submitted'])
          .limit(500)
      ])
      if (s.error) throw s.error
      if (i.error) throw i.error
      return { ships: s.data as unknown as Ship[], insps: i.data as unknown as Insp[] }
    },
    ['shipments', 'shipment_lines', 'dispatches', 'inspections', 'box_label_checks'],
    'needs-you'
  )

  return useMemo(() => {
    const all = !!profile?.is_admin
    const role = profile?.role
    const isInv = all || role === 'inventory'
    const isWm = all || role === 'wm'
    const isQc = all || role === 'qc'
    const ships: Need[] = []
    const qc: Need[] = []

    for (const s of data?.ships ?? []) {
      const live = s.shipment_lines.filter((l) => l.status !== 'Cancelled')
      const to = `/shipments/${s.id}`
      const base = { title: s.fba_id, sub: s.warehouse, to }
      if (isWm && s.dispatches.some((d) => !d.wm_approved_at)) ships.push({ ...base, key: `a${s.id}`, kind: 'approve' })
      if (isInv) {
        if (s.on_hold) ships.push({ ...base, key: `h${s.id}`, kind: 'hold', sub: s.hold_reason || s.warehouse })
        const ready = s.status === 'QC Done' || s.status === 'Partially Dispatched'
        const labels = ready && needsBoxLabels(s.dispatch_mode ?? '') && s.box_label_checks.some((c) => !c.scanned)
        if (labels) ships.push({ ...base, key: `l${s.id}`, kind: 'labels' })
        else if (ready && !s.dispatches.some((d) => !d.wm_approved_at)) ships.push({ ...base, key: `d${s.id}`, kind: 'dispatch' })
        if (s.status === 'Closed') {
          const pending = live.reduce((n, l) => n + Math.max(0, l.unit_qty - (l.received_qty ?? 0)), 0)
          if (pending > 0) ships.push({ ...base, key: `r${s.id}`, kind: 'receive', sub: `${pending} units not received` })
        }
      }
    }

    for (const r of data?.insps ?? []) {
      if (r.shipment_lines.status === 'Cancelled') continue
      const base = { title: r.shipment_lines.product_name, sub: `${r.shipment_lines.shipments.fba_id} · ${r.record_no}`, to: `/qc/${r.id}` }
      if (isQc && r.status === 'Open' && !r.shipment_lines.shipments.on_hold) {
        qc.push({ ...base, key: `q${r.id}`, kind: r.needs_recheck ? 'recheck' : 'qc' })
      }
      if (isWm && r.status === 'Submitted') qc.push({ ...base, key: `s${r.id}`, kind: 'review' })
    }

    return { ships, qc, loaded: !!data }
  }, [data, profile])
}
