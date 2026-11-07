import { useEffect, useRef, useState } from 'react'
import type { IScannerControls } from '@zxing/browser'

interface BarcodeScannerProps {
  onScan: (value: string) => void
  onClose: () => void
  title?: string
  // What to enter in the type-or-scan field, e.g. "FNSKU printed on the unit".
  hint?: string
}

type Mode = 'camera' | 'manual'

// Touch devices open on the camera; laptops and desktops open on the text
// field, where a keyboard or a USB / Bluetooth handheld scanner (which types
// the code and presses Enter) works straight away.
function defaultMode(): Mode {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'camera' : 'manual'
  } catch {
    return 'manual'
  }
}

// Imported via React.lazy() in QCRecord, and @zxing/browser is imported
// dynamically only when the camera tab is used, so none of this loads until
// someone taps Scan.
export default function BarcodeScanner({ onScan: onScanProp, onClose, title, hint }: BarcodeScannerProps) {
  const onScanRef = useRef(onScanProp)
  onScanRef.current = onScanProp

  const [mode, setMode] = useState<Mode>(defaultMode)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [code, setCode] = useState('')
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // camera
  useEffect(() => {
    if (mode !== 'camera') return
    let cancelled = false
    let controls: IScannerControls | null = null
    setError(null)
    setStarting(true)

    async function start() {
      try {
        // getUserMedia only exists in a secure context (HTTPS or localhost).
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setError(
            window.isSecureContext
              ? 'Camera access is not supported in this browser.'
              : 'Camera needs a secure (https://) connection. Use Type or scan instead.'
          )
          return
        }
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
        if (cancelled) return
        // Labels here are linear barcodes (FNSKU, carton IDs) and the odd QR: only look for those, and try hard, so a decode is quick.
        const hints = new Map<number, unknown>([
          [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.ITF, BarcodeFormat.QR_CODE]],
          [DecodeHintType.TRY_HARDER, true]
        ])
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 50 })
        // Rear camera, as sharp as it will go, refocusing on its own: barcodes are small and thin, so resolution and focus decide the speed.
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ advanced: [{ focusMode: 'continuous' }] } as any)
          }
        }
        const c = await reader.decodeFromConstraints(constraints, videoRef.current!, (result) => {
          // Fires repeatedly with "not found" while nothing is in view; only a result matters.
          if (result) {
            try {
              navigator.vibrate?.(60)
            } catch {
              /* not supported */
            }
            onScanRef.current(result.getText())
          }
        })
        if (cancelled) {
          c.stop()
          return
        }
        controls = c
        setStarting(false)
        const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (track && (track.getCapabilities?.() as any)?.torch) setTorch({ track, on: false })
      } catch (err) {
        if (cancelled) return
        const name = err instanceof Error ? err.name : ''
        if (name === 'NotAllowedError') setError('Camera permission was denied. Allow it in your browser settings, or use Type or scan.')
        else if (name === 'NotFoundError') setError('No camera found on this device. Use Type or scan.')
        else setError(`Could not start the camera (${name || 'error'}). Use Type or scan.`)
      }
    }
    start()
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [mode])

  // manual: focus so a handheld scanner can type straight in
  useEffect(() => {
    if (mode === 'manual') inputRef.current?.focus()
  }, [mode])

  async function toggleTorch() {
    if (!torch) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as any] })
      setTorch({ track: torch.track, on: !torch.on })
    } catch {
      /* torch not available right now */
    }
  }

  // Tap the picture to ask the camera to refocus there.
  async function refocus() {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] })
    } catch {
      /* focus control not supported */
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = code.trim()
    if (v) onScanRef.current(v)
  }

  const tab = (m: Mode) =>
    `flex-1 min-h-[44px] rounded-lg text-[15px] font-medium ${mode === m ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={title ?? 'Scan'}>
      <div className="bg-surface w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="font-semibold text-lg">{title ?? 'Scan'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 w-11 h-11 text-2xl leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>

        <div className="p-5">
          <div className="flex gap-1 p-1 bg-canvas rounded-xl mb-4" role="tablist" aria-label="How to enter the code">
            <button type="button" role="tab" aria-selected={mode === 'camera'} onClick={() => setMode('camera')} className={tab('camera')}>
              Camera
            </button>
            <button type="button" role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')} className={tab('manual')}>
              Type or scan
            </button>
          </div>

          {mode === 'camera' ? (
            error ? (
              <div className="rounded-lg bg-[#f6f7f8] p-4 text-sm">
                <p className="mb-3">{error}</p>
                <button type="button" onClick={() => setMode('manual')} className="min-h-[44px] px-4 rounded-lg bg-ink text-white font-medium">
                  Type or scan instead
                </button>
              </div>
            ) : (
              <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3] sm:aspect-[16/10]" onClick={refocus}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                {/* A wide frame, because barcodes are long and thin: line the label up inside it and it reads. */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="relative w-[92%] h-[42%] rounded-xl shadow-[0_0_0_999px_rgba(0,0,0,0.5)]">
                    <span className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-white rounded-tl-xl" />
                    <span className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-white rounded-tr-xl" />
                    <span className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-white rounded-bl-xl" />
                    <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-white rounded-br-xl" />
                    <span className="scanline absolute inset-x-3 h-0.5 bg-[#ff4d3d]/80" />
                  </div>
                </div>
                {torch && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleTorch()
                    }}
                    aria-pressed={torch.on}
                    className={`absolute top-3 right-3 h-10 px-4 rounded-full text-sm font-semibold ${torch.on ? 'bg-white text-ink' : 'bg-black/55 text-white'}`}
                  >
                    {torch.on ? 'Light on' : 'Light'}
                  </button>
                )}
                {!starting && <p className="absolute bottom-3 inset-x-0 text-center text-white/90 text-[13px] pointer-events-none">Hold the barcode flat inside the frame. Tap to refocus.</p>}
                {starting && (
                  <div className="absolute bottom-3 inset-x-0 text-center">
                    <span className="text-white text-sm bg-black/60 px-3 py-1.5 rounded-full">Starting camera…</span>
                  </div>
                )}
              </div>
            )
          ) : (
            <form onSubmit={submit}>
              <label className="block text-sm font-medium mb-1.5" htmlFor="manual-code">
                {hint ?? 'Code'}
              </label>
              <input
                id="manual-code"
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="done"
                placeholder="Type, or scan with a handheld scanner"
                className="w-full min-h-[52px] px-3 rounded-lg bg-[#f0f2f4] focus:bg-surface focus:ring-2 focus:ring-ink font-mono text-lg uppercase focus:outline-none"
              />
              <p className="text-[13px] text-muted mt-1.5 mb-4">A handheld scanner types the code and presses Enter for you.</p>
              <button
                type="submit"
                disabled={!code.trim()}
                className="w-full min-h-[48px] rounded-lg bg-ink text-white font-medium disabled:opacity-45"
              >
                Check code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
