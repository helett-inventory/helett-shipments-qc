import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { isConfigured } from './lib/supabase'
import { AppShell } from './components/AppShell'
import { Loading } from './components/ui'
import { Login } from './pages/Login'
import { Shipments } from './pages/Shipments'
import { ShipmentNew } from './pages/ShipmentNew'
import { ShipmentDetail } from './pages/ShipmentDetail'
import { QCList } from './pages/QCList'
import { QCRecord } from './pages/QCRecord'
import { QCFormPrint } from './pages/QCFormPrint'

function Setup() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md bg-surface shadow-card rounded-xl p-6">
        <h1 className="text-xl font-semibold mb-2">Connect Supabase</h1>
        <p className="text-sm text-muted">
          Copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code> and set{' '}
          <code className="font-mono">VITE_SUPABASE_URL</code> and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>, then restart.
        </p>
      </div>
    </div>
  )
}

function Gate() {
  const { session, profile, loading, problem, retry, signOut } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Login />
  if (problem && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md bg-surface shadow-card rounded-xl p-6">
          <h1 className="text-xl font-semibold mb-2">Could not load your account</h1>
          <p className="text-sm text-muted mb-4">{problem}</p>
          <div className="flex gap-2">
            <button type="button" onClick={retry} className="min-h-[44px] px-4 rounded-lg bg-ink text-white font-medium">
              Try again
            </button>
            <button type="button" onClick={signOut} className="min-h-[44px] px-4 rounded-lg bg-[#eceef1] font-medium">
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md bg-surface shadow-card rounded-xl p-6">
          <h1 className="text-xl font-semibold mb-2">No role assigned</h1>
          <p className="text-sm text-muted mb-4">You are signed in, but your account has no role yet. Ask Inventory to add it, then sign in again.</p>
          <button type="button" onClick={signOut} className="min-h-[44px] px-4 rounded-lg bg-[#eceef1] font-medium">
            Sign out
          </button>
        </div>
      </div>
    )
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Shipments />} />
        <Route path="/shipments" element={<Shipments />} />
        <Route path="/shipments/new" element={(profile.role === 'inventory' || !!profile.is_admin) ? <ShipmentNew /> : <Navigate to="/" replace />} />
        <Route path="/shipments/:id" element={<ShipmentDetail />} />
        <Route path="/shipments/:id/qc-form" element={profile.role === 'qc' && !profile.is_admin ? <Navigate to="/" replace /> : <QCFormPrint />} />
        <Route path="/qc" element={<QCList />} />
        <Route path="/qc/:id" element={<QCRecord />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  if (!isConfigured) return <Setup />
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
