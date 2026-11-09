import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { startRealtime } from '../lib/realtime'
import { useNeeds } from '../hooks/useNeeds'
import { NavCount } from './NeedsStrip'
import { Tip } from './ui'
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
  const needs = useNeeds()
  const [slim, setSlim] = useState(() => {
    try {
      return localStorage.getItem('helett.sidebar.slim') === '1'
    } catch {
      return false
    }
  })
  const toggleSlim = () =>
    setSlim((v) => {
      try {
        localStorage.setItem('helett.sidebar.slim', v ? '0' : '1')
      } catch {
        /* not remembered */
      }
      return !v
    })
  const countFor = (to: string) => (to === '/' ? needs.ships.length : needs.qc.length)

  return (
    <div className="min-h-screen print:block" style={{ ['--side' as string]: slim ? '72px' : '240px' }}>
      {/* desktop sidebar: full, or a slim icon rail (remembered).
          Every icon sits at the same x and every row at the same y in both states; only labels come and go. */}
      <aside
        className={`hidden lg:flex fixed inset-y-0 left-0 flex-col bg-surface border-r border-line no-print overflow-hidden transition-[width] duration-200 ${slim ? 'w-[72px]' : 'w-60'}`}
      >
        <div className="h-16 shrink-0 flex items-center gap-2 pl-4 pr-3">
          <Tip label={slim ? 'Expand sidebar' : 'Collapse sidebar'}>
            <button
              type="button"
              onClick={toggleSlim}
              aria-label={slim ? 'Expand sidebar' : 'Collapse sidebar'}
              className="w-10 h-10 shrink-0 rounded-lg text-muted hover:bg-canvas hover:text-ink flex items-center justify-center"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d={slim ? 'M13.5 10l2 2-2 2' : 'M15.5 10l-2 2 2 2'} />
              </svg>
            </button>
          </Tip>
          {!slim && <span className="font-semibold text-lg tracking-tight">Helett</span>}
        </div>

        <nav className="px-3 space-y-1.5" aria-label="Sections">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              aria-label={n.label}
              className={({ isActive }) =>
                `relative flex items-center h-12 pl-[14px] gap-3 rounded-full text-[15px] font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'bg-ink text-white' : 'text-muted hover:bg-canvas hover:text-ink'
                }`
              }
            >
              {({ isActive }) => {
                const body = (
                  <>
                    {n.icon}
                    {!slim && n.label}
                    <NavCount
                      n={countFor(n.to)}
                      invert={isActive}
                      className={slim ? 'absolute top-[3px] right-[3px] !min-w-[16px] !h-4 !text-[10px]' : 'ml-auto mr-4'}
                    />
                  </>
                )
                return slim ? <Tip label={n.label}><span className="contents">{body}</span></Tip> : body
              }}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-3 border-t border-line space-y-1.5">
          <div className="flex items-center gap-3 h-12 pl-1 min-w-0">
            <Tip label={`${profile?.name ?? ''}, ${profile?.is_admin ? 'Admin' : profile ? ROLE_LABEL[profile.role] : ''}`}>
              <span className="w-10 h-10 shrink-0 rounded-full bg-[#f0f1f3] text-ink text-sm font-semibold flex items-center justify-center">
                {(profile?.name ?? '?').trim().charAt(0).toUpperCase()}
              </span>
            </Tip>
            {!slim && (
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{profile?.name}</div>
                <div className="text-[13px] text-muted">{profile?.is_admin ? 'Admin' : profile ? ROLE_LABEL[profile.role] : ''}</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="w-full h-11 pl-[15px] gap-3 rounded-xl text-sm font-medium text-muted hover:bg-fail/10 hover:text-fail flex items-center whitespace-nowrap"
          >
            <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
              <path d="M16 8l4 4-4 4M20 12H9" />
            </svg>
            {!slim && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <header
        className="lg:hidden sticky top-0 z-30 bg-surface border-b border-line no-print"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-4 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Helett</span>
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

      <div className="lg:pl-[var(--side)] transition-[padding] duration-200 print:pl-0">
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
                <span className={`relative flex items-center justify-center h-8 w-16 rounded-full transition-colors ${isActive ? 'bg-ink text-white' : ''}`}>
                  {n.icon}
                  <NavCount n={countFor(n.to)} invert={isActive} className="absolute top-0 right-1.5" />
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
