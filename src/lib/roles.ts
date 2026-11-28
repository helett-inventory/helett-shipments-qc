import type { Profile } from '../types/db'

type P = Pick<Profile, 'role' | 'is_admin'> | null | undefined

// Finance / Accounts: sees shipments, dispatches, SKUs, boxes, appointment and type, and keeps the invoice reference.
// Never QC records or warehouse detail. (Admin sees everything, so an admin is never treated as finance.)
export const isFinanceOnly = (p: P) => p?.role === 'finance' && !p.is_admin

// Finance and Marketplace are view-only: they get Calendar and Shipments, never QC, the dashboard or warehouse detail.
export const isViewOnly = (p: P) => (p?.role === 'finance' || p?.role === 'marketplace') && !p.is_admin

// The dashboard is not for QC (QC does inspections only) or the view-only roles. Admin always sees it.
export const canSeeDashboard = (p: P) => !isViewOnly(p) && (p?.role !== 'qc' || !!p.is_admin)

// Who may add or change a shipment's IRN / invoice reference.
export const canEditIrn = (p: P) => p?.role === 'finance' || !!p?.is_admin
