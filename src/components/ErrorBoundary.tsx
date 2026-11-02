import { Component, type ReactNode } from 'react'

// Without this, a crash while rendering leaves a blank white page. Show the
// error and a way out instead.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  async reset() {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations()
      await Promise.all((regs ?? []).map((r) => r.unregister()))
      const keys = await caches?.keys()
      await Promise.all((keys ?? []).map((k) => caches.delete(k)))
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center p-5">
        <div className="max-w-md w-full bg-white border border-[#e2e5e9] rounded-xl p-6">
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-[#5f6975] mb-3">The page could not be shown. Reloading with a clean cache usually fixes it.</p>
          <pre className="text-xs bg-[#f5f6f7] rounded-lg p-3 overflow-auto mb-4 whitespace-pre-wrap">{this.state.error.message}</pre>
          <button
            type="button"
            onClick={() => this.reset()}
            className="min-h-[44px] px-4 rounded-lg bg-[#12161c] text-white font-medium"
          >
            Clear cache and reload
          </button>
        </div>
      </div>
    )
  }
}
