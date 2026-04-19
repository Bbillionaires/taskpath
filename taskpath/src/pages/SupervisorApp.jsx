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

// Calculate bearing between two lat/lng points
function bearing(lat1, lng1, lat2, lng2) {
  const dL = (lng2 - lng1) * Math.PI / 180
  const l1 = lat1 * Math.PI / 180
  const l2 = lat2 * Math.PI / 180
  const y = Math.sin(dL) * Math.cos(l2)
  const x = Math.cos(l1) * Math.sin(l2) - Math.sin(l1) * Math.cos(l2) * Math.cos(dL)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// Offset a point perpendicular to a bearing by distMeters
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

// ── Leaflet map for supervisor ─────────────────────────────────────────────
function SupervisorMap({ assignments, driverLocations, jobRecords }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const layersRef = useRef({})

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
      .setView([30.3322, -81.6557], 12) // Jacksonville default

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map)
    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  // Draw planned route lines
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

  // Draw completed job coverage — left lane (green) + right lane (blue) + median (dashed white)
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
        layersRef.current[`cov_l_${ri}_${j}`] = L.polyline([leftPrev,  leftCurr],  { color: '#22C55E', weight: 3, opacity: 0.85 }).addTo(map)
        layersRef.current[`cov_m_${ri}_${j}`] = L.polyline([[prev[1], prev[0]], [coord[1], coord[0]]], { color: 'rgba(255,255,255,0.35)', weight: 1.5, dashArray: '3,5' }).addTo(map)
      })
    })
  }, [jobRecords])

  // Live driver markers with directional arrows
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    // Remove stale driver markers
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

      if (layersRef.current[key]) {
        layersRef.current[key].setLatLng([dl.lat, dl.lng])
        layersRef.current[key].setIcon(icon)
      } else {
        layersRef.current[key] = L.marker([dl.lat, dl.lng], { icon }).addTo(map)
      }
    })
  }, [driverLocations])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
}

// ── Main SupervisorApp ─────────────────────────────────────────────────────
export default function SupervisorApp() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('live')
  const [assignments, setAssignments] = useState([])
  const [drivers, setDrivers] = useState([])
  const [driverLocations, setDriverLocations] = useState([])
  const [jobRecords, setJobRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDriver, setExpandedDriver] = useState(null)
  const [vehicleForms, setVehicleForms] = useState({})
  const [savingProfile, setSavingProfile] = useState(null)

  // Add team user form
  const [showAddUser, setShowAddUser] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', email: '', password: '', role: 'supervisor' })
  const [addSaving, setAddSaving] = useState(false)
  const [addMsg, setAddMsg] = useState(null)

  useEffect(() => {
    loadAll()
    const channel = supabase.channel('supervisor-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, loadDriverLocations)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assignments' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function loadAll() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: a }, { data: d }, { data: r }] = await Promise.all([
      supabase.from('assignments')
        .select('*, profiles(id,full_name,role), routes(id,name,geojson), schedule_variants(label,day_rule)')
        .eq('scheduled_date', today)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('job_records')
        .select('*, routes(name)')
        .gte('started_at', new Date(Date.now() - 24*3600*1000).toISOString())
        .order('started_at', { ascending: false }),
    ])
    setAssignments(a ?? [])
    setDrivers(d ?? [])
    setJobRecords(r ?? [])
    const forms = {}
    ;(d ?? []).forEach(dr => {
      forms[dr.id] = {
        vehicle_tag:       dr.vehicle_tag ?? '',
        insurance_policy:  dr.insurance_policy ?? '',
        vehicle_make_model:dr.vehicle_make_model ?? '',
        vehicle_owner:     dr.vehicle_owner ?? '',
        vehicle_company:   dr.vehicle_company ?? '',
        scheduled_hours:   dr.scheduled_hours ?? '',
        pay_rate:          dr.pay_rate ?? '',
        notes:             dr.notes ?? '',
      }
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

  async function createTeamUser() {
    setAddSaving(true)
    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    const data = await res.json()
    if (!res.ok) {
      setAddMsg({ type: 'error', text: data.error ?? 'Failed to create user' })
    } else {
      setAddMsg({ type: 'success', text: `Account created for ${addForm.full_name}!` })
      setAddForm({ full_name: '', email: '', password: '', role: 'supervisor' })
      setShowAddUser(false)
      loadAll()
    }
    setAddSaving(false)
    setTimeout(() => setAddMsg(null), 3000)
  }

  // Shared input components
  const Inp = ({ label, ...props }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      <input {...props} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', ...props.style }}/>
    </div>
  )
  const Sel = ({ label, children, ...props }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{label}</label>}
      <select {...props} style={{ background: '#1A2235', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', ...props.style }}>{children}</select>
    </div>
  )

  const activeCount = assignments.filter(a => ['in_progress', 'paused'].includes(a.status)).length

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
          <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)', borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', display: 'flex', gap: 4 }}>
        {[{ id: 'live', label: 'Live Map' }, { id: 'drivers', label: 'Drivers' }, { id: 'team', label: 'Team' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none',
            color: tab === t.id ? '#F59E0B' : 'rgba(255,255,255,0.35)',
            padding: '12px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            borderBottom: tab === t.id ? '2px solid #F59E0B' : '2px solid transparent',
            marginBottom: -1, letterSpacing: 0.3,
          }}>{t.label}</button>
        ))}
      </div>

      {/* LIVE TAB */}
      {tab === 'live' && (
        <div style={{ display: 'flex', height: 'calc(100vh - 112px)' }}>
          {/* Sidebar */}
          <div style={{ width: 310, borderRight: '1px solid rgba(255,255,255,0.07)', overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>
              TODAY · {assignments.length} ASSIGNMENTS
            </div>
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
                        <button key={act.status} onClick={() => updateStatus(a.id, act.status)} style={{
                          background: `${act.color}18`, border: `1px solid ${act.color}40`, color: act.color,
                          borderRadius: 7, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
                        }}>{act.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Map legend */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 8 }}>MAP LEGEND</div>
              {[
                ['─ ─ ─', '#F59E0B', 'Planned route'],
                ['────', '#3B82F6', 'Right lane swept'],
                ['────', '#22C55E', 'Left lane swept'],
                ['· · ·', 'rgba(255,255,255,0.4)', 'Median centerline'],
              ].map(([sym, color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ color, fontFamily: 'monospace', fontSize: 12, width: 30, textAlign: 'center' }}>{sym}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Map */}
          <div style={{ flex: 1, padding: 16 }}>
            <SupervisorMap
              assignments={assignments}
              driverLocations={driverLocations}
              jobRecords={jobRecords}
            />
          </div>
        </div>
      )}

      {/* DRIVERS TAB */}
      {tab === 'drivers' && (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 16 }}>
            DRIVERS · {drivers.filter(d => d.role === 'driver').length} total
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {drivers.filter(d => d.role === 'driver').map(d => (
              <div key={d.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
                <div onClick={() => setExpandedDriver(expandedDriver === d.id ? null : d.id)}
                  style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
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
                      <Inp label="Vehicle Tag / Plate" placeholder="e.g. ABC-1234" value={vehicleForms[d.id].vehicle_tag} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_tag: e.target.value }}))}/>
                      <Inp label="Make & Model" placeholder="e.g. 2022 Elgin Pelican" value={vehicleForms[d.id].vehicle_make_model} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_make_model: e.target.value }}))}/>
                      <Inp label="Insurance Policy #" placeholder="e.g. POL-001234" value={vehicleForms[d.id].insurance_policy} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], insurance_policy: e.target.value }}))}/>
                      <Inp label="Vehicle Owner" placeholder="e.g. John Smith" value={vehicleForms[d.id].vehicle_owner} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_owner: e.target.value }}))}/>
                      <Inp label="Owner Company" placeholder="e.g. Smith Fleet LLC" value={vehicleForms[d.id].vehicle_company} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], vehicle_company: e.target.value }}))}/>
                      <Inp label="Scheduled Hours" placeholder="e.g. Mon–Fri 6AM–2PM" value={vehicleForms[d.id].scheduled_hours} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], scheduled_hours: e.target.value }}))}/>
                      <Inp label="Pay Rate" placeholder="e.g. $22/hr" value={vehicleForms[d.id].pay_rate} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], pay_rate: e.target.value }}))}/>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', display: 'block', marginBottom: 5 }}>Notes</label>
                      <textarea value={vehicleForms[d.id].notes} onChange={e => setVehicleForms(f => ({ ...f, [d.id]: { ...f[d.id], notes: e.target.value }}))}
                        placeholder="Notes about this driver…"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}/>
                    </div>
                    <button onClick={() => saveDriverProfile(d.id)} disabled={savingProfile === d.id} style={{
                      background: savingProfile === d.id ? 'rgba(255,255,255,0.04)' : 'rgba(59,130,246,0.15)',
                      border: `1px solid ${savingProfile === d.id ? 'rgba(255,255,255,0.08)' : 'rgba(59,130,246,0.4)'}`,
                      color: savingProfile === d.id ? 'rgba(255,255,255,0.2)' : '#93C5FD',
                      borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 700,
                      cursor: savingProfile === d.id ? 'not-allowed' : 'pointer', fontFamily: 'monospace',
                    }}>{savingProfile === d.id ? 'Saving…' : 'Save Profile'}</button>
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
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5 }}>SUPERVISORS & ADMINS</div>
            <button onClick={() => setShowAddUser(!showAddUser)} style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B', borderRadius: 10, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace' }}>
              {showAddUser ? 'Cancel' : '+ Add User'}
            </button>
          </div>

          {addMsg && (
            <div style={{ background: addMsg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${addMsg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: addMsg.type === 'error' ? '#FCA5A5' : '#86EFAC', marginBottom: 14 }}>
              {addMsg.text}
            </div>
          )}

          {showAddUser && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Inp label="Full Name" placeholder="e.g. Sarah Johnson" value={addForm.full_name} onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))}/>
                <Inp label="Email" type="email" placeholder="supervisor@company.com" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}/>
                <Inp label="Temporary Password" type="password" placeholder="Min 8 characters" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}/>
                <Sel label="Role" value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </Sel>
                <button onClick={createTeamUser} disabled={!addForm.full_name || !addForm.email || !addForm.password || addSaving} style={{
                  background: (!addForm.full_name || !addForm.email || !addForm.password || addSaving) ? 'rgba(255,255,255,0.04)' : 'rgba(245,158,11,0.15)',
                  border: `1px solid ${(!addForm.full_name || !addForm.email || !addForm.password || addSaving) ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.4)'}`,
                  color: (!addForm.full_name || !addForm.email || !addForm.password || addSaving) ? 'rgba(255,255,255,0.2)' : '#F59E0B',
                  borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 700,
                  cursor: (!addForm.full_name || !addForm.email || !addForm.password || addSaving) ? 'not-allowed' : 'pointer', fontFamily: 'monospace',
                }}>{addSaving ? 'Creating…' : 'Create Account'}</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drivers.filter(d => ['supervisor', 'admin'].includes(d.role)).map(d => (
              <div key={d.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{d.full_name}</div>
                  <span style={{
                    background: d.role === 'admin' ? 'rgba(168,85,247,0.15)' : 'rgba(59,130,246,0.15)',
                    border: `1px solid ${d.role === 'admin' ? 'rgba(168,85,247,0.4)' : 'rgba(59,130,246,0.4)'}`,
                    color: d.role === 'admin' ? '#D8B4FE' : '#93C5FD',
                    borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                  }}>{d.role.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}