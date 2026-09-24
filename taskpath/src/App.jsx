import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import { startCheckout, isBillingBlocked } from './lib/billing'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DriverApp from './pages/DriverApp'
import SupervisorApp from './pages/SupervisorApp'
import AdminApp from './pages/AdminApp'
import DispatcherApp from './pages/DispatcherApp'
import LoadingScreen from './components/LoadingScreen'

export default function App() {
  const { loading } = useAuth()

  if (loading) return <LoadingScreen />

  return (
    <Routes>
      <Route path="/signup" element={<SignupPage />} />
      <Route path="*" element={<AuthGate />} />
    </Routes>
  )
}

function TrialEndedScreen() {
  const { profile, signOut } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canSubscribe = ['admin', 'supervisor'].includes(profile?.role)

  async function handleSubscribe() {
    setLoading(true)
    setError(null)
    try {
      await startCheckout()
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0A0F1A', color: '#fff', padding: 24, fontFamily: "'DM Sans','Segoe UI',sans-serif",
    }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Trial ended</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>
          {canSubscribe
            ? 'Your free trial has ended. Subscribe to keep using TaskPath.'
            : "Your company's free trial has ended. Contact your administrator to keep using TaskPath."}
        </div>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#FCA5A5', marginBottom: 16 }}>
            {error}
          </div>
        )}
        {canSubscribe && (
          <button onClick={handleSubscribe} disabled={loading} style={{
            padding: '15px 28px', background: loading ? 'rgba(245,158,11,0.3)' : 'linear-gradient(135deg,#B45309,#F59E0B)',
            border: 'none', borderRadius: 13, color: '#fff', fontSize: 15, fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer', width: '100%',
          }}>
            {loading ? 'Redirecting…' : 'Subscribe Now'}
          </button>
        )}
        <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', marginTop: 16 }}>
          Sign out
        </button>
      </div>
    </div>
  )
}

function AuthGate() {
  const { session, profile } = useAuth()

  if (!session) return <LoginPage />
  if (!profile) return <LoadingScreen />

  if (isBillingBlocked(profile.companies)) return <TrialEndedScreen />

  const role = profile.role
  if (role === 'driver')     return <DriverApp />
  if (role === 'supervisor') return <SupervisorApp />
  if (role === 'admin')      return <AdminApp />
  if (role === 'dispatcher') return <DispatcherApp />

  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
      Unknown role: <strong>{role}</strong>. Contact your administrator.
    </div>
  )
}
