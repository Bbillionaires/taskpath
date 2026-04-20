import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DAY_RULES = ['weekday', 'saturday', 'sunday', 'special']
const ROLES = ['driver', 'supervisor', 'admin']

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

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 12 }}>{children}</div>
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

// ── Route Tracer Modal ─────────────────────────────────────────────────────
function RouteTracer({ route, onClose, onSaved }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const polylineRef = useRef(null)
  const markersRef = useRef([])
  const pointsRef = useRef([])
  const [pointCount, setPointCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
      .setView([30.3322, -81.6557], 14)

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map)

    // Load existing GeoJSON if any
    if (route.geojson) {
      try {
        const geo = typeof route.geojson === 'string' ? JSON.parse(route.geojson) : route.geojson
        const coords = geo.coordinates ?? geo.features?.[0]?.geometry?.coordinates
        if (coords) {
          pointsRef.current = coords.map(c => [c[1], c[0]])
          setPointCount(pointsRef.current.length)
          polylineRef.current = L.polyline(pointsRef.current, { color: '#F59E0B', weight: 4 }).addTo(map)
          map.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] })
          pointsRef.current.forEach((p, i) => {
            const m = L.circleMarker(p, { radius: i === 0 ? 7 : 4, color: i === 0 ? '#22C55E' : '#F59E0B', fillColor: i === 0 ? '#22C55E' : '#F59E0B', fillOpacity: 1 }).addTo(map)
            markersRef.current.push(m)
          })
        }
      } catch (e) {}
    }

    map.on('click', e => {
      const pt = [e.latlng.lat, e.latlng.lng]
      pointsRef.current.push(pt)
      setPointCount(pointsRef.current.length)

      // Add marker
      const isFirst = pointsRef.current.length === 1
      const m = L.circleMarker(pt, { radius: isFirst ? 7 : 4, color: isFirst ? '#22C55E' : '#F59E0B', fillColor: isFirst ? '#22C55E' : '#F59E0B', fillOpacity: 1 }).addTo(map)
      markersRef.current.push(m)

      // Update polyline
      if (polylineRef.current) {
        polylineRef.current.setLatLngs(pointsRef.current)
      } else {
        polylineRef.current = L.polyline(pointsRef.current, { color: '#F59E0B', weight: 4 }).addTo(map)
      }
    })

    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  function undoLast() {
    if (!pointsRef.current.length) return
    pointsRef.current.pop()
    setPointCount(pointsRef.current.length)
    const last = markersRef.current.pop()
    if (last) mapInstanceRef.current.removeLayer(last)
    if (polylineRef.current) polylineRef.current.setLatLngs(pointsRef.current)
  }

  function clearAll() {
    pointsRef.current = []
    setPointCount(0)
    markersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m))
    markersRef.current = []
    if (polylineRef.current) { mapInstanceRef.current.removeLayer(polylineRef.current); polylineRef.current = null }
  }

  async function saveRoute() {
    if (pointsRef.current.length < 2) { setMsg({ type: 'error', text: 'Need at least 2 points' }); return }
    setSaving(true)
    const geojson = {
      type: 'LineString',
      coordinates: pointsRef.current.map(p => [p[1], p[0]]),
    }
    const { error } = await supabase.from('routes').update({ geojson }).eq('id', route.id)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'success', text: 'Route saved!' }); setTimeout(() => { onSaved(); onClose() }, 1000) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0A0F1A', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>← Back</button>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Tracing: <span style={{ color: '#F59E0B' }}>{route.name}</span></div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{pointCount} points</div>
        <Btn small onClick={undoLast} disabled={pointCount === 0} color="#FB923C">↩ Undo</Btn>
        <Btn small danger onClick={clearAll} disabled={pointCount === 0}>Clear</Btn>
        <Btn small onClick={saveRoute} disabled={pointCount < 2 || saving} color="#22C55E">{saving ? 'Saving…' : '✓ Save Route'}</Btn>
      </div>

      {/* Instructions */}
      <div style={{ padding: '8px 16px', background: 'rgba(245,158,11,0.06)', borderBottom: '1px solid rgba(245,158,11,0.1)', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
        🟡 Click on the map to place route points · Green dot = start · Undo removes last point
      </div>

      {msg && (
        <div style={{ padding: '8px 16px', background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>
          {msg.text}
        </div>
      )}

      {/* Map */}
      <div ref={mapRef} style={{ flex: 1 }} />
    </div>
  )
}

// ── Routes Tab ─────────────────────────────────────────────────────────────
function RoutesTab() {
  const [routes, setRoutes] = useState([])
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [tracingRoute, setTracingRoute] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', zone_id: '' })
  const [variantForm, setVariantForm] = useState({ label: '', service_type: '', day_rule: 'weekday', color_code: '#F59E0B' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: r }, { data: z }] = await Promise.all([
      supabase.from('routes').select('*, zones(name), schedule_variants(*)').order('created_at', { ascending: false }),
      supabase.from('zones').select('*').order('name'),
    ])
    setRoutes(r ?? [])
    setZones(z ?? [])
    setLoading(false)
  }

  async function createZoneIfNeeded() {
    if (zones.length === 0) {
      const { data } = await supabase.from('zones').insert({ name: 'Default Zone', city: 'Jacksonville', state: 'FL' }).select().single()
      setZones([data])
      return data.id
    }
    return form.zone_id || zones[0].id
  }

  async function saveRoute() {
    setSaving(true)
    const zoneId = await createZoneIfNeeded()
    const { error } = await supabase.from('routes').insert({ name: form.name, description: form.description, zone_id: zoneId, status: 'active' })
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'success', text: 'Route created!' }); setForm({ name: '', description: '', zone_id: '' }); setShowForm(false); loadAll() }
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  async function addVariant(routeId) {
    const { error } = await supabase.from('schedule_variants').insert({ route_id: routeId, ...variantForm })
    if (!error) { setVariantForm({ label: '', service_type: '', day_rule: 'weekday', color_code: '#F59E0B' }); loadAll() }
  }

  async function deleteVariant(id) { await supabase.from('schedule_variants').delete().eq('id', id); loadAll() }
  async function deleteRoute(id) { await supabase.from('routes').delete().eq('id', id); loadAll() }

  if (tracingRoute) return <RouteTracer route={tracingRoute} onClose={() => setTracingRoute(null)} onSaved={loadAll} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>ROUTES ({routes.length})</SectionTitle>
        <Btn small onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Route'}</Btn>
      </div>

      {msg && (
        <div style={{ background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>
          {msg.text}
        </div>
      )}

      {showForm && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Inp label="Route name" placeholder="e.g. Zone 7A · Norris Canyon Rd" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/>
            <Inp label="Description (optional)" placeholder="e.g. Commercial district, 2.3 miles" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/>
            {zones.length > 0 && (
              <Sel label="Zone" value={form.zone_id} onChange={e => setForm(f => ({ ...f, zone_id: e.target.value }))}>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name} — {z.city}</option>)}
              </Sel>
            )}
            <Btn onClick={saveRoute} disabled={!form.name || saving}>{saving ? 'Saving…' : 'Create Route'}</Btn>
          </div>
        </Card>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Loading routes…</div>
      ) : routes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No routes yet.</div>
      ) : routes.map(route => (
        <Card key={route.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{route.name}</div>
              {route.description && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{route.description}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {route.zones && <Badge label={route.zones.name} color="#3B82F6"/>}
                <Badge label={route.status} color={route.status === 'active' ? '#22C55E' : '#888'}/>
                <Badge label={`${route.schedule_variants?.length ?? 0} variants`} color="#F59E0B"/>
                <Badge label={route.geojson ? '✓ route traced' : 'no route traced'} color={route.geojson ? '#22C55E' : '#EF4444'}/>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Btn small color="#3B82F6" onClick={() => setTracingRoute(route)}>
                {route.geojson ? '✎ Edit Route' : '+ Trace Route'}
              </Btn>
              <Btn small onClick={() => setExpanded(expanded === route.id ? null : route.id)}>
                {expanded === route.id ? 'Close' : 'Manage'}
              </Btn>
              <Btn small danger onClick={() => deleteRoute(route.id)}>Delete</Btn>
            </div>
          </div>

          {expanded === route.id && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginTop: 8 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1, marginBottom: 10 }}>SCHEDULE VARIANTS</div>
              {route.schedule_variants?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
                  {route.schedule_variants.map(v => (
                    <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px' }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, marginRight: 8 }}>{v.label}</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{v.service_type}</span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 8, fontFamily: 'monospace' }}>[{v.day_rule}]</span>
                      </div>
                      <Btn small danger onClick={() => deleteVariant(v.id)}>✕</Btn>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <Inp label="Label" placeholder="e.g. Weekday" value={variantForm.label} onChange={e => setVariantForm(f => ({ ...f, label: e.target.value }))}/>
                <Inp label="Service type" placeholder="e.g. Commercial + Residential" value={variantForm.service_type} onChange={e => setVariantForm(f => ({ ...f, service_type: e.target.value }))}/>
                <Sel label="Day rule" value={variantForm.day_rule} onChange={e => setVariantForm(f => ({ ...f, day_rule: e.target.value }))}>
                  {DAY_RULES.map(r => <option key={r} value={r}>{r}</option>)}
                </Sel>
                <Inp label="Color" type="color" value={variantForm.color_code} onChange={e => setVariantForm(f => ({ ...f, color_code: e.target.value }))} style={{ height: 42, padding: 4 }}/>
              </div>
              <Btn small onClick={() => addVariant(route.id)} disabled={!variantForm.label || !variantForm.service_type}>+ Add Variant</Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

// ── Drivers Tab ────────────────────────────────────────────────────────────
function DriversTab() {
  const [drivers, setDrivers] = useState([])
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'driver', zone_id: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: p }, { data: z }] = await Promise.all([
      supabase.from('profiles').select('*, zones(name, city)').order('created_at', { ascending: false }),
      supabase.from('zones').select('*').order('name'),
    ])
    setDrivers(p ?? [])
    setZones(z ?? [])
    setLoading(false)
  }

  async function createDriver() {
    setSaving(true)
    const response = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, password: form.password, full_name: form.full_name, role: form.role, zone_id: form.zone_id }),
    })
    const data = await response.json()
    if (!response.ok) setMsg({ type: 'error', text: data.error ?? 'Failed to create user' })
    else { setMsg({ type: 'success', text: `Account created for ${form.full_name}!` }); setForm({ full_name: '', email: '', password: '', role: 'driver', zone_id: '' }); setShowForm(false); loadAll() }
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  async function updateRole(profileId, role) { await supabase.from('profiles').update({ role }).eq('id', profileId); loadAll() }

  const roleColor = { driver: '#F59E0B', supervisor: '#3B82F6', admin: '#A855F7' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>TEAM MEMBERS ({drivers.length})</SectionTitle>
        <Btn small onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New User'}</Btn>
      </div>

      {msg && (
        <div style={{ background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>
          {msg.text}
        </div>
      )}

      {showForm && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Inp label="Full name" placeholder="e.g. James Carter" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}/>
            <Inp label="Email" type="email" placeholder="driver@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/>
            <Inp label="Password" type="password" placeholder="Temporary password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}/>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Sel label="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </Sel>
              {zones.length > 0 && (
                <Sel label="Zone" value={form.zone_id} onChange={e => setForm(f => ({ ...f, zone_id: e.target.value }))}>
                  <option value="">No zone</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </Sel>
              )}
            </div>
            <Btn onClick={createDriver} disabled={!form.full_name || !form.email || !form.password || saving}>
              {saving ? 'Creating…' : 'Create Account'}
            </Btn>
          </div>
        </Card>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Loading…</div>
      ) : drivers.map(d => (
        <Card key={d.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{d.full_name}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge label={d.role} color={roleColor[d.role] ?? '#888'}/>
                {d.zones && <Badge label={d.zones.name} color="#3B82F6"/>}
              </div>
            </div>
            <Sel value={d.role} onChange={e => updateRole(d.id, e.target.value)} style={{ width: 'auto', padding: '6px 10px', fontSize: 11 }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </Sel>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Assignments Tab ────────────────────────────────────────────────────────
function AssignmentsTab() {
  const [assignments, setAssignments] = useState([])
  const [routes, setRoutes] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ driver_id: '', route_id: '', variant_id: '', scheduled_date: new Date().toISOString().split('T')[0] })
  const [variants, setVariants] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: a }, { data: r }, { data: d }] = await Promise.all([
      supabase.from('assignments').select('*, profiles(full_name), routes(name), schedule_variants(label, day_rule)').order('scheduled_date', { ascending: false }).limit(50),
      supabase.from('routes').select('*, schedule_variants(*)').eq('status', 'active'),
      supabase.from('profiles').select('*').eq('role', 'driver'),
    ])
    setAssignments(a ?? [])
    setRoutes(r ?? [])
    setDrivers(d ?? [])
    setLoading(false)
  }

  function handleRouteChange(routeId) {
    const route = routes.find(r => r.id === routeId)
    setVariants(route?.schedule_variants ?? [])
    setForm(f => ({ ...f, route_id: routeId, variant_id: '' }))
  }

  async function saveAssignment() {
    setSaving(true)
    const { error } = await supabase.from('assignments').insert({ driver_id: form.driver_id, route_id: form.route_id, variant_id: form.variant_id || null, scheduled_date: form.scheduled_date, status: 'pending' })
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'success', text: 'Assignment created!' }); setShowForm(false); loadAll() }
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  async function deleteAssignment(id) { await supabase.from('assignments').delete().eq('id', id); loadAll() }

  const statusColor = { pending: '#F59E0B', in_progress: '#3B82F6', completed: '#22C55E', skipped: '#888' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>ASSIGNMENTS ({assignments.length})</SectionTitle>
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
                <Badge label={a.status} color={statusColor[a.status] ?? '#888'}/>
                {a.schedule_variants && <Badge label={a.schedule_variants.label} color="#A855F7"/>}
              </div>
            </div>
            <Btn small danger onClick={() => deleteAssignment(a.id)}>✕</Btn>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── AdminApp ───────────────────────────────────────────────────────────────
export default function AdminApp() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('routes')

  const tabs = [
    { id: 'routes', label: 'Routes' },
    { id: 'drivers', label: 'Team' },
    { id: 'assignments', label: 'Assignments' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0F1A', color: '#fff', fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', marginLeft: 8, letterSpacing: 1 }}>ADMIN</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{profile?.full_name}</div>
        </div>
        <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)', borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>
          Sign out
        </button>
      </div>

      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', display: 'flex', gap: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: 'none', border: 'none', color: tab === t.id ? '#F59E0B' : 'rgba(255,255,255,0.35)', padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', borderBottom: tab === t.id ? '2px solid #F59E0B' : '2px solid transparent', marginBottom: -1, letterSpacing: 0.3 }}>{t.label}</button>
        ))}
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
        {tab === 'routes' && <RoutesTab/>}
        {tab === 'drivers' && <DriversTab/>}
        {tab === 'assignments' && <AssignmentsTab/>}
      </div>
    </div>
  )
}