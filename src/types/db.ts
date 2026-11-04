export type Role = 'inventory' | 'qc' | 'wm'

export interface Profile {
  id: string
  name: string
  role: Role
  is_admin?: boolean
}

export type ShipmentStatus =
  | 'Created'
  | 'QC In Progress'
  | 'QC Done'
  | 'Partially Dispatched'
  | 'Dispatched'
  | 'Closed'
  | 'Cancelled'

export type LineStatus =
  | 'QC Open'
  | 'QC Submitted'
  | 'Partially Dispatched'
  | 'Dispatched'
  | 'Closed'
  | 'Not Dispatched'
  | 'Cancelled'

export interface Shipment {
  id: string
  ref: string
  fba_id: string
  created_at: string
  dispatch_date: string | null
  warehouse: string
  appointment_at: string | null
  transport: string | null
  remarks: string | null
  box_qty_total: number
  dispatch_mode: 'ATS' | 'Drop In' | 'Bluedart' | null
  status: ShipmentStatus
  on_hold: boolean
  hold_reason: string | null
}

export interface Inspection {
  id: string
  line_id: string
  record_no: string
  status: 'Open' | 'Submitted' | 'Closed'
  inspection_date: string | null
  model_dispatched: string | null
  checks: Record<string, { r: 'ok' | 'no' | 'na'; n?: string }>
  inspected_qty: number
  accepted_qty: number
  rejected_qty: number
  product_condition: string | null
  packaging_quality: string | null
  overall_result: string | null
  qc_remarks: string | null
  inspector_name: string | null
  qc_sign_path: string | null
  submitted_at: string | null
  needs_recheck: boolean
  manual?: boolean
  manual_by?: string | null
}

export interface ShipmentLine {
  id: string
  shipment_id: string
  asin: string
  product_name: string
  unit_qty: number
  box_qty: number | null
  status: LineStatus
}

export interface FnskuCheck {
  id: string
  inspection_id: string
  sample_no: number
  unit_no: number | null
  scanned: string | null
  ok: boolean | null
  scanned_at: string | null
}

export interface BoxCheck {
  id: string
  shipment_id: string
  sample_no: number
  box_no: number | null
  scanned: string | null
  ok: boolean | null
  reason: string | null
  scanned_at: string | null
}

export interface DispatchLine {
  id: string
  dispatch_id: string
  line_id: string
  units: number
}

export interface Dispatch {
  id: string
  shipment_id: string
  dispatched_at: string
  dispatched_by_name: string | null
  transport: string | null
  boxes_sent: number
  remarks: string | null
  dispatch_sign_path: string | null
  wm_approved_at: string | null
  wm_name: string | null
  wm_sign_path: string | null
  dispatch_lines?: DispatchLine[]
}

export interface AuditRow {
  id: number
  at: string
  user_name: string | null
  entity: string
  entity_id: string | null
  action: string
  old_data: unknown
  new_data: unknown
}

export interface SkuRow {
  asin: string
  product_name: string
  sku: string | null
  fnsku: string | null
}
