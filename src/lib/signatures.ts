import { supabase } from './supabase'

const BUCKET = 'signatures'

// crypto.randomUUID only exists on HTTPS pages; a phone opening the app over
// plain http (LAN, dev) would crash. getRandomValues works everywhere.
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function uploadSignature(dataUrl: string, folder: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const path = `${folder}/${uuid()}.png`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png' })
  if (error) throw error
  return path
}

const cache = new Map<string, { url: string; expires: number }>()

export async function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit && hit.expires > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) return null
  cache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}
