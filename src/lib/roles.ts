import type { Profile } from '../types/db'

type P = Pick<Profile, 'role' | 'is_admin'> | null | undefined

// Finance / Accounts: sees shipments, dispatches, SKUs, boxes, appointment and type, and keeps the invoice reference.
// Never QC records or warehouse detail. (Admin sees everything, so an admin is never treated as finance.)
export const isFinanceOnly = (p: P) => p?.role === 'finance' && !p.is_admin

// Who may add or change a shipment's IRN / invoice reference.
export const canEditIrn = (p: P) => p?.role === 'finance' || !!p?.is_admin
