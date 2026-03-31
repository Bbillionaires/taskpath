import { useState, useEffect, useRef } from 'react'
import RouteMap from '../components/RouteMap'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// ── Schedule variant colors ────────────────────────────────────────────────
const VARIANT_COLORS = {
  weekday:  { bg: '#1E3A5F', border: '#3B82F6', text: '#93C5FD' },
  saturday: { bg: '#14532D', border: '#22C55E', text: '#86EFAC' },
  sunday:   { bg: '#451A03', border: '#F59E0B', text: '#FCD34D' },
  special:  { bg: '#3B0764', border: '#A855F7', text: '#D8B4FE' },
}

function VariantBadge({ label, dayRule }) {
  const c = VARIANT_COLORS[dayRule] ?? VARIANT_COLORS.weekday
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 6, padding: '2px 8px', fontSize: 10,
      fontWeight: 700, fontFamily: 'monospace', letterSpacing: 0.5,
    }}>
      {label}
    </span>
  )
}

// ── Resolve today's variant from a route's schedule_variants ──────────────
function getTodayVariant(variants) {
  if (!variants?.length) return null
  const dow = new Date().getDay()
  const rule = dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
  return variants.find(v => v.day_rule === rule)
    ?? variants.find(v => v.day_rule === 'weekday')
    ?? variants[0]
}

// ── GPS hook ──────────────────────────────────────────────────────────────
function useGPS(active) {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)
  const watchRef = useRef(null)

  useEffect(() => {
    if (!active) {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current)
      return
    }
    if (!navigator.geolocation) {
      setError('Geolocation not supported on this device.')
      return
    }
    watchRef.current = navigator.geolocation.watchPosition(
      pos => setPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watchRef.current)
  }, [active])

  return { pos, error }
}

export default function DriverApp() {
  const { profile, signOut } = useAuth()
  const [screen, setScreen] = useState('home')
  const [assignment, setAssignment] = useState(null)
  const [variant, setVariant] = useState(null)
  const [jobActive, setJobActive] = useState(false)
  const [jobStart, setJobStart] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [coverage, setCoverage] = useState(0)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const { pos, error: gpsError } = useGPS(jobActive)
  const timerRef = useRef(null)
  const gpsTrackRef = useRef([])

  // Load today's assignment
  useEffect(() => {
    loadTodayAssignment()
    loadRecentRecords()
  }, [])

  // Append GPS points to track while job is active
  useEffect(() => {
    if (jobActive && pos) {
      gpsTrackRef.current.push({ lat: pos.lat, lng: pos.lng, ts: Date.now() })
    }
  }, [pos, jobActive])

  async function loadTodayAssignment() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('assignments')
      .select(`
        *,
        routes (id, name, description, geojson),
        schedule_variants (id, label, service_type, day_rule, color_code)
      `)
      .eq('driver_id', profile.id)
      .eq('scheduled_date', today)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (data) {
      setAssignment(data)
      const v = getTodayVariant(data.schedule_variants
        ? Array.isArray(data.schedule_variants)
          ? data.schedule_variants
          : [data.schedule_variants]
        : [])
      setVariant(v)
    }
    setLoading(false)
  }

  async function loadRecentRecords() {
    const { data } = await supabase
      .from('job_records')
      .select('*, routes(name), schedule_variants(label, day_rule)')
      .eq('driver_id', profile.id)
      .order('started_at', { ascending: false })
      .limit(20)
    if (data) setRecords(data)
  }

  function startJob() {
    const now = new Date()
    setJobStart(now)
    setJobActive(true)
    gpsTrackRef.current = []
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    // Update assignment status
    supabase.from('assignments').update({ status: 'in_progress' }).eq('id', assignment.id)
  }

  async function completeJob() {
    clearInterval(timerRef.current)
    setJobActive(false)
    const endTime = new Date()
    const track = gpsTrackRef.current

    // Save job record
    const { data: record } = await supabase.from('job_records').insert({
      assignment_id: assignment.id,
      driver_id: profile.id,
      route_id: assignment.route_id,
      variant_id: variant?.id,
      started_at: jobStart.toISOString(),
      completed_at: endTime.toISOString(),
      coverage_pct: coverage,
      gps_track: { type: 'LineString', coordinates: track.map(p => [p.lng, p.lat]) },
    }).select().single()

    // Update assignment status
    await supabase.from('assignments').update({ status: 'completed' }).eq('id', assignment.id)

    await loadRecentRecords()
    setScreen('records')
  }

  const eStr = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  const B = (bg, color='#fff', disabled=false) => ({
    background: disabled ? 'rgba(255,255,255,0.06)' : bg,
    color: disabled ? 'rgba(255,255,255,0.2)' : color,
    border: 'none', borderRadius: 13, padding: '15px',
    fontSize: 14, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%', letterSpacing: 0.3,
  })

  return (
    <div style={{
      height: '100vh', background: '#0A0F1A', color: '#fff',
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
      maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', marginLeft: 8, letterSpacing: 1 }}>
              DRIVER
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 2, fontFamily: 'monospace' }}>
            {today}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['home','map','records'].map(s => (
            <button key={s} onClick={() => setScreen(s)} style={{
              background: screen === s ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)',
              border: screen === s ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
              color: screen === s ? '#F59E0B' : 'rgba(255,255,255,0.38)',
              borderRadius: 8, padding: '5px 10px', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.5,
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* ── HOME ── */}
      {screen === 'home' && (
        <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>Loading assignment…</div>
          ) : assignment ? (
            <>
              <div style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.1),rgba(234,88,12,0.05))', border: '1px solid rgba(245,158,11,0.14)', borderRadius: 16, padding: 20 }}>
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 6 }}>TODAY'S ASSIGNMENT</div>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{assignment.routes?.name}</div>
                {variant && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <VariantBadge label={variant.label} dayRule={variant.day_rule}/>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{variant.service_type}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 9 }}>
                  <button style={B('linear-gradient(135deg,#B45309,#F59E0B)')} onClick={() => setScreen('map')}>View Map →</button>
                  {!jobActive && <button style={B('linear-gradient(135deg,#065F46,#059669)')} onClick={() => { setScreen('map'); startJob(); }}>▶ Start Sweep</button>}
                </div>
              </div>

              {/* GPS status */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: pos ? '#22C55E' : '#F59E0B', boxShadow: `0 0 8px ${pos ? '#22C55E' : '#F59E0B'}`, flexShrink: 0 }}/>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                  {pos ? `GPS active · ±${Math.round(pos.accuracy)}m accuracy` : gpsError ? `GPS error: ${gpsError}` : 'GPS not yet active — start a job to enable'}
                </span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 16px', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
              No assignment scheduled for today.
              <div style={{ fontSize: 11, fontFamily: 'monospace', marginTop: 6 }}>Contact your supervisor.</div>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[['Jobs This Week', records.filter(r => { const d = new Date(r.started_at); const now = new Date(); return (now - d) < 7*24*3600*1000 }).length, '#F59E0B'],
              ['Avg Coverage', records.length ? Math.round(records.reduce((a,r)=>a+(r.coverage_pct||0),0)/records.length) + '%' : '—', '#22C55E']
            ].map(([l,v,c]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: c, fontFamily: 'monospace' }}>{v}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1, marginTop: 4 }}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MAP ── */}
      {screen === 'map' && (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 11, flex: 1 }}>
          {/* Route info */}
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13, padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.32)', fontFamily: 'monospace', letterSpacing: 1.2, marginBottom: 2 }}>ROUTE</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{assignment?.routes?.name ?? 'No assignment'}</div>
              {variant && <div style={{ marginTop: 4 }}><VariantBadge label={variant.label} dayRule={variant.day_rule}/></div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.32)', fontFamily: 'monospace', letterSpacing: 1, marginBottom: 2 }}>{jobActive ? 'ELAPSED' : 'STATUS'}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: '#F59E0B' }}>
                {jobActive ? eStr : assignment ? 'READY' : '—'}
              </div>
            </div>
          </div>

          <RouteMap
  geojson={assignment?.routes?.geojson}
  gpsPos={pos}
  sweptCoords={gpsTrackRef.current.map(p => [p.lat, p.lng])}
/>

          {/* Progress */}
          {jobActive && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.32)', fontFamily: 'monospace', letterSpacing: 1 }}>ROUTE COVERAGE</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#F59E0B', fontFamily: 'monospace' }}>{coverage}% swept</span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${coverage}%`, background: 'linear-gradient(90deg,#B45309,#F59E0B)', borderRadius: 99, transition: 'width 0.4s' }}/>
              </div>
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 9, marginTop: 'auto' }}>
            {!jobActive && assignment && (
              <button style={B('linear-gradient(135deg,#B45309,#F59E0B)')} onClick={startJob}>▶ Start Sweep</button>
            )}
            {jobActive && (
              <>
                <button style={B('rgba(255,255,255,0.06)','rgba(255,255,255,0.55)')} onClick={completeJob}>✓ Mark Complete</button>
                <button style={{ ...B('rgba(239,68,68,0.12)','#FCA5A5'), width: 'auto', padding: '15px 18px' }}
                  onClick={() => { clearInterval(timerRef.current); setJobActive(false); }}>⏸</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── RECORDS ── */}
      {screen === 'records' && (
        <div style={{ padding: 14, flex: 1, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 14, color: 'rgba(255,255,255,0.32)', fontFamily: 'monospace', letterSpacing: 1 }}>
            JOB HISTORY · {records.length} records
          </div>
          {records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 16px', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
              No completed jobs yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {records.map((job, i) => (
                <div key={job.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', marginBottom: 3 }}>
                      Job #{String(records.length - i).padStart(3,'0')}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>
                      {job.routes?.name ?? 'Unknown route'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {job.schedule_variants && <VariantBadge label={job.schedule_variants.label} dayRule={job.schedule_variants.day_rule}/>}
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                        {new Date(job.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' · '}
                        {job.coverage_pct ?? 0}% covered
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#4ADE80', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', padding: '4px 9px', borderRadius: 99, fontFamily: 'monospace', flexShrink: 0 }}>
                    ✓ Done
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom Nav */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', background: '#0A0F1A' }}>
        {[{id:'home',icon:'⌂',l:'Home'},{id:'map',icon:'◉',l:'Map'},{id:'records',icon:'≡',l:'History'}].map(t => (
          <button key={t.id} onClick={() => setScreen(t.id)} style={{
            flex: 1, padding: '12px 8px', background: 'none', border: 'none',
            color: screen === t.id ? '#F59E0B' : 'rgba(255,255,255,0.25)',
            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            borderTop: screen === t.id ? '2px solid #F59E0B' : '2px solid transparent',
          }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontFamily: 'monospace', letterSpacing: 0.5, fontWeight: 700 }}>{t.l.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
