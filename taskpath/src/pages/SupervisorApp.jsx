import { useAuth } from '../lib/AuthContext'

export default function SupervisorApp() {
  const { profile, signOut } = useAuth()
  return (
    <div style={{ minHeight: '100vh', background: '#0A0F1A', color: '#fff', padding: 24, fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Task<span style={{ color: '#F59E0B' }}>Path</span></div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1 }}>SUPERVISOR</div>
        </div>
        <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'rgba(255,255,255,0.4)', borderRadius: 8, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>Sign out</button>
      </div>
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.25)' }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Supervisor Dashboard</div>
        <div style={{ fontSize: 11, fontFamily: 'monospace' }}>Coming next — live job tracking, driver status, route assignments</div>
      </div>
    </div>
  )
}
