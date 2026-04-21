import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

function Badge({ label, color = '#F59E0B' }) {
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}40`, color, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 0.5 }}>{label}</span>
  )
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, ...style }}>{children}</div>
  )
}

function Inp({ label, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      <input {...props} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', ...props.style }}/>
    </div>
  )
}

function Sel({ label, children, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      <select {...props} style={{ background: '#1A2235', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', ...props.style }}>{children}</select>
    </div>
  )
}

function Btn({ children, onClick, color = '#F59E0B', disabled, small, danger }) {
  const bg = danger ? 'rgba(239,68,68,0.15)' : `${color}20`
  const border = danger ? 'rgba(239,68,68,0.4)' : `${color}50`
  const txt = danger ? '#FCA5A5' : color
  return (
    <button onClick={onClick} disabled={disabled} style={{ background: disabled ? 'rgba(255,255,255,0.04)' : bg, border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : border}`, color: disabled ? 'rgba(255,255,255,0.2)' : txt, borderRadius: 10, padding: small ? '6px 12px' : '10px 18px', fontSize: small ? 11 : 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'monospace', letterSpacing: 0.3 }}>{children}</button>
  )
}

const STATUS_COLOR = { pending: '#F59E0B', in_progress: '#3B82F6', completed: '#22C55E', paused: '#FB923C', cancelled: '#6B7280', cancelled_due_to_error: '#EF4444' }

export default function DispatcherApp() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('assignments')
  const [assignments, setAssignments] = useState([])
  const [routes, setRoutes] = useState([])
  const [drivers, setDrivers] = useState([])
  const [variants, setVariants] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ driver_id: '', route_id: '', variant_id: '', scheduled_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  // Driver profile editing
  const [expandedDriver, setExpandedDriver] = useState(null)
  const [vehicleForms, setVehicleForms] = useState({})
  const [savingProfile, setSavingProfile] = useState(null)

  // Route upload flag
  const [canUploadRoutes, setCanUploadRoutes] = useState(false)

  useEffect(() => {
    loadAll()
    checkFlags()
  }, [])

  async function checkFlags() {
    const { data } = await supabase
      .from('feature_flags')
      .select('flag_name, enabled')
      .eq('flag_name', 'dispatcher_route_upload')
    if (data?.some(f => f.enabled)) setCanUploadRoutes(true)
  }

  async function loadAll() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: a }, { data: r }, { data: d }] = await Promise.all([
      supabase.from('assignments')
        .select('*, profiles(id,full_name), routes(name), schedule_variants(label,day_rule)')
        .order('scheduled_date', { ascending: false })
        .limit(50),
      supabase.from('routes').select('*, schedule_variants(*)').eq('status', 'active'),
      supabase.from('profiles').select('*').eq('role', 'driver').order('full_name'),
    ])
    setAssignments(a ?? [])
    setRoutes(r ?? [])
    setDrivers(d ?? [])
    const forms = {}
    ;(d ?? []).forEach(dr => {
      forms[dr.id] = {
        vehicle_tag: dr.vehicle_tag ?? '',
        insurance_policy: dr.insurance_policy ?? '',
        vehicle_make_model: dr.vehicle_make_model ?? '',
        vehicle_owner: dr.vehicle_owner ?? '',
        vehicle_company: dr.vehicle_company ?? '',
        scheduled_hours: dr.scheduled_hours ?? '',
        pay_rate: dr.pay_rate ?? '',
        notes: dr.notes ?? '',
      }
    })
    setVehicleForms(forms)
    setLoading(false)
  }

  function handleRouteChange(routeId) {
    const route = routes.find(r => r.id === routeId)
    setVariants(route?.schedule_variants ?? [])
    setForm(f => ({ ...f, route_id: routeId, variant_id: '' }))
  }

  async function saveAssignment() {
    setSaving(true)
    const { error } = await supabase.from('assignments').insert({
      driver_id: form.driver_id,
      route_id: form.route_id,
      variant_id: form.variant_id || null,
      scheduled_date: form.scheduled_date,
      status: 'pending',
      created_by: profile.id,
    })
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'success', text: 'Assignment created!' }); setShowForm(false); loadAll() }
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  async function saveDriverProfile(driverId) {
    setSavingProfile(driverId)
    await supabase.from('profiles').update(vehicleForms[driverId]).eq('id', driverId)
    setSavingProfile(null)
  }

  const tabs = [
    { id: 'assignments', label: 'Assignments' },
    { id: 'drivers', label: 'Drivers' },
    ...(canUploadRoutes ? [{ id: 'routes', label: 'Routes' }] : []),
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0F1A', color: '#fff', fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', marginLeft: 8, letterSpacing: 1 }}>DISPATCHER</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{profile?.full_name}</div>
        </div>
        <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)', borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>
          Sign out
        </button>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', display: 'flex', gap: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: 'none', border: 'none', color: tab === t.id ? '#F59E0B' : 'rgba(255,255,255,0.35)', padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', borderBottom: tab === t.id ? '2px solid #F59E0B' : '2px solid transparent', marginBottom: -1, letterSpacing: 0.3 }}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>

        {/* ASSIGNMENTS TAB */}
        {tab === 'assignments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>ASSIGNMENTS ({assignments.length})</div>
              <Btn small onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Assignment'}</Btn>
            </div>

            {msg && (
              <div style={{ background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>
                {msg.text}
              </div>
            )}

            {showForm && (
              <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Sel label="Driver" value={form.driver_id} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
                    <option value="">Select driver…</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </Sel>
                  <Sel label="Route" value={form.route_id} onChange={e => handleRouteChange(e.target.value)}>
                    <option value="">Select route…</option>
                    {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Sel>
                  {variants.length > 0 && (
                    <Sel label="Schedule variant" value={form.variant_id} onChange={e => setForm(f => ({ ...f, variant_id: e.target.value }))}>
                      <option value="">Auto-detect by day</option>
                      {variants.map(v => <option key={v.id} value={v.id}>{v.label} — {v.service_type}</option>)}
                    </Sel>
                  )}
                  <Inp label="Date" type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))}/>
                  <Btn onClick={saveAssignment} disabled={!form.driver_id || !form.route_id || saving}>
                    {saving ? 'Saving…' : 'Create Assignment'}
                  </Btn>
                </div>
              </Card>
            )}

            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Loading…</div>
            ) : assignments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No assignments yet.</div>
            ) : assignments.map(a => (
              <Card key={a.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{a.profiles?.full_name ?? 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>{a.routes?.name ?? 'Unknown route'}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Badge label={a.scheduled_date} color="#3B82F6"/>
                      <Badge label={a.status} color={STATUS_COLOR[a.status] ?? '#888'}/>
                      {a.schedule_variants && <Badge label={a.schedule_variants.label} color="#A855F7"/>}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* DRIVERS TAB */}
        {tab === 'drivers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 4 }}>
              DRIVERS ({drivers.length})
            </div>
            {drivers.map(d => (
              <div key={d.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
                <div onClick={() => setExpandedDriver(expandedDriver === d.id ? null : d.id)}
                  style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{d.full_name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'flex', gap: 8 }}>
                      {d.vehicle_make_model && <span>{d.vehicle_make_model}</span>}
                      {d.vehicle_tag && <span>· Tag: {d.vehicle_tag}</span>}
                    </div>
                  </div>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{expandedDriver === d.id ? '▲' : '▼'}</span>
                </div>

                {expandedDriver === d.id && vehicleForms[d.id] && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <Inp label="Vehicle Tag / Plate" value={vehicleForms[d.id].vehicle_tag} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_tag: e.target.value }}))}/>
                      <Inp label="Make & Model" value={vehicleForms[d.id].vehicle_make_model} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_make_model: e.target.value }}))}/>
                      <Inp label="Insurance Policy #" value={vehicleForms[d.id].insurance_policy} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], insurance_policy: e.target.value }}))}/>
                      <Inp label="Vehicle Owner" value={vehicleForms[d.id].vehicle_owner} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_owner: e.target.value }}))}/>
                      <Inp label="Owner Company" value={vehicleForms[d.id].vehicle_company} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_company: e.target.value }}))}/>
                      <Inp label="Scheduled Hours" value={vehicleForms[d.id].scheduled_hours} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], scheduled_hours: e.target.value }}))}/>
                      <Inp label="Pay Rate" value={vehicleForms[d.id].pay_rate} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], pay_rate: e.target.value }}))}/>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', display: 'block', marginBottom: 5 }}>Notes</label>
                      <textarea value={vehicleForms[d.id].notes} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], notes: e.target.value }}))}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}/>
                    </div>
                    <Btn small onClick={() => saveDriverProfile(d.id)} disabled={savingProfile === d.id} color="#3B82F6">
                      {savingProfile === d.id ? 'Saving…' : 'Save Profile'}
                    </Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ROUTES TAB - only if flag enabled */}
        {tab === 'routes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>ROUTES ({routes.length})</div>
            {routes.map(r => (
              <Card key={r.id}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{r.name}</div>
                {r.description && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{r.description}</div>}
                <Badge label={r.geojson ? '✓ route traced' : 'no route traced'} color={r.geojson ? '#22C55E' : '#EF4444'}/>
              </Card>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}