import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleForgot(e) {
    e.preventDefault()
    setResetLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://taskpath-beige.vercel.app',
    })
    if (error) setError(error.message)
    else setResetSent(true)
    setResetLoading(false)
  }

  const inp = {
    width: '100%', padding: '13px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12, color: '#fff', fontSize: 15, outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0A0F1A', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1.5 }}>
            STREET SWEEP OPS
          </div>
        </div>

        {forgotMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 4 }}>
              {resetSent ? '✅ Reset link sent! Check your email.' : 'Enter your email to receive a reset link.'}
            </div>
            {!resetSent && (
              <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  style={inp} type="email" placeholder="Email address"
                  value={email} onChange={e => setEmail(e.target.value)}
                  required autoComplete="email"
                />
                {error && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#FCA5A5' }}>
                    {error}
                  </div>
                )}
                <button type="submit" disabled={resetLoading} style={{
                  padding: '15px', background: resetLoading ? 'rgba(245,158,11,0.3)' : 'linear-gradient(135deg,#B45309,#F59E0B)',
                  border: 'none', borderRadius: 13, color: '#fff', fontSize: 15, fontWeight: 700, cursor: resetLoading ? 'not-allowed' : 'pointer',
                }}>
                  {resetLoading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
            )}
            <button onClick={() => { setForgotMode(false); setResetSent(false); setError(null) }} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
              fontSize: 13, cursor: 'pointer', textDecoration: 'underline', marginTop: 4,
            }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              style={inp} type="email" placeholder="Email address"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email"
            />

            {/* Password field with eye toggle */}
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...inp, paddingRight: 46 }}
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.4)', fontSize: 16, padding: 0, lineHeight: 1,
                }}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#FCA5A5' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              marginTop: 4, padding: '15px',
              background: loading ? 'rgba(245,158,11,0.3)' : 'linear-gradient(135deg,#B45309,#F59E0B)',
              border: 'none', borderRadius: 13, color: '#fff',
              fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <button type="button" onClick={() => { setForgotMode(true); setError(null) }} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
              fontSize: 13, cursor: 'pointer', textDecoration: 'underline', marginTop: 4,
            }}>
              Forgot password?
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
