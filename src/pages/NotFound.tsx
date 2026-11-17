import { Link } from 'react-router-dom'

// An FBA box label for a page that does not exist. Same look as the shipments: ink, grey, one clear action.
export function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-surface shadow-card overflow-hidden">
          <div className="bg-ink text-white px-6 py-4 flex items-center justify-between">
            <span className="font-semibold tracking-tight">Helett</span>
            <span className="font-mono text-sm text-white/70">Box 404 of 404</span>
          </div>
          <div className="p-6">
            <svg viewBox="0 0 120 80" className="w-32 mx-auto mb-5" fill="none" aria-hidden="true">
              <path d="M10 30 60 10l50 20v36L60 78 10 66z" fill="#e9ebef" stroke="#12161c" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M10 30l50 20 50-20M60 50v28" stroke="#12161c" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M34 20l50 20" stroke="#7b8490" strokeWidth="5" strokeLinecap="round" />
            </svg>
            <h1 className="text-2xl font-semibold tracking-tight">This shipment never arrived</h1>
            <p className="mt-2 text-muted">That page does not exist, or the link is old. Check the address, or go back to your shipments.</p>
            <div className="mt-5 pt-5 border-t border-dashed border-line flex items-center gap-1" aria-hidden="true">
              {Array.from({ length: 42 }, (_, i) => (
                <span key={i} className="h-8 bg-ink rounded-[1px]" style={{ width: [2, 1, 3, 1, 2][i % 5] }} />
              ))}
            </div>
            <Link to="/" className="mt-5 inline-flex items-center justify-center min-h-[48px] px-5 rounded-xl bg-ink text-white font-medium w-full">
              Back to shipments
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
