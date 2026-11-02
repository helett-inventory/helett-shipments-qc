// Fixed choices for shipment forms. Change them here and in supabase/schema.sql (dispatch_mode check).
export const DISPATCH_MODES = ['ATS', 'Drop In', 'Bluedart'] as const
export type DispatchMode = (typeof DISPATCH_MODES)[number]

export const TRANSPORTS = ['Own vehicle', 'Other'] as const

// Amazon fulfilment centres (FC). Name only, without the state suffix.
export const FULFILMENT_CENTRES = [
  'AMD2',
  'BLR4',
  'BLR5',
  'BLR7',
  'BLR8',
  'BOM5',
  'BOM7',
  'CCX1',
  'CCX2',
  'CJB1',
  'COX1',
  'DED1',
  'DED4',
  'DEL4',
  'DEL5',
  'DEL8',
  'DEX3',
  'DEX8',
  'HYD3',
  'HYD8',
  'JPX1',
  'JPX2',
  'LKO1',
  'MAA4',
  'PAX1',
  'PNQ2',
  'PNQ3',
  'SBLL'
] as const

// With these modes Amazon (ATS) or the courier (Bluedart) collects the shipment, so there is no transport to choose.
export const NO_TRANSPORT_MODES: readonly string[] = ['ATS', 'Bluedart']
export const needsTransport = (mode: string) => !NO_TRANSPORT_MODES.includes(mode)

// ATS is booked by Amazon, so there is no appointment time to enter.
export const NO_APPOINTMENT_MODES: readonly string[] = ['ATS']
export const needsAppointment = (mode: string) => !NO_APPOINTMENT_MODES.includes(mode)

// ATS is collected by Amazon: the dispatch team does not paste or scan carton labels.
export const NO_BOX_LABEL_MODES: readonly string[] = ['ATS']
export const needsBoxLabels = (mode: string) => !NO_BOX_LABEL_MODES.includes(mode)
