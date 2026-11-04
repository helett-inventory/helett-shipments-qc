import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { startRealtime } from '../lib/realtime'
import type { Shipment } from '../types/db'

const ROLE_LABEL = { inventory: 'Inventory', qc: 'QC', wm: 'Warehouse manager' } as const

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

// Live flag alert for Inventory: a scan mismatch puts a shipment on hold and
// this shows the moment the database row changes.
function useHoldAlerts(enabled: boolean) {
  const [alerts, setAlerts] = useState<Shipment[]>([])
  useEffect(() => {
    if (!enabled) return
    const channel = supabase
      .channel('hold-alerts')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shipments' }, (payload) => {
        const row = payload.new as Shipment
        if (row.on_hold) setAlerts((prev) => (prev.some((a) => a.id === row.id) ? prev : [...prev, row]))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled])
  return { alerts, dismiss: (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)) }
}

const IconBox = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 8l-9-5-9 5 9 5 9-5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </svg>
)
const IconCheck = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4h6v3H9z" />
    <path d="M9 14l2 2 4-4" />
  </svg>
)

const NAV = [
  { to: '/', label: 'Shipments', icon: IconBox, end: true },
  { to: '/qc', label: 'QC', icon: IconCheck, end: false }
]

export function AppShell() {
  const { profile, signOut } = useAuth()
  const online = useOnline()
  useEffect(() => startRealtime(), [])

  // Account menu (phones): closes on outside tap, Escape, or moving to another page.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])
  const { alerts, dismiss } = useHoldAlerts(profile?.role === 'inventory' || !!profile?.is_admin)

  return (
    <div className="min-h-screen print:block">
      {/* desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col bg-surface border-r border-line no-print">
        <div className="px-5 h-16 flex items-center font-semibold text-lg tracking-tight">Helett Enterprises</div>
        <nav className="px-3 space-y-1" aria-label="Sections">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 min-h-[44px] rounded-full text-[15px] font-medium transition-colors ${
                  isActive ? 'bg-ink text-white' : 'text-muted hover:bg-canvas hover:text-ink'
                }`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-4 border-t border-line">
          <div className="text-sm font-medium truncate">{profile?.name}</div>
          <div className="text-[13px] text-muted mb-2">{profile?.is_admin ? 'Admin' : profile ? ROLE_LABEL[profile.role] : ''}</div>
          <button type="button" onClick={signOut} className="w-full min-h-[40px] rounded-lg bg-fail text-white text-sm font-medium hover:bg-fail/90">
            Sign out
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <header
        className="lg:hidden sticky top-0 z-30 bg-surface border-b border-line no-print"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-4 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Helett Enterprises</span>
          <div className="flex items-center gap-1" ref={menuRef}>
            <span className="text-sm text-muted truncate max-w-[110px]">{profile?.name.split(' ')[0]}</span>
            <button
              type="button"
              aria-label="Account menu"
              aria-expanded={menuOpen}
              aria-controls="account-menu"
              onClick={() => setMenuOpen((o) => !o)}
              className="-mr-2 w-11 h-11 flex items-center justify-center rounded-lg text-ink hover:bg-canvas"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {menuOpen && (
              <div
                id="account-menu"
                className="absolute right-3 top-[calc(100%-6px)] w-56 bg-surface rounded-xl shadow-lg ring-1 ring-black/5 p-3"
              >
                <div className="text-sm font-medium truncate">{profile?.name}</div>
                <div className="text-[13px] text-muted mb-3">{profile?.is_admin ? 'Admin' : profile ? ROLE_LABEL[profile.role] : ''}</div>
                <button
                  type="button"
                  onClick={signOut}
                  className="w-full min-h-[44px] rounded-lg bg-fail text-white font-medium hover:bg-fail/90"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="lg:pl-60 print:pl-0">
        {!online && (
          <div role="alert" className="bg-fail text-white text-center text-sm py-2 px-4 no-print">
            You are offline. Helett needs a connection to save or scan.
          </div>
        )}

        {alerts.map((a) => (
          <div key={a.id} role="alert" className="bg-fail text-white px-4 lg:px-8 py-2 flex items-center justify-between gap-3 no-print">
            <span className="text-sm">
              <b>Flag:</b> {a.fba_id} is on hold. {a.hold_reason}
            </span>
            <NavLink to={`/shipments/${a.id}`} onClick={() => dismiss(a.id)} className="underline min-h-[44px] flex items-center shrink-0">
              Open
            </NavLink>
          </div>
        ))}

        <main className="pb-24 lg:pb-10 print:pb-0">
          <Outlet />
        </main>
      </div>

      {/* mobile tab bar */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-surface border-t border-line grid grid-cols-2 no-print"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Sections"
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 min-h-[62px] text-[12px] font-medium ${isActive ? 'text-ink' : 'text-muted'}`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`flex items-center justify-center h-8 w-16 rounded-full transition-colors ${isActive ? 'bg-ink text-white' : ''}`}>
                  {n.icon}
                </span>
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
