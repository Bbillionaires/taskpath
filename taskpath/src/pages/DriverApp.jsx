import { useState, useEffect, useRef } from 'react'
import RouteMap from '../components/RouteMap'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const VARIANT_COLORS = {
  weekday:  { bg: '#1E3A5F', border: '#3B82F6', text: '#93C5FD' },
  saturday: { bg: '#14532D', border: '#22C55E', text: '#86EFAC' },
  sunday:   { bg: '#451A03', border: '#F59E0B', text: '#FCD34D' },
  special:  { bg: '#3B0764', border: '#A855F7', text: '#D8B4FE' },
}

function VariantBadge({ label, dayRule }) {
  const c = VARIANT_COLORS[dayRule] ?? VARIANT_COLORS.weekday
  return (
    <span style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 0.5 }}>{label}</span>
  )
}

function getTodayVariant(variants) {
  if (!variants?.length) return null
  const dow = new Date().getDay()
  const rule = dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
  return variants.find(v => v.day_rule === rule) ?? variants.find(v => v.day_rule === 'weekday') ?? variants[0]
}

function useGPS(active) {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)
  const watchRef = useRef(null)
  useEffect(() => {
    if (!active) { if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current); return }
    if (!navigator.geolocation) { setError('Geolocation not supported.'); return }
    watchRef.current = navigator.geolocation.watchPosition(
      p => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading ?? null }),
      err => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watchRef.current)
  }, [active])
  return { pos, error }
}

// ── Edit Job Modal ─────────────────────────────────────────────────────────
function EditJobModal({ job, onClose, onSaved }) {
  const { profile } = useAuth()
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState(job.notes ?? '')
  const [coveragePct, setCoveragePct] = useState(job.coverage_pct ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submitEdit() {
    if (!reason.trim()) { setError('Please provide a reason for the edit.'); return }
    setSaving(true)

    const edits = []
    if (coveragePct !== job.coverage_pct) {
      edits.push({ job_record_id: job.id, driver_id: profile.id, reason, field_changed: 'coverage_pct', old_value: String(job.coverage_pct ?? 0), new_value: String(coveragePct) })
    }
    if (notes !== (job.notes ?? '')) {
      edits.push({ job_record_id: job.id, driver_id: profile.id, reason, field_changed: 'notes', old_value: job.notes ?? '', new_value: notes })
    }
    if (edits.length === 0) {
      edits.push({ job_record_id: job.id, driver_id: profile.id, reason, field_changed: 'general', old_value: '', new_value: '' })
    }

    await supabase.from('job_records').update({ coverage_pct: coveragePct, notes }).eq('id', job.id)
    await supabase.from('job_edits').insert(edits)

    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#0F1623', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Edit Job Record</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginBottom: 16 }}>{job.routes?.name ?? 'Unknown route'} · {new Date(job.started_at).toLocaleDateString()}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>Coverage %</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min={0} max={100} value={coveragePct} onChange={e => setCoveragePct(Number(e.target.value))} style={{ flex: 1 }}/>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#F59E0B', fontFamily: 'monospace', width: 40, textAlign: 'right' }}>{coveragePct}%</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes about this job…" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}/>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>Reason for Edit <span style={{ color: '#EF4444' }}>*</span></label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why you are editing this record…" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}/>
            {error && <div style={{ fontSize: 11, color: '#FCA5A5' }}>{error}</div>}
          </div>

          <div style={{ display: 'flex', gap: 9, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '13px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
            <button onClick={submitEdit} disabled={saving} style={{ flex: 2, padding: '13px', background: saving ? 'rgba(245,158,11,0.3)' : 'linear-gradient(135deg,#B45309,#F59E0B)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Submit Edit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
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
  const [editingJob, setEditingJob] = useState(null)
  const [driverEditEnabled, setDriverEditEnabled] = useState(false)
  const { pos, error: gpsError } = useGPS(jobActive)
  const timerRef = useRef(null)
  const gpsTrackRef = useRef([])

  const [vehicleInfo, setVehicleInfo] = useState({
    vehicle_tag: '', insurance_policy: '', vehicle_make_model: '',
    vehicle_owner: '', vehicle_company: '', scheduled_hours: '', pay_rate: '', notes: '',
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState(null)

  useEffect(() => {
    loadTodayAssignment()
    loadRecentRecords()
    loadProfile()
    checkEditFlag()
  }, [])

  async function checkEditFlag() {
    const { data } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('flag_name', 'driver_edit_enabled')
      .eq('enabled', true)
      .limit(1)
    setDriverEditEnabled((data?.length ?? 0) > 0)
  }

  useEffect(() => {
    if (!pos) return
    if (jobActive) gpsTrackRef.current.push({ lat: pos.lat, lng: pos.lng, heading: pos.heading, ts: Date.now() })
    if (assignment) {
      supabase.from('driver_locations').upsert({
        driver_id: profile.id, assignment_id: assignment.id,
        lat: pos.lat, lng: pos.lng, heading: pos.heading, accuracy: pos.accuracy,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' })
    }
  }, [pos, jobActive])

  async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', profile.id).single()
    if (data) setVehicleInfo({ vehicle_tag: data.vehicle_tag ?? '', insurance_policy: data.insurance_policy ?? '', vehicle_make_model: data.vehicle_make_model ?? '', vehicle_owner: data.vehicle_owner ?? '', vehicle_company: data.vehicle_company ?? '', scheduled_hours: data.scheduled_hours ?? '', pay_rate: data.pay_rate ?? '', notes: data.notes ?? '' })
  }

  async function saveProfile() {
    setProfileSaving(true)
    const { error } = await supabase.from('profiles').update(vehicleInfo).eq('id', profile.id)
    if (error) setProfileMsg({ type: 'error', text: error.message })
    else setProfileMsg({ type: 'success', text: 'Profile saved!' })
    setProfileSaving(false)
    setTimeout(() => setProfileMsg(null), 3000)
  }

  async function loadTodayAssignment() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('assignments')
      .select(`*, routes(id,name,description,geojson), schedule_variants!assignments_variant_id_fkey(id,label,service_type,day_rule,color_code)`)
      .eq('driver_id', profile.id)
      .eq('scheduled_date', today)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    if (data) {
      setAssignment(data)
      const v = getTodayVariant(data.schedule_variants ? Array.isArray(data.schedule_variants) ? data.schedule_variants : [data.schedule_variants] : [])
      setVariant(v)
    }
    setLoading(false)
  }

  async function loadRecentRecords() {
    const { data } = await supabase
      .from('job_records')
      .select('*, routes(name), schedule_variants(label,day_rule)')
      .eq('driver_id', profile.id)
      .order('started_at', { ascending: false })
      .limit(20)
    if (data) setRecords(data)
  }

  function startJob() {
    setJobStart(new Date())
    setJobActive(true)
    gpsTrackRef.current = []
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    supabase.from('assignments').update({ status: 'in_progress' }).eq('id', assignment.id)
    // Save start coordinates
    if (pos) {
      supabase.from('job_records').update({ start_lat: pos.lat, start_lng: pos.lng }).eq('assignment_id', assignment.id)
    }
  }

  async function completeJob() {
    clearInterval(timerRef.current)
    setJobActive(false)
    const track = gpsTrackRef.current
    await supabase.from('job_records').insert({
      assignment_id: assignment.id, driver_id: profile.id,
      route_id: assignment.route_id, variant_id: variant?.id,
      started_at: jobStart.toISOString(), completed_at: new Date().toISOString(),
      coverage_pct: coverage,
      gps_track: { type: 'LineString', coordinates: track.map(p => [p.lng, p.lat]) },
      start_lat: track[0]?.lat ?? null,
      start_lng: track[0]?.lng ?? null,
      end_lat: track[track.length - 1]?.lat ?? null,
      end_lng: track[track.length - 1]?.lng ?? null,
      notes: null,
    })
    await supabase.from('assignments').update({ status: 'completed' }).eq('id', assignment.id)
    await supabase.from('driver_locations').delete().eq('driver_id', profile.id)
    await loadRecentRecords()
    setScreen('records')
  }

  const eStr = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const B = (bg, color = '#fff', disabled = false) => ({
    background: disabled ? 'rgba(255,255,255,0.06)' : bg,
    color: disabled ? 'rgba(255,255,255,0.2)' : color,
    border: 'none', borderRadius: 13, padding: '15px',
    fontSize: 14, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%', letterSpacing: 0.3,
  })

  const Inp = ({ label, textarea, ...props }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      {textarea
        ? <textarea {...props} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', minHeight: 80, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', ...props.style }}/>
        : <input {...props} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', ...props.style }}/>
      }
    </div>
  )

  return (
    <div style={{ height: '100vh', background: '#0A0F1A', color: '#fff', fontFamily: "'DM Sans','Segoe UI',sans-serif", maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>

      {editingJob && <EditJobModal job={editingJob} onClose={() => setEditingJob(null)} onSaved={loadRecentRecords}/>}

      {/* Header */}
      <div style={{ padding: '14px 16px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', marginLeft: 8, letterSpacing: 1 }}>DRIVER</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 2, fontFamily: 'monospace' }}>{today}</div>
        </div>
        <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)', borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>
          Sign out
        </button>
      </div>

      {/* HOME */}
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
                  {!jobActive && <button style={B('linear-gradient(135deg,#065F46,#059669)')} onClick={() => { setScreen('map'); startJob() }}>▶ Start Sweep</button>}
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: pos ? '#22C55E' : '#F59E0B', boxShadow: `0 0 8px ${pos ? '#22C55E' : '#F59E0B'}`, flexShrink: 0 }}/>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                  {pos ? `GPS active · ±${Math.round(pos.accuracy)}m${pos.heading != null ? ` · ${Math.round(pos.heading)}°` : ''}` : gpsError ? `GPS error: ${gpsError}` : 'GPS activates when job starts'}
                </span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 16px', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
              No assignment scheduled for today.
              <div style={{ fontSize: 11, fontFamily: 'monospace', marginTop: 6 }}>Contact your supervisor.</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Jobs This Week', records.filter(r => (new Date() - new Date(r.started_at)) < 7*24*3600*1000).length, '#F59E0B'],
              ['Avg Coverage', records.length ? Math.round(records.reduce((a, r) => a + (r.coverage_pct || 0), 0) / records.length) + '%' : '—', '#22C55E'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: c, fontFamily: 'monospace' }}>{v}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1, marginTop: 4 }}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MAP */}
      {screen === 'map' && (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 11, flex: 1 }}>
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
          <RouteMap geojson={assignment?.routes?.geojson} gpsPos={pos} sweptCoords={gpsTrackRef.current.map(p => [p.lat, p.lng])}/>
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
          <div style={{ display: 'flex', gap: 9, marginTop: 'auto' }}>
            {!jobActive && assignment && <button style={B('linear-gradient(135deg,#B45309,#F59E0B)')} onClick={startJob}>▶ Start Sweep</button>}
            {jobActive && (
              <>
                <button style={B('rgba(255,255,255,0.06)', 'rgba(255,255,255,0.55)')} onClick={completeJob}>✓ Mark Complete</button>
                <button style={{ ...B('rgba(239,68,68,0.12)', '#FCA5A5'), width: 'auto', padding: '15px 18px' }} onClick={() => { clearInterval(timerRef.current); setJobActive(false) }}>⏸</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* RECORDS */}
      {screen === 'records' && (
        <div style={{ padding: 14, flex: 1, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 14, color: 'rgba(255,255,255,0.32)', fontFamily: 'monospace', letterSpacing: 1 }}>
            JOB HISTORY · {records.length} records
          </div>
          {records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 16px', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>No completed jobs yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {records.map((job, i) => (
                <div key={job.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: driverEditEnabled ? 10 : 0 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', marginBottom: 3 }}>Job #{String(records.length - i).padStart(3, '0')}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>{job.routes?.name ?? 'Unknown route'}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {job.schedule_variants && <VariantBadge label={job.schedule_variants.label} dayRule={job.schedule_variants.day_rule}/>}
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                          {new Date(job.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {job.coverage_pct ?? 0}% covered
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#4ADE80', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', padding: '4px 9px', borderRadius: 99, fontFamily: 'monospace', flexShrink: 0 }}>✓ Done</div>
                  </div>
                  {driverEditEnabled && (
                    <button onClick={() => setEditingJob(job)} style={{ width: '100%', padding: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 9, color: '#F59E0B', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace', letterSpacing: 0.3 }}>
                      ✎ Edit Record
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PROFILE */}
      {screen === 'profile' && (
        <div style={{ padding: 14, flex: 1, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 14, color: 'rgba(255,255,255,0.32)', fontFamily: 'monospace', letterSpacing: 1 }}>DRIVER PROFILE</div>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{profile?.full_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{profile?.role?.toUpperCase()}</div>
          </div>
          {profileMsg && (
            <div style={{ background: profileMsg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${profileMsg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: profileMsg.type === 'error' ? '#FCA5A5' : '#86EFAC', marginBottom: 14 }}>
              {profileMsg.text}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1.5 }}>VEHICLE INFORMATION</div>
            <Inp label="Vehicle Tag / License Plate" placeholder="e.g. ABC-1234" value={vehicleInfo.vehicle_tag} onChange={e => setVehicleInfo(v => ({ ...v, vehicle_tag: e.target.value }))}/>
            <Inp label="Vehicle Make & Model" placeholder="e.g. 2022 Elgin Pelican" value={vehicleInfo.vehicle_make_model} onChange={e => setVehicleInfo(v => ({ ...v, vehicle_make_model: e.target.value }))}/>
            <Inp label="Insurance Policy Number" placeholder="e.g. POL-00123456" value={vehicleInfo.insurance_policy} onChange={e => setVehicleInfo(v => ({ ...v, insurance_policy: e.target.value }))}/>
            <Inp label="Vehicle Owner" placeholder="e.g. John Smith" value={vehicleInfo.vehicle_owner} onChange={e => setVehicleInfo(v => ({ ...v, vehicle_owner: e.target.value }))}/>
            <Inp label="Owner Company" placeholder="e.g. Smith Fleet LLC" value={vehicleInfo.vehicle_company} onChange={e => setVehicleInfo(v => ({ ...v, vehicle_company: e.target.value }))}/>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1.5, marginTop: 4 }}>WORK DETAILS</div>
            <Inp label="Scheduled Work Hours" placeholder="e.g. Mon–Fri 6:00AM–2:00PM" value={vehicleInfo.scheduled_hours} onChange={e => setVehicleInfo(v => ({ ...v, scheduled_hours: e.target.value }))}/>
            <Inp label="Pay Rate" placeholder="e.g. $22/hr" value={vehicleInfo.pay_rate} onChange={e => setVehicleInfo(v => ({ ...v, pay_rate: e.target.value }))}/>
            <Inp textarea label="Notes" placeholder="Any additional notes…" value={vehicleInfo.notes} onChange={e => setVehicleInfo(v => ({ ...v, notes: e.target.value }))}/>
            <button onClick={saveProfile} disabled={profileSaving} style={B('linear-gradient(135deg,#1D4ED8,#3B82F6)', '#fff', profileSaving)}>
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', background: '#0A0F1A' }}>
        {[
          { id: 'home', icon: '⌂', l: 'Home' },
          { id: 'map', icon: '◉', l: 'Map' },
          { id: 'records', icon: '≡', l: 'History' },
          { id: 'profile', icon: '◎', l: 'Profile' },
        ].map(t => (
          <button key={t.id} onClick={() => setScreen(t.id)} style={{ flex: 1, padding: '12px 8px', background: 'none', border: 'none', color: screen === t.id ? '#F59E0B' : 'rgba(255,255,255,0.25)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderTop: screen === t.id ? '2px solid #F59E0B' : '2px solid transparent' }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontFamily: 'monospace', letterSpacing: 0.5, fontWeight: 700 }}>{t.l.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}