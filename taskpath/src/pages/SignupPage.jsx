import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const INDUSTRIES = [
  { value: 'sweeper', label: 'Street Sweeping' },
  { value: 'trash', label: 'Trash / Waste Collection' },
  { value: 'lawn', label: 'Lawn Care' },
  { value: 'tree', label: 'Tree Service' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'roofing', label: 'Roofing (coming soon)' },
]

export default function SignupPage() {
  const navigate = useNavigate()
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('sweeper')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { company_name: companyName, industry, full_name: fullName } },
    })
    if (error) setError(error.message)
    else setDone(true)
    setLoading(false)
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
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1.5 }}>
            START YOUR ACCOUNT
          </div>
        </div>

        {done ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
              ✅ Check your email to confirm your account, then sign in.
            </div>
            <button onClick={() => navigate('/')} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
              fontSize: 13, cursor: 'pointer', textDecoration: 'underline', marginTop: 4,
            }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              style={inp} placeholder="Company name"
              value={companyName} onChange={e => setCompanyName(e.target.value)}
              required
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>INDUSTRY</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>

            <input
              style={inp} placeholder="Your full name"
              value={fullName} onChange={e => setFullName(e.target.value)}
              required
            />

            <input
              style={inp} type="email" placeholder="Email address"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email"
            />

            <input
              style={inp} type="password" placeholder="Password"
              value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="new-password" minLength={6}
            />

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
              {loading ? 'Creating account…' : 'Create Account'}
            </button>

            <button type="button" onClick={() => navigate('/')} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
              fontSize: 13, cursor: 'pointer', textDecoration: 'underline', marginTop: 4,
            }}>
              Already have an account? Sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
