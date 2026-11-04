// The QR on the printed QC form carries the SKU line it belongs to. Scanning it in the app
// links the paper to the right line before the checked and failed counts are entered.
const PREFIX = 'HQC:'

export const qrPayload = (lineId: string) => `${PREFIX}${lineId}`

export function lineFromQr(code: string): string | null {
  const t = code.trim()
  return t.toUpperCase().startsWith(PREFIX) ? t.slice(PREFIX.length).toLowerCase() : null
}
