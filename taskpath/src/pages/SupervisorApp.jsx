import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const STATUS_CONFIG = {
  pending:                { color: '#F59E0B', label: 'Pending' },
  in_progress:            { color: '#3B82F6', label: 'In Progress' },
  completed:              { color: '#22C55E', label: 'Completed' },
  paused:                 { color: '#FB923C', label: 'Paused' },
  cancelled:              { color: '#6B7280', label: 'Cancelled' },
  cancelled_due_to_error: { color: '#EF4444', label: 'Error / Cancel' },
}

const STATUS_ACTIONS = {
  pending:     [{ label: 'Cancel', color: '#6B7280', status: 'cancelled' }],
  in_progress: [
    { label: 'Pause',          color: '#FB923C', status: 'paused' },
    { label: 'Complete',       color: '#22C55E', status: 'completed' },
    { label: 'Cancel / Error', color: '#EF4444', status: 'cancelled_due_to_error' },
  ],
  paused: [
    { label: 'Resume',         color: '#3B82F6', status: 'in_progress' },
    { label: 'Cancel',         color: '#6B7280', status: 'cancelled' },
    { label: 'Cancel / Error', color: '#EF4444', status: 'cancelled_due_to_error' },
  ],
  completed:              [],
  cancelled:              [],
  cancelled_due_to_error: [],
}

const DRIVER_COLORS = ['#F59E0B','#3B82F6','#22C55E','#A855F7','#EC4899','#14B8A6','#F97316','#84CC16']
const getDriverColor = i => DRIVER_COLORS[i % DRIVER_COLORS.length]
const DAY_RULES = ['weekday', 'saturday', 'sunday', 'special']

function bearing(lat1, lng1, lat2, lng2) {
  const dL = (lng2 - lng1) * Math.PI / 180
  const l1 = lat1 * Math.PI / 180
  const l2 = lat2 * Math.PI / 180
  const y = Math.sin(dL) * Math.cos(l2)
  const x = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(dL)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

function offsetPoint(lat, lng, bearingDeg, distMeters) {
  const R = 6371000
  const b = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lng * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distMeters / R) + Math.cos(lat1) * Math.sin(distMeters / R) * Math.cos(b))
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(distMeters / R) * Math.cos(lat1), Math.cos(distMeters / R) - Math.sin(lat1) * Math.sin(lat2))
  return [lat2 * (180 / Math.PI), lon2 * (180 / Math.PI)]
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { color: '#888', label: status }
  return (
    <span style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`, color: cfg.color, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 0.5 }}>
      {cfg.label}
    </span>
  )
}

function Badge({ label, color = '#F59E0B' }) {
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}40`, color, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 0.5 }}>{label}</span>
  )
}

function Card({ children, style = {} }) {
  return <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, ...style }}>{children}</div>
}

// ── Route Tracer ───────────────────────────────────────────────────────────
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
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView([30.3322, -81.6557], 14)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map)

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
      const isFirst = pointsRef.current.length === 1
      const m = L.circleMarker(pt, { radius: isFirst ? 7 : 4, color: isFirst ? '#22C55E' : '#F59E0B', fillColor: isFirst ? '#22C55E' : '#F59E0B', fillOpacity: 1 }).addTo(map)
      markersRef.current.push(m)
      if (polylineRef.current) polylineRef.current.setLatLngs(pointsRef.current)
      else polylineRef.current = L.polyline(pointsRef.current, { color: '#F59E0B', weight: 4 }).addTo(map)
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
    const geojson = { type: 'LineString', coordinates: pointsRef.current.map(p => [p[1], p[0]]) }
    const { error } = await supabase.from('routes').update({ geojson }).eq('id', route.id)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'success', text: 'Route saved!' }); setTimeout(() => { onSaved(); onClose() }, 1000) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0A0F1A', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>← Back</button>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Tracing: <span style={{ color: '#F59E0B' }}>{route.name}</span></div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{pointCount} points</div>
        <button onClick={undoLast} disabled={pointCount === 0} style={{ background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.4)', color: '#FB923C', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>↩ Undo</button>
        <button onClick={clearAll} disabled={pointCount === 0} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>Clear</button>
        <button onClick={saveRoute} disabled={pointCount < 2 || saving} style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#86EFAC', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>{saving ? 'Saving…' : '✓ Save Route'}</button>
      </div>
      <div style={{ padding: '8px 16px', background: 'rgba(245,158,11,0.06)', borderBottom: '1px solid rgba(245,158,11,0.1)', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
        🟡 Click on the map to place route points · Green dot = start · Undo removes last point
      </div>
      {msg && <div style={{ padding: '8px 16px', background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>{msg.text}</div>}
      <div ref={mapRef} style={{ flex: 1 }} />
    </div>
  )
}

// ── Supervisor Live Map ────────────────────────────────────────────────────
function SupervisorMap({ assignments, driverLocations, jobRecords }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const layersRef = useRef({})

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView([30.3322, -81.6557], 12)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map)
    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    Object.keys(layersRef.current).filter(k => k.startsWith('route_')).forEach(k => { map.removeLayer(layersRef.current[k]); delete layersRef.current[k] })
    const bounds = []
    assignments.forEach((a, i) => {
      const geojson = a.routes?.geojson
      if (!geojson) return
      try {
        const parsed = typeof geojson === 'string' ? JSON.parse(geojson) : geojson
        const layer = L.geoJSON(parsed, { style: { color: '#F59E0B', weight: 3, opacity: 0.5, dashArray: '6,4' } }).addTo(map)
        layersRef.current[`route_${i}`] = layer
        layer.eachLayer(l => { if (l.getLatLngs) bounds.push(...l.getLatLngs().flat()) })
      } catch (e) {}
    })
    if (bounds.length > 0) { try { map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] }) } catch (e) {} }
  }, [assignments])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    Object.keys(layersRef.current).filter(k => k.startsWith('cov_')).forEach(k => { map.removeLayer(layersRef.current[k]); delete layersRef.current[k] })
    jobRecords.forEach((rec, ri) => {
      const coords = rec.gps_track?.coordinates
      if (!coords?.length) return
      coords.forEach((coord, j) => {
        if (j === 0) return
        const prev = coords[j - 1]
        const hdg = bearing(prev[1], prev[0], coord[1], coord[0])
        const rightPrev = offsetPoint(prev[1], prev[0], hdg + 90, 3.5)
        const rightCurr = offsetPoint(coord[1], coord[0], hdg + 90, 3.5)
        const leftPrev  = offsetPoint(prev[1], prev[0], hdg - 90, 3.5)
        const leftCurr  = offsetPoint(coord[1], coord[0], hdg - 90, 3.5)
        layersRef.current[`cov_r_${ri}_${j}`] = L.polyline([rightPrev, rightCurr], { color: '#3B82F6', weight: 3, opacity: 0.85 }).addTo(map)
        layersRef.current[`cov_l_${ri}_${j}`] = L.polyline([leftPrev, leftCurr], { color: '#22C55E', weight: 3, opacity: 0.85 }).addTo(map)
        layersRef.current[`cov_m_${ri}_${j}`] = L.polyline([[prev[1], prev[0]], [coord[1], coord[0]]], { color: 'rgba(255,255,255,0.35)', weight: 1.5, dashArray: '3,5' }).addTo(map)
      })
    })
  }, [jobRecords])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const activeIds = new Set(driverLocations.map(dl => `drv_${dl.driver_id}`))
    Object.keys(layersRef.current).filter(k => k.startsWith('drv_') && !activeIds.has(k)).forEach(k => { map.removeLayer(layersRef.current[k]); delete layersRef.current[k] })
    driverLocations.forEach((dl, i) => {
      const color = getDriverColor(i)
      const key = `drv_${dl.driver_id}`
      const hdg = dl.heading
      const html = `<div style="position:relative;width:20px;height:20px">
        <div style="width:20px;height:20px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 12px ${color}90;position:absolute"></div>
        ${hdg != null ? `<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%) rotate(${hdg}deg);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid ${color}"></div>` : ''}
      </div>`
      const icon = L.divIcon({ html, iconSize: [20, 20], iconAnchor: [10, 10], className: '' })
      if (layersRef.current[key]) { layersRef.current[key].setLatLng([dl.lat, dl.lng]); layersRef.current[key].setIcon(icon) }
      else layersRef.current[key] = L.marker([dl.lat, dl.lng], { icon }).addTo(map)
    })
  }, [driverLocations])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
}

// ── Main SupervisorApp ─────────────────────────────────────────────────────
export default function SupervisorApp() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('live')
  const [assignments, setAssignments] = useState([])
  const [routes, setRoutes] = useState([])
  const [zones, setZones] = useState([])
  const [drivers, setDrivers] = useState([])
  const [driverLocations, setDriverLocations] = useState([])
  const [jobRecords, setJobRecords] = useState([])
  const [jobEdits, setJobEdits] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDriver, setExpandedDriver] = useState(null)
  const [vehicleForms, setVehicleForms] = useState({})
  const [savingProfile, setSavingProfile] = useState(null)
  const [tracingRoute, setTracingRoute] = useState(null)
  const [flags, setFlags] = useState({ processor_enabled: false, driver_edit_enabled: true, processor_route_upload: false })
  const [savingFlag, setSavingFlag] = useState(null)

  // New assignment form
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [assignForm, setAssignForm] = useState({ driver_id: '', route_id: '', variant_id: '', scheduled_date: new Date().toISOString().split('T')[0] })
  const [assignVariants, setAssignVariants] = useState([])
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignMsg, setAssignMsg] = useState(null)

  // New route form
  const [showRouteForm, setShowRouteForm] = useState(false)
  const [routeForm, setRouteForm] = useState({ name: '', description: '', zone_id: '' })
  const [variantForm, setVariantForm] = useState({ label: '', service_type: '', day_rule: 'weekday', color_code: '#F59E0B' })
  const [expandedRoute, setExpandedRoute] = useState(null)
  const [routeSaving, setRouteSaving] = useState(false)
  const [routeMsg, setRouteMsg] = useState(null)

  // New team user form
  const [showAddUser, setShowAddUser] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', email: '', password: '', role: 'driver' })
  const [addSaving, setAddSaving] = useState(false)
  const [addMsg, setAddMsg] = useState(null)

  useEffect(() => {
    loadAll()
    loadFlags()
    const channel = supabase.channel('supervisor-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, loadDriverLocations)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assignments' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function loadFlags() {
    const { data } = await supabase.from('feature_flags').select('*').eq('supervisor_id', profile.id)
    if (data) {
      const f = {}
      data.forEach(d => { f[d.flag_name] = d.enabled })
      setFlags(prev => ({ ...prev, ...f }))
    }
  }

  async function toggleFlag(flagName, enabled) {
    setSavingFlag(flagName)
    await supabase.from('feature_flags').upsert({ supervisor_id: profile.id, flag_name: flagName, enabled, updated_at: new Date().toISOString() }, { onConflict: 'supervisor_id,flag_name' })
    setFlags(prev => ({ ...prev, [flagName]: enabled }))
    setSavingFlag(null)
  }

  async function loadAll() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: a }, { data: r }, { data: z }, { data: d }, { data: jr }, { data: je }] = await Promise.all([
      supabase.from('assignments').select('*, profiles(id,full_name,role), routes(id,name,geojson), schedule_variants(label,day_rule)').eq('scheduled_date', today).order('created_at', { ascending: false }),
      supabase.from('routes').select('*, zones(name), schedule_variants(*)').order('created_at', { ascending: false }),
      supabase.from('zones').select('*').order('name'),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('job_records').select('*, routes(name), profiles(full_name)').gte('started_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()).order('started_at', { ascending: false }),
      supabase.from('job_edits').select('*, profiles(full_name), job_records(*)').order('created_at', { ascending: false }).limit(100),
    ])
    setAssignments(a ?? [])
    setRoutes(r ?? [])
    setZones(z ?? [])
    setDrivers(d ?? [])
    setJobRecords(jr ?? [])
    setJobEdits(je ?? [])
    const forms = {}
    ;(d ?? []).forEach(dr => {
      forms[dr.id] = { vehicle_tag: dr.vehicle_tag ?? '', insurance_policy: dr.insurance_policy ?? '', vehicle_make_model: dr.vehicle_make_model ?? '', vehicle_owner: dr.vehicle_owner ?? '', vehicle_company: dr.vehicle_company ?? '', scheduled_hours: dr.scheduled_hours ?? '', pay_rate: dr.pay_rate ?? '', notes: dr.notes ?? '' }
    })
    setVehicleForms(forms)
    setLoading(false)
    loadDriverLocations()
  }

  async function loadDriverLocations() {
    const { data } = await supabase.from('driver_locations').select('*')
    setDriverLocations(data ?? [])
  }

  async function updateStatus(assignmentId, status) {
    await supabase.from('assignments').update({ status }).eq('id', assignmentId)
    loadAll()
  }

  async function saveDriverProfile(driverId) {
    setSavingProfile(driverId)
    await supabase.from('profiles').update(vehicleForms[driverId]).eq('id', driverId)
    setSavingProfile(null)
  }

  async function saveAssignment() {
    setAssignSaving(true)
    const { error } = await supabase.from('assignments').insert({ driver_id: assignForm.driver_id, route_id: assignForm.route_id, variant_id: assignForm.variant_id || null, scheduled_date: assignForm.scheduled_date, status: 'pending', created_by: profile.id })
    if (error) setAssignMsg({ type: 'error', text: error.message })
    else { setAssignMsg({ type: 'success', text: 'Assignment created!' }); setShowAssignForm(false); loadAll() }
    setAssignSaving(false)
    setTimeout(() => setAssignMsg(null), 3000)
  }

  async function saveRoute() {
    setRouteSaving(true)
    const zoneId = routeForm.zone_id || zones[0]?.id
    const { error } = await supabase.from('routes').insert({ name: routeForm.name, description: routeForm.description, zone_id: zoneId, status: 'active', created_by: profile.id })
    if (error) setRouteMsg({ type: 'error', text: error.message })
    else { setRouteMsg({ type: 'success', text: 'Route created!' }); setRouteForm({ name: '', description: '', zone_id: '' }); setShowRouteForm(false); loadAll() }
    setRouteSaving(false)
    setTimeout(() => setRouteMsg(null), 3000)
  }

  async function addVariant(routeId) {
    const { error } = await supabase.from('schedule_variants').insert({ route_id: routeId, ...variantForm })
    if (!error) { setVariantForm({ label: '', service_type: '', day_rule: 'weekday', color_code: '#F59E0B' }); loadAll() }
  }

  async function deleteVariant(id) { await supabase.from('schedule_variants').delete().eq('id', id); loadAll() }

  async function createTeamUser() {
    setAddSaving(true)
    const res = await fetch('/api/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...addForm, created_by: profile.id }) })
    const data = await res.json()
    if (!res.ok) setAddMsg({ type: 'error', text: data.error ?? 'Failed to create user' })
    else { setAddMsg({ type: 'success', text: `Account created for ${addForm.full_name}!` }); setAddForm({ full_name: '', email: '', password: '', role: 'driver' }); setShowAddUser(false); loadAll() }
    setAddSaving(false)
    setTimeout(() => setAddMsg(null), 3000)
  }

  const Inp = ({ label, textarea, ...props }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      {textarea
        ? <textarea {...props} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', ...props.style }}/>
        : <input {...props} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', ...props.style }}/>
      }
    </div>
  )

  const Sel = ({ label, children, ...props }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      <select {...props} style={{ background: '#1A2235', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', ...props.style }}>{children}</select>
    </div>
  )

  const Btn = ({ children, onClick, color = '#F59E0B', disabled, small, danger }) => {
    const bg = danger ? 'rgba(239,68,68,0.15)' : `${color}20`
    const border = danger ? 'rgba(239,68,68,0.4)' : `${color}50`
    const txt = danger ? '#FCA5A5' : color
    return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? 'rgba(255,255,255,0.04)' : bg, border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : border}`, color: disabled ? 'rgba(255,255,255,0.2)' : txt, borderRadius: 10, padding: small ? '6px 12px' : '10px 18px', fontSize: small ? 11 : 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'monospace', letterSpacing: 0.3 }}>{children}</button>
  }

  const Toggle = ({ label, desc, flagName }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 16px' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{desc}</div>
      </div>
      <button onClick={() => toggleFlag(flagName, !flags[flagName])} disabled={savingFlag === flagName} style={{ width: 44, height: 24, borderRadius: 99, border: 'none', cursor: 'pointer', background: flags[flagName] ? '#22C55E' : 'rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2, left: flags[flagName] ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }}/>
      </button>
    </div>
  )

  const activeCount = assignments.filter(a => ['in_progress', 'paused'].includes(a.status)).length

  if (tracingRoute) return <RouteTracer route={tracingRoute} onClose={() => setTracingRoute(null)} onSaved={loadAll} />

  const allTabs = [
    { id: 'live', label: 'Live Map' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'routes', label: 'Routes' },
    { id: 'drivers', label: 'Drivers' },
    { id: 'team', label: 'Team' },
    { id: 'editlog', label: 'Edit Log' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0A0F1A', color: '#fff', fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
            Task<span style={{ color: '#F59E0B' }}>Path</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', marginLeft: 8, letterSpacing: 1 }}>SUPERVISOR</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{profile?.full_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: activeCount > 0 ? '#22C55E' : '#6B7280', boxShadow: activeCount > 0 ? '0 0 8px #22C55E' : 'none' }}/>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{activeCount} active</span>
          </div>
          <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)', borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>Sign out</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {allTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: 'none', border: 'none', color: tab === t.id ? '#F59E0B' : 'rgba(255,255,255,0.35)', padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', borderBottom: tab === t.id ? '2px solid #F59E0B' : '2px solid transparent', marginBottom: -1, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{t.label}</button>
        ))}
      </div>

      {/* LIVE MAP TAB */}
      {tab === 'live' && (
        <div style={{ display: 'flex', height: 'calc(100vh - 112px)' }}>
          <div style={{ width: 310, borderRight: '1px solid rgba(255,255,255,0.07)', overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>TODAY · {assignments.length} ASSIGNMENTS</div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>Loading…</div>
            ) : assignments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No assignments today.</div>
            ) : assignments.map((a, i) => {
              const live = driverLocations.find(dl => dl.driver_id === a.profiles?.id)
              const actions = STATUS_ACTIONS[a.status] ?? []
              return (
                <div key={a.id} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${getDriverColor(i)}30`, borderRadius: 12, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: getDriverColor(i), flexShrink: 0 }}/>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{a.profiles?.full_name ?? 'Unknown'}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{a.routes?.name ?? 'No route'}</div>
                      <StatusBadge status={a.status}/>
                    </div>
                    {live && (
                      <div style={{ fontSize: 9, color: '#22C55E', fontFamily: 'monospace', textAlign: 'right', lineHeight: 1.6 }}>
                        <div style={{ fontWeight: 700 }}>● LIVE</div>
                        {live.heading != null && <div>{Math.round(live.heading)}°</div>}
                      </div>
                    )}
                  </div>
                  {actions.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {actions.map(act => (
                        <button key={act.status} onClick={() => updateStatus(a.id, act.status)} style={{ background: `${act.color}18`, border: `1px solid ${act.color}40`, color: act.color, borderRadius: 7, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>{act.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8 }}>MAP LEGEND</div>
              {[['─ ─ ─', '#F59E0B', 'Planned route'], ['────', '#3B82F6', 'Right lane swept'], ['────', '#22C55E', 'Left lane swept'], ['· · ·', 'rgba(255,255,255,0.4)', 'Median centerline']].map(([sym, color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ color, fontFamily: 'monospace', fontSize: 12, width: 30, textAlign: 'center' }}>{sym}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, padding: 16 }}>
            <SupervisorMap assignments={assignments} driverLocations={driverLocations} jobRecords={jobRecords}/>
          </div>
        </div>
      )}

      {/* ASSIGNMENTS TAB */}
      {tab === 'assignments' && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>TODAY'S ASSIGNMENTS ({assignments.length})</div>
            <Btn small onClick={() => setShowAssignForm(!showAssignForm)}>{showAssignForm ? 'Cancel' : '+ New Assignment'}</Btn>
          </div>
          {assignMsg && <div style={{ background: assignMsg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${assignMsg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: assignMsg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>{assignMsg.text}</div>}
          {showAssignForm && (
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Sel label="Driver" value={assignForm.driver_id} onChange={e => setAssignForm(f => ({ ...f, driver_id: e.target.value }))}>
                  <option value="">Select driver…</option>
                  {drivers.filter(d => d.role === 'driver').map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </Sel>
                <Sel label="Route" value={assignForm.route_id} onChange={e => { const r = routes.find(r => r.id === e.target.value); setAssignVariants(r?.schedule_variants ?? []); setAssignForm(f => ({ ...f, route_id: e.target.value, variant_id: '' })) }}>
                  <option value="">Select route…</option>
                  {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Sel>
                {assignVariants.length > 0 && (
                  <Sel label="Schedule variant" value={assignForm.variant_id} onChange={e => setAssignForm(f => ({ ...f, variant_id: e.target.value }))}>
                    <option value="">Auto-detect by day</option>
                    {assignVariants.map(v => <option key={v.id} value={v.id}>{v.label} — {v.service_type}</option>)}
                  </Sel>
                )}
                <Inp label="Date" type="date" value={assignForm.scheduled_date} onChange={e => setAssignForm(f => ({ ...f, scheduled_date: e.target.value }))}/>
                <Btn onClick={saveAssignment} disabled={!assignForm.driver_id || !assignForm.route_id || assignSaving}>{assignSaving ? 'Saving…' : 'Create Assignment'}</Btn>
              </div>
            </Card>
          )}
          {assignments.map(a => (
            <Card key={a.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{a.profiles?.full_name ?? 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>{a.routes?.name ?? 'Unknown route'}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge label={a.scheduled_date} color="#3B82F6"/>
                    <StatusBadge status={a.status}/>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {(STATUS_ACTIONS[a.status] ?? []).map(act => (
                    <button key={act.status} onClick={() => updateStatus(a.id, act.status)} style={{ background: `${act.color}18`, border: `1px solid ${act.color}40`, color: act.color, borderRadius: 7, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>{act.label}</button>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ROUTES TAB */}
      {tab === 'routes' && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>ROUTES ({routes.length})</div>
            <Btn small onClick={() => setShowRouteForm(!showRouteForm)}>{showRouteForm ? 'Cancel' : '+ New Route'}</Btn>
          </div>
          {routeMsg && <div style={{ background: routeMsg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${routeMsg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: routeMsg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>{routeMsg.text}</div>}
          {showRouteForm && (
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Inp label="Route name" placeholder="e.g. Zone 7A · Norris Canyon Rd" value={routeForm.name} onChange={e => setRouteForm(f => ({ ...f, name: e.target.value }))}/>
                <Inp label="Description (optional)" value={routeForm.description} onChange={e => setRouteForm(f => ({ ...f, description: e.target.value }))}/>
                {zones.length > 0 && (
                  <Sel label="Zone" value={routeForm.zone_id} onChange={e => setRouteForm(f => ({ ...f, zone_id: e.target.value }))}>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name} — {z.city}</option>)}
                  </Sel>
                )}
                <Btn onClick={saveRoute} disabled={!routeForm.name || routeSaving}>{routeSaving ? 'Saving…' : 'Create Route'}</Btn>
              </div>
            </Card>
          )}
          {routes.map(route => (
            <Card key={route.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{route.name}</div>
                  {route.description && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{route.description}</div>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {route.zones && <Badge label={route.zones.name} color="#3B82F6"/>}
                    <Badge label={`${route.schedule_variants?.length ?? 0} variants`} color="#F59E0B"/>
                    <Badge label={route.geojson ? '✓ traced' : 'not traced'} color={route.geojson ? '#22C55E' : '#EF4444'}/>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Btn small color="#3B82F6" onClick={() => setTracingRoute(route)}>{route.geojson ? '✎ Edit Route' : '+ Trace Route'}</Btn>
                  <Btn small onClick={() => setExpandedRoute(expandedRoute === route.id ? null : route.id)}>{expandedRoute === route.id ? 'Close' : 'Manage'}</Btn>
                </div>
              </div>
              {expandedRoute === route.id && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1, marginBottom: 10 }}>SCHEDULE VARIANTS</div>
                  {route.schedule_variants?.map(v => (
                    <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px', marginBottom: 7 }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, marginRight: 8 }}>{v.label}</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{v.service_type}</span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 8, fontFamily: 'monospace' }}>[{v.day_rule}]</span>
                      </div>
                      <Btn small danger onClick={() => deleteVariant(v.id)}>✕</Btn>
                    </div>
                  ))}
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
      )}

      {/* DRIVERS TAB */}
      {tab === 'drivers' && (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 16 }}>DRIVERS ({drivers.filter(d => d.role === 'driver').length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {drivers.filter(d => d.role === 'driver').map(d => (
              <div key={d.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
                <div onClick={() => setExpandedDriver(expandedDriver === d.id ? null : d.id)} style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{d.full_name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'flex', gap: 8 }}>
                      {d.vehicle_make_model && <span>{d.vehicle_make_model}</span>}
                      {d.vehicle_tag && <span>· Tag: {d.vehicle_tag}</span>}
                      {d.scheduled_hours && <span>· {d.scheduled_hours}</span>}
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
                    <Inp textarea label="Notes" value={vehicleForms[d.id].notes} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], notes: e.target.value }}))}/>
                    <div style={{ marginTop: 10 }}>
                      <Btn small onClick={() => saveDriverProfile(d.id)} disabled={savingProfile === d.id} color="#3B82F6">{savingProfile === d.id ? 'Saving…' : 'Save Profile'}</Btn>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TEAM TAB */}
      {tab === 'team' && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>MY TEAM</div>
            <Btn small onClick={() => setShowAddUser(!showAddUser)}>{showAddUser ? 'Cancel' : '+ Add User'}</Btn>
          </div>
          {addMsg && <div style={{ background: addMsg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${addMsg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: addMsg.type === 'error' ? '#FCA5A5' : '#86EFAC', marginBottom: 14 }}>{addMsg.text}</div>}
          {showAddUser && (
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Inp label="Full Name" placeholder="e.g. James Carter" value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))}/>
                <Inp label="Email" type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}/>
                <Inp label="Temporary Password" type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}/>
                <Sel label="Role" value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="driver">Driver</option>
                  {flags.processor_enabled && <option value="processor">Processor</option>}
                </Sel>
                <Btn onClick={createTeamUser} disabled={!addForm.full_name || !addForm.email || !addForm.password || addSaving}>{addSaving ? 'Creating…' : 'Create Account'}</Btn>
              </div>
            </Card>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drivers.filter(d => ['driver', 'processor'].includes(d.role)).map(d => (
              <Card key={d.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{d.full_name}</div>
                    <Badge label={d.role.toUpperCase()} color={d.role === 'processor' ? '#A855F7' : '#F59E0B'}/>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* EDIT LOG TAB */}
      {tab === 'editlog' && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 16 }}>EDIT LOG ({jobEdits.length})</div>
          {jobEdits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>No edits logged yet.</div>
          ) : jobEdits.map(e => (
            <Card key={e.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{e.profiles?.full_name ?? 'Unknown'}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{new Date(e.created_at).toLocaleString()}</div>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                {e.field_changed && <span style={{ color: '#F59E0B', fontFamily: 'monospace', marginRight: 8 }}>{e.field_changed}</span>}
                {e.old_value && <span style={{ color: '#EF4444', marginRight: 4 }}>"{e.old_value}"</span>}
                {e.new_value && <span>→ <span style={{ color: '#22C55E' }}>"{e.new_value}"</span></span>}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px', fontStyle: 'italic' }}>
                Reason: {e.reason}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* SETTINGS TAB */}
      {tab === 'settings' && (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 16 }}>TEAM SETTINGS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Toggle label="Enable Processor Role" desc="Allows processor accounts to be created and used on your team" flagName="processor_enabled"/>
            <Toggle label="Driver Job Editing" desc="Allows drivers to edit completed jobs with a reason (logged)" flagName="driver_edit_enabled"/>
            <Toggle label="Processor Route Upload" desc="Allows processors to trace and upload routes" flagName="processor_route_upload"/>
          </div>
        </div>
      )}
    </div>
  )
}