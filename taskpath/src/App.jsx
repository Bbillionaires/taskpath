import { useAuth } from './lib/AuthContext'
import LoginPage from './pages/LoginPage'
import DriverApp from './pages/DriverApp'
import SupervisorApp from './pages/SupervisorApp'
import AdminApp from './pages/AdminApp'
import DispatcherApp from './pages/DispatcherApp'
import LoadingScreen from './components/LoadingScreen'

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!session) return <LoginPage />
  if (!profile) return <LoadingScreen />

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