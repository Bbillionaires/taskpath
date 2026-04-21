import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const DAY_RULES = ['weekday', 'saturday', 'sunday', 'special']
const ROLES = ['driver', 'dispatcher', 'supervisor', 'admin']

function Badge({ label, color = '#F59E0B' }) {
  return <span style={{ background: `${color}18`, border: `1px solid ${color}40`, color, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 0.5 }}>{label}</span>
}
function Card({ children, style = {} }) {
  return <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, ...style }}>{children}</div>
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', letterSpacing: 1.5, marginBottom: 12 }}>{children}</div>
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
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? 'rgba(255,255,255,0.04)' : bg, border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : border}`, color: disabled ? 'rgba(255,255,255,0.2)' : txt, borderRadius: 10, padding: small ? '6px 12px' : '10px 18px', fontSize: small ? 11 : 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'monospace', letterSpacing: 0.3 }}>{children}</button>
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isYellow(r, g, b) {
  return r > 160 && g > 140 && b < 100 && r > b + 80 && g > b + 60
}

function simplifyPoints(points, tolerance = 0.00003) {
  if (points.length < 3) return points
  const result = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const dist = Math.sqrt((curr[0] - prev[0]) ** 2 + (curr[1] - prev[1]) ** 2)
    if (dist > tolerance) result.push(curr)
  }
  result.push(points[points.length - 1])
  return result
}

function pixelToGPS(px, py, controlPoints) {
  const [p1, p2] = controlPoints
  const dx_px = p2.px - p1.px
  const dy_px = p2.py - p1.py
  const dx_gps = p2.gps[1] - p1.gps[1]
  const dy_gps = p2.gps[0] - p1.gps[0]
  const scaleX = dx_gps / dx_px
  const scaleY = dy_gps / dy_py || dy_gps / (dy_px || 1)
  const lng = p1.gps[1] + (px - p1.px) * scaleX
  const lat = p1.gps[0] + (py - p1.py) * (dy_gps / (dy_px || 1))
  return [lat, lng]
}

function extractYellowRoute(canvas, controlPoints) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const yellowPixels = []
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4
      const r = data[idx], g = data[idx + 1], b = data[idx + 2]
      if (isYellow(r, g, b)) yellowPixels.push([x, y])
    }
  }

  if (yellowPixels.length < 10) return []

  // Sort pixels into a path by nearest neighbor
  const visited = new Set()
  const path = []
  let current = yellowPixels[0]
  visited.add(0)

  for (let i = 0; i < Math.min(yellowPixels.length, 5000); i++) {
    path.push(current)
    let minDist = Infinity
    let nextIdx = -1
    for (let j = 0; j < yellowPixels.length; j++) {
      if (visited.has(j)) continue
      const dx = yellowPixels[j][0] - current[0]
      const dy = yellowPixels[j][1] - current[1]
      const dist = dx * dx + dy * dy
      if (dist < minDist) { minDist = dist; nextIdx = j }
    }
    if (nextIdx === -1 || minDist > 2000) break
    visited.add(nextIdx)
    current = yellowPixels[nextIdx]
  }

  // Convert pixels to GPS
  const [p1, p2] = controlPoints
  const dx_px = p2.px - p1.px || 1
  const dy_px = p2.py - p1.py || 1
  const dx_gps_lng = p2.gps[1] - p1.gps[1]
  const dy_gps_lat = p2.gps[0] - p1.gps[0]

  const gpsPath = path.map(([px, py]) => {
    const lng = p1.gps[1] + (px - p1.px) * (dx_gps_lng / dx_px)
    const lat = p1.gps[0] + (py - p1.py) * (dy_gps_lat / dy_px)
    return [lat, lng]
  })

  return simplifyPoints(gpsPath, 0.00005)
}

// ── Route Tracer with PDF ──────────────────────────────────────────────────
function RouteTracer({ route, onClose, onSaved }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const polylineRef = useRef(null)
  const markersRef = useRef([])
  const pointsRef = useRef([])
  const canvasRef = useRef(null)
  const pdfOverlayRef = useRef(null)
  const cpMarkersRef = useRef([])

  const [step, setStep] = useState('start') // start | pdf | align | preview | manual
  const [pointCount, setPointCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [opacity, setOpacity] = useState(0.6)
  const [pdfReady, setPdfReady] = useState(false)
  const [controlPoints, setControlPoints] = useState([]) // [{px, py, gps}]
  const [cpMode, setCpMode] = useState(null) // 'pdf' | 'map' | null
  const [extractedRoute, setExtractedRoute] = useState([])
  const [extracting, setExtracting] = useState(false)
  const [pdfBounds, setPdfBounds] = useState(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView([30.3322, -81.6557], 14)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map)

    // Load existing route if any
    if (route.geojson) {
      try {
        const geo = typeof route.geojson === 'string' ? JSON.parse(route.geojson) : route.geojson
        const coords = geo.coordinates ?? geo.features?.[0]?.geometry?.coordinates
        if (coords) {
          pointsRef.current = coords.map(c => [c[1], c[0]])
          setPointCount(pointsRef.current.length)
          polylineRef.current = L.polyline(pointsRef.current, { color: '#F59E0B', weight: 4 }).addTo(map)
          map.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] })
        }
      } catch (e) {}
    }

    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  async function handlePDFUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 2.5 })
    const canvas = canvasRef.current
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    setPdfReady(true)
    setStep('align')
    setMsg({ type: 'info', text: 'PDF loaded. Now set 2 control points — click a recognizable intersection on the PDF, then the same spot on the satellite map.' })
  }

  function handlePDFClick(e) {
    if (cpMode !== 'pdf') return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY

    const existing = controlPoints.find(cp => cp.step === controlPoints.length && !cp.gps)
    if (!existing) {
      const newCp = { px, py, gps: null, id: controlPoints.length }
      setControlPoints(prev => [...prev, newCp])
      setCpMode('map')
      setMsg({ type: 'info', text: `Control point ${controlPoints.length + 1} set on PDF. Now click the same intersection on the satellite map.` })
    }
  }

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || cpMode !== 'map') return

    function onMapClick(e) {
      const { lat, lng } = e.latlng
      setControlPoints(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && !last.gps) {
          last.gps = [lat, lng]
          const marker = L.circleMarker([lat, lng], { radius: 8, color: '#22C55E', fillColor: '#22C55E', fillOpacity: 1 }).addTo(map)
          cpMarkersRef.current.push(marker)
        }
        return updated
      })

      if (controlPoints.length >= 1) {
        setCpMode(null)
        if (controlPoints.length + 1 >= 2) {
          setMsg({ type: 'success', text: '2 control points set! Ready to extract yellow route.' })
          setStep('extract')
        } else {
          setCpMode('pdf')
          setMsg({ type: 'info', text: 'Set control point 2 on the PDF.' })
        }
      }
    }

    map.on('click', onMapClick)
    return () => map.off('click', onMapClick)
  }, [cpMode, controlPoints])

  function extractRoute() {
    const completeCPs = controlPoints.filter(cp => cp.gps)
    if (completeCPs.length < 2) { setMsg({ type: 'error', text: 'Need 2 complete control points first.' }); return }
    setExtracting(true)
    setTimeout(() => {
      try {
        const route = extractYellowRoute(canvasRef.current, completeCPs)
        if (route.length < 5) {
          setMsg({ type: 'error', text: 'Could not detect yellow route. Try adjusting control points or use manual tracing.' })
          setExtracting(false)
          return
        }
        setExtractedRoute(route)
        pointsRef.current = route
        setPointCount(route.length)

        const map = mapInstanceRef.current
        if (polylineRef.current) map.removeLayer(polylineRef.current)
        polylineRef.current = L.polyline(route, { color: '#F59E0B', weight: 4 }).addTo(map)
        map.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] })
        setStep('preview')
        setMsg({ type: 'success', text: `Extracted ${route.length} GPS points from yellow line! Review and save or refine manually.` })
      } catch (err) {
        setMsg({ type: 'error', text: 'Extraction failed. Try manual tracing.' })
      }
      setExtracting(false)
    }, 100)
  }

  // Manual trace mode
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || step !== 'manual') return

    function onMapClick(e) {
      const pt = [e.latlng.lat, e.latlng.lng]
      pointsRef.current.push(pt)
      setPointCount(pointsRef.current.length)
      const isFirst = pointsRef.current.length === 1
      const m = L.circleMarker(pt, { radius: isFirst ? 7 : 4, color: isFirst ? '#22C55E' : '#F59E0B', fillColor: isFirst ? '#22C55E' : '#F59E0B', fillOpacity: 1 }).addTo(map)
      markersRef.current.push(m)
      if (polylineRef.current) polylineRef.current.setLatLngs(pointsRef.current)
      else polylineRef.current = L.polyline(pointsRef.current, { color: '#F59E0B', weight: 4 }).addTo(map)
    }

    map.on('click', onMapClick)
    return () => map.off('click', onMapClick)
  }, [step])

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
    cpMarkersRef.current.forEach(m => mapInstanceRef.current.removeLayer(m))
    cpMarkersRef.current = []
    if (polylineRef.current) { mapInstanceRef.current.removeLayer(polylineRef.current); polylineRef.current = null }
    setControlPoints([])
    setExtractedRoute([])
    setStep('start')
    setMsg(null)
  }

  // Update PDF overlay opacity
  useEffect(() => {
    if (pdfOverlayRef.current) pdfOverlayRef.current.setOpacity(opacity)
  }, [opacity])

  async function saveRoute() {
    if (pointsRef.current.length < 2) { setMsg({ type: 'error', text: 'Need at least 2 points' }); return }
    setSaving(true)
    const geojson = { type: 'LineString', coordinates: pointsRef.current.map(p => [p[1], p[0]]) }
    const { error } = await supabase.from('routes').update({ geojson }).eq('id', route.id)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setMsg({ type: 'success', text: 'Route saved!' }); setTimeout(() => { onSaved(); onClose() }, 1000) }
    setSaving(false)
  }

  const completeCPs = controlPoints.filter(cp => cp.gps)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0A0F1A', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>← Back</button>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Tracing: <span style={{ color: '#F59E0B' }}>{route.name}</span></div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{pointCount} pts</div>

        {/* Step indicators */}
        {['start','align','extract','preview','manual'].map((s, i) => (
          <div key={s} style={{ fontSize: 9, fontFamily: 'monospace', padding: '3px 8px', borderRadius: 6, background: step === s ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.04)', color: step === s ? '#F59E0B' : 'rgba(255,255,255,0.25)', border: `1px solid ${step === s ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
            {i + 1}. {s.toUpperCase()}
          </div>
        ))}

        {step === 'manual' && <Btn small color="#FB923C" onClick={undoLast} disabled={pointCount === 0}>↩ Undo</Btn>}
        <Btn small danger onClick={clearAll} disabled={pointCount === 0 && controlPoints.length === 0}>Clear</Btn>
        <Btn small onClick={saveRoute} disabled={pointCount < 2 || saving} color="#22C55E">{saving ? 'Saving…' : '✓ Save'}</Btn>
      </div>

      {/* Status message */}
      {msg && (
        <div style={{ padding: '8px 16px', background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : msg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)', fontSize: 11, color: msg.type === 'error' ? '#FCA5A5' : msg.type === 'success' ? '#86EFAC' : '#93C5FD', fontFamily: 'monospace' }}>
          {msg.text}
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left panel — PDF */}
        <div style={{ width: pdfReady ? 420 : 300, borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', background: '#0D1421', flexShrink: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', letterSpacing: 1, marginBottom: 8 }}>PDF MAP</div>

            {!pdfReady ? (
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12, lineHeight: 1.6 }}>
                  Upload the city-issued PDF route map. The yellow line will be automatically extracted and aligned to GPS coordinates.
                </div>
                <label style={{ display: 'block', background: 'rgba(245,158,11,0.1)', border: '1px dashed rgba(245,158,11,0.4)', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', color: '#F59E0B', fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>
                  📄 Upload PDF Map
                  <input type="file" accept=".pdf" onChange={handlePDFUpload} style={{ display: 'none' }}/>
                </label>
                <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'monospace' }}>OR trace manually:</div>
                  <Btn small color="#3B82F6" onClick={() => setStep('manual')}>✎ Manual Trace</Btn>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                  Control points: {completeCPs.length}/2
                </div>
                {step === 'align' && completeCPs.length < 2 && (
                  <Btn small color="#3B82F6" onClick={() => setCpMode('pdf')}>
                    {cpMode === 'pdf' ? '🎯 Click intersection on PDF…' : `+ Set Point ${completeCPs.length + 1}`}
                  </Btn>
                )}
                {step === 'extract' && (
                  <Btn small color="#22C55E" onClick={extractRoute} disabled={extracting}>
                    {extracting ? 'Extracting…' : '⚡ Auto-Extract Yellow Route'}
                  </Btn>
                )}
                {(step === 'preview' || step === 'extract') && (
                  <Btn small color="#3B82F6" onClick={() => setStep('manual')}>✎ Refine Manually</Btn>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>PDF OPACITY</label>
                  <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ width: '100%' }}/>
                </div>
              </div>
            )}
          </div>

          {/* PDF canvas */}
          <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
            <canvas
              ref={canvasRef}
              onClick={handlePDFClick}
              style={{ display: pdfReady ? 'block' : 'none', width: '100%', cursor: cpMode === 'pdf' ? 'crosshair' : 'default', border: cpMode === 'pdf' ? '2px solid #3B82F6' : 'none' }}
            />
            {!pdfReady && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.15)', fontSize: 12, fontFamily: 'monospace' }}>
                PDF will appear here
              </div>
            )}
            {/* Control point markers on PDF */}
            {controlPoints.map((cp, i) => (
              <div key={i} style={{ position: 'absolute', left: `${(cp.px / (canvasRef.current?.width || 1)) * 100}%`, top: `${(cp.py / (canvasRef.current?.height || 1)) * 100}%`, transform: 'translate(-50%,-50%)', width: 16, height: 16, borderRadius: '50%', background: cp.gps ? '#22C55E' : '#3B82F6', border: '2px solid #fff', pointerEvents: 'none', zIndex: 10 }}>
                <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: '#fff', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>P{i + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — Satellite map */}
        <div style={{ flex: 1, position: 'relative' }}>
          {cpMode === 'map' && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(59,130,246,0.9)', borderRadius: 8, padding: '6px 14px', fontSize: 11, color: '#fff', fontFamily: 'monospace', fontWeight: 700 }}>
              🎯 Click the same intersection on the satellite map
            </div>
          )}
          {step === 'manual' && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(245,158,11,0.9)', borderRadius: 8, padding: '6px 14px', fontSize: 11, color: '#000', fontFamily: 'monospace', fontWeight: 700 }}>
              🖊 Click on map to trace route manually
            </div>
          )}
          <div ref={mapRef} style={{ width: '100%', height: '100%' }}/>
        </div>
      </div>
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

  if (tracingRoute) return <RouteTracer route={tracingRoute} onClose={() => setTracingRoute(null)} onSaved={loadAll}/>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>ROUTES ({routes.length})</SectionTitle>
        <Btn small onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Route'}</Btn>
      </div>
      {msg && <div style={{ background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>{msg.text}</div>}
      {showForm && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Inp label="Route name" placeholder="e.g. Zone 7A · Norris Canyon Rd" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/>
            <Inp label="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/>
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
              <Btn small color="#3B82F6" onClick={() => setTracingRoute(route)}>{route.geojson ? '✎ Edit Route' : '+ Trace Route'}</Btn>
              <Btn small onClick={() => setExpanded(expanded === route.id ? null : route.id)}>{expanded === route.id ? 'Close' : 'Manage'}</Btn>
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
    const response = await fetch('/api/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, password: form.password, full_name: form.full_name, role: form.role, zone_id: form.zone_id }) })
    const data = await response.json()
    if (!response.ok) setMsg({ type: 'error', text: data.error ?? 'Failed to create user' })
    else { setMsg({ type: 'success', text: `Account created for ${form.full_name}!` }); setForm({ full_name: '', email: '', password: '', role: 'driver', zone_id: '' }); setShowForm(false); loadAll() }
    setSaving(false)
    setTimeout(() => setMsg(null), 3000)
  }

  async function updateRole(profileId, role) { await supabase.from('profiles').update({ role }).eq('id', profileId); loadAll() }
  const roleColor = { driver: '#F59E0B', supervisor: '#3B82F6', admin: '#A855F7', dispatcher: '#14B8A6' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>TEAM MEMBERS ({drivers.length})</SectionTitle>
        <Btn small onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New User'}</Btn>
      </div>
      {msg && <div style={{ background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>{msg.text}</div>}
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
            <Btn onClick={createDriver} disabled={!form.full_name || !form.email || !form.password || saving}>{saving ? 'Creating…' : 'Create Account'}</Btn>
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
      {msg && <div style={{ background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: msg.type === 'error' ? '#FCA5A5' : '#86EFAC' }}>{msg.text}</div>}
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
            <Btn onClick={saveAssignment} disabled={!form.driver_id || !form.route_id || saving}>{saving ? 'Saving…' : 'Create Assignment'}</Btn>
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
        <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)', borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}>Sign out</button>
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