export default function LoadingScreen() {
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#0A0F1A', gap: 16,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
        Task<span style={{ color: '#F59E0B' }}>Path</span>
      </div>
      <div style={{
        width: 32, height: 32, border: '3px solid rgba(245,158,11,0.2)',
        borderTop: '3px solid #F59E0B', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
