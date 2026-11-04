import { useEffect, useRef, useState } from 'react'

interface SignaturePadProps {
  value?: string
  onChange: (dataUrl: string) => void
  readOnly?: boolean
}

// Pointer Events only exist in iOS Safari 13+ (2019). On anything older,
// pointerdown/move/up simply never fire — silent, total failure to draw.
// Feature-detecting once and falling back to plain touch events covers
// those devices without needing to know the exact minimum iOS version.
const SUPPORTS_POINTER_EVENTS = typeof window !== 'undefined' && 'PointerEvent' in window

function getPosFromClient(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height
  }
}

export function SignaturePad({ value, onChange, readOnly }: SignaturePadProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const loadedRef = useRef(false)
  // Tracks the last value *this component* produced via onChange (drawing a
  // stroke, clearing). Lets the load effect below tell "value changed
  // because we just drew on it" (already correctly on the canvas, no reload
  // needed) apart from "value changed because fresh data arrived from the
  // network/cache" (needs a real reload) — both look identical as a prop
  // change otherwise. Starts at a sentinel that can never equal a real
  // value, so the very first render's effect always runs (seeding it with
  // the initial `value` instead would wrongly skip initializing the canvas
  // whenever a pad starts out empty).
  const NEVER_EMITTED = useRef(Symbol('never-emitted')).current
  const lastEmittedValue = useRef<string | symbol | undefined>(NEVER_EMITTED)
  const [hasContent, setHasContent] = useState(!!value)
  // The pad only captures touch (blocking page scroll) while "active". Until
  // then it behaves like normal scrollable content, so a scroll gesture that
  // starts over the pad while flicking through the form doesn't get read as
  // a stroke. Tapping expands it into drawing mode.
  const [active, setActive] = useState(false)

  // React doesn't attach onPointerDown/onTouchMove/etc as real listeners on
  // the canvas — it attaches ONE delegated listener at the app root and
  // dispatches synthetically. That's invisible for discrete taps (like the
  // "Tap to expand" button), but iOS Safari's compositor decides how to
  // handle a touch — scroll vs. custom drag tracking, touch-action
  // enforcement — before JS runs, and it needs a REAL listener registered
  // directly on the element to reliably hand off a *continuous* drag's
  // move events. Without that, actually drawing a line (a pointerdown →
  // many pointermoves → pointerup stream) can silently never fire on iOS,
  // even though the CSS touch-action still correctly blocks page scroll —
  // which is exactly the symptom this was built to fix (expand works,
  // nothing draws, no scroll either). So every drawing listener below is
  // attached natively via addEventListener, never via JSX props. These refs
  // let that one-time-attached effect always see current prop/state values
  // without needing to re-attach listeners every render.
  const activeRef = useRef(active)
  activeRef.current = active
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // A form can hold several of these (QC/Dispatch/Final signatures), each
  // backed by a Drive-hosted image — load the pixel data only once the pad
  // actually scrolls into view instead of fetching all of them immediately
  // on page load. `loadedRef` guards against loading twice for the SAME
  // value (once from the observer, again if the user taps to expand before
  // it fired) — it gets reset below whenever `value` itself changes.
  function loadSignature() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !value || loadedRef.current) return
    loadedRef.current = true
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = value
  }

  useEffect(() => {
    // Skip: this "change" is just our own drawing/clearing echoing back
    // through props — the canvas already reflects it live, redrawing would
    // just flash a clear+reload after every stroke.
    if (value === lastEmittedValue.current) return

    setHasContent(!!value)
    // A record can be shown from stale-while-revalidate cache first (see
    // useInspections/QCForm), then get a corrected `value` moments later
    // once the real fetch resolves — this must re-run when that happens,
    // not just once on mount, or the canvas stays stuck on the stale value.
    loadedRef.current = false

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (!value) return

    if (!('IntersectionObserver' in window)) {
      loadSignature()
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadSignature()
        observer.disconnect()
      }
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [value])

  // All native (non-delegated) drawing listeners, attached once on mount —
  // see the big comment above activeRef for why this can't just be JSX
  // onPointerDown/onTouchStart props.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function beginStroke(clientX: number, clientY: number) {
      if (readOnlyRef.current || !activeRef.current) return
      setHasContent(true)
      drawing.current = true
      const ctx = canvas!.getContext('2d')
      const pos = getPosFromClient(canvas!, clientX, clientY)
      ctx?.beginPath()
      ctx?.moveTo(pos.x, pos.y)
    }

    function continueStroke(clientX: number, clientY: number) {
      if (readOnlyRef.current || !activeRef.current || !drawing.current) return
      const ctx = canvas!.getContext('2d')
      const pos = getPosFromClient(canvas!, clientX, clientY)
      ctx?.lineTo(pos.x, pos.y)
      ctx?.stroke()
    }

    function endStroke() {
      if (readOnlyRef.current || !activeRef.current || !drawing.current) return
      drawing.current = false
      const dataUrl = canvas!.toDataURL('image/png')
      lastEmittedValue.current = dataUrl
      onChangeRef.current(dataUrl)
    }

    function onPointerDown(e: PointerEvent) {
      if (readOnlyRef.current || !activeRef.current) return
      e.preventDefault()
      beginStroke(e.clientX, e.clientY)
      try {
        // Support for this has been inconsistent across Safari versions;
        // if it throws, drawing should still work via move/up, so don't
        // let it break the rest of the gesture.
        canvas!.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }
    function onPointerMove(e: PointerEvent) {
      continueStroke(e.clientX, e.clientY)
    }
    function onPointerUp() {
      endStroke()
    }
    function onPointerLeave(e: PointerEvent) {
      // setPointerCapture (above) exists specifically so this doesn't fire
      // mid-stroke — but its hit-testing can be flaky for touch on iOS,
      // briefly registering the finger as having "left" the canvas while
      // it's still on it. Only trust this to end a stroke for mouse/pen,
      // where the cursor genuinely leaving the canvas is meaningful; for
      // touch, pointerup is the only reliable end-of-stroke signal.
      if (e.pointerType === 'touch') return
      endStroke()
    }

    function onTouchStart(e: TouchEvent) {
      if (readOnlyRef.current || !activeRef.current) return
      e.preventDefault()
      const touch = e.touches[0]
      if (touch) beginStroke(touch.clientX, touch.clientY)
    }
    function onTouchMove(e: TouchEvent) {
      if (readOnlyRef.current || !activeRef.current || !drawing.current) return
      // iOS registers a plain touchmove listener as passive by default, so
      // preventDefault() would silently do nothing without the explicit
      // { passive: false } this listener is attached with below.
      e.preventDefault()
      const touch = e.touches[0]
      if (touch) continueStroke(touch.clientX, touch.clientY)
    }
    function onTouchEnd() {
      endStroke()
    }

    if (SUPPORTS_POINTER_EVENTS) {
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointerleave', onPointerLeave)
      return () => {
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointerleave', onPointerLeave)
      }
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // Auto-collapse back to scroll-safe mode the moment the user taps or
  // starts scrolling anywhere outside the pad — no need to explicitly hit
  // "Done". Safe to do without an explicit confirm step: each completed
  // stroke already calls onChange in endStroke() above the instant the
  // finger lifts, so whatever's drawn is already saved into form state
  // before any outside tap could even happen.
  useEffect(() => {
    if (!active) return
    function handleOutside(e: Event) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setActive(false)
      }
    }
    const eventName = SUPPORTS_POINTER_EVENTS ? 'pointerdown' : 'touchstart'
    document.addEventListener(eventName, handleOutside)
    return () => document.removeEventListener(eventName, handleOutside)
  }, [active])

  function handleClear() {
    if (readOnly) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasContent(false)
    lastEmittedValue.current = ''
    onChange('')
  }

  if (readOnly) {
    return value ? (
      <img
        src={value}
        alt="Signature"
        loading="lazy"
        decoding="async"
        className="w-full h-36 object-contain rounded-lg bg-[#f6f7f8]"
      />
    ) : (
      <div className="w-full h-36 flex items-center justify-center rounded-lg bg-[#f6f7f8] text-muted text-sm">
        No signature
      </div>
    )
  }

  return (
    <div
      className="relative"
      ref={wrapperRef}
      // Inside a <label> every click is forwarded to the label's first button
      // (Clear), wiping the stroke just drawn. Keep clicks inside the pad.
      onClick={(e) => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        // iOS treats a touch-and-hold on any element as a possible text
        // selection / "Look Up" gesture unless explicitly told not to —
        // without this, iOS can show its selection callout instead of
        // drawing a stroke. touch-action (via the Tailwind classes below)
        // doesn't cover this; it's a separate, WebKit-specific behavior.
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        className={`w-full h-36 rounded-lg bg-[#f6f7f8] ${
          active ? 'touch-none ring-2 ring-ink bg-white' : 'touch-pan-y'
        }`}
      />
      {!active && (
        <button
          type="button"
          onClick={() => {
            loadSignature()
            setActive(true)
          }}
          className="absolute inset-0 flex items-end justify-center pb-2"
        >
          <span className="text-xs font-medium text-muted bg-white/90 px-2.5 py-1 rounded-full">
            {hasContent ? 'Tap to expand & edit' : 'Tap to expand & sign'}
          </span>
        </button>
      )}
      {active && (
        <div className="flex gap-4 mt-1">
          <button
            type="button"
            onClick={handleClear}
            className="text-sm text-ink font-medium min-h-[44px] px-2"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setActive(false)}
            className="text-sm text-muted font-medium min-h-[44px] px-2"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
