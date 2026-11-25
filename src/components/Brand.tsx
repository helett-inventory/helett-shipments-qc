// Helett's own loading mark: three cartons hop along a belt, one after another.
export function CartonLoader({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 72 36" fill="none" aria-hidden="true" className="overflow-visible">
      {[0, 1, 2].map((i) => (
        <rect key={i} className="carton" x={4 + i * 22} y={10} width={16} height={16} rx={3} fill="#12161c" />
      ))}
      <line className="belt" x1="0" y1="32" x2="72" y2="32" stroke="#c3c8d0" strokeWidth="2" strokeLinecap="round" strokeDasharray="8 8" />
    </svg>
  )
}

// Full-screen while the app signs in; inline (small) while a page waits for its data.
export function LoadingScreen({ full = false }: { full?: boolean }) {
  if (!full) {
    return (
      <div role="status" aria-label="Loading" className="py-14 flex flex-col items-center gap-3 text-muted">
        <CartonLoader size={56} />
        <span className="text-sm">Loading</span>
      </div>
    )
  }
  return (
    // Same white as the launch screen and the app icon, so opening the app is one unbroken screen.
    <div role="status" aria-label="Loading" className="min-h-screen flex items-center justify-center bg-white">
      <img src="/helett-wordmark.png" alt="Helett" width={147} height={47} className="select-none invert" draggable={false} />
    </div>
  )
}
