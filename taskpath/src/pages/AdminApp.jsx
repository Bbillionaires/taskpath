import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import * as pdfjsLib from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'

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

// ── Road name extraction from PDF text ────────────────────────────────────
const ROAD_RE = /\b([A-Z][a-zA-Z\s]{2,40}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Terrace|Ter|Trail|Run|Loop|Path)\.?)\b/g

function extractRoadNames(textItems, canvasHeight) {
  const found = new Map()
  for (const item of textItems) {
    if (!item.str || item.str.trim().length < 4) continue
    const matches = [...item.str.matchAll(ROAD_RE)]
    for (const m of matches) {
      const name = m[1].trim()
      const key = name.toLowerCase()
      if (!found.has(key)) {
        found.set(key, { name, x: item.x, y: item.y })
      }
    }
    // Also catch short labels like "Oak St" by checking suffix words
    const shortMatch = item.str.trim().match(/^([A-Z][a-zA-Z\s]{1,30}(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Pkwy|Hwy|Cir))\.?$/)
    if (shortMatch) {
      const name = shortMatch[1].trim()
      const key = name.toLowerCase()
      if (!found.has(key)) {
        found.set(key, { name, x: item.x, y: item.y })
      }
    }
  }
  return [...found.values()]
}

// ── Nominatim geocoder (rate-limited) ─────────────────────────────────────
async function geocodeRoad(roadName, cityHint) {
  const query = `${roadName}, ${cityHint}`
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`
    const res = await fetch(url, { headers: { 'User-Agent': 'TaskPath-RouteTracer/1.0' } })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.length) return null
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
  } catch {
    return null
  }
}

// ── Route Tracer ───────────────────────────────────────────────────────────
function RouteTracer({ route, onClose, onSaved }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const polylineRef = useRef(null)
  const markersRef = useRef([])
  const pointsRef = useRef([])
  const canvasRef = useRef(null)
  const cpMarkersRef = useRef([])
  const mapContainerRef = useRef(null)

  const [step, setStep] = useState('start')
  const [pointCount, setPointCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [opacity, setOpacity] = useState(0.5)
  const [pdfReady, setPdfReady] = useState(false)
  const [controlPoints, setControlPoints] = useState([])
  const [cpMode, setCpMode] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [roadMatches, setRoadMatches] = useState([]) // [{name, x, y, gps}]
  const [geocodingProgress, setGeocodingProgress] = useState(null) // {done, total}
  const [geocodingDone, setGeocodingDone] = useState(false)

  // Init Leaflet map
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
        }
      } catch (e) {}
    }

    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  // ── PDF Upload: render → Tesseract OCR (handles all PDF types) → geocode ──
  async function handlePDFUpload(e) {
    const file = e.target.files[0]
    if (!file) return

    setMsg({ type: 'info', text: 'Rendering PDF…' })
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)
    const scale = 2.5
    const viewport = page.getViewport({ scale })

    const canvas = canvasRef.current
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    setPdfReady(true)

    // Tesseract OCR — reads embedded text, vector text, and scanned images
    setMsg({ type: 'info', text: 'Scanning map for road names…' })
    let roads = []
    try {
      const worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            setMsg({ type: 'info', text: `Reading road names from map… ${Math.round((m.progress ?? 0) * 100)}%` })
          }
        }
      })
      const { data } = await worker.recognize(canvas)
      await worker.terminate()

      // Line-level keeps "El Camino Real" together instead of splitting word-by-word
      const ocrItems = data.lines.map(line => ({
        str: line.text.trim(),
        x: (line.bbox.x0 + line.bbox.x1) / 2,
        y: (line.bbox.y0 + line.bbox.y1) / 2,
      })).filter(i => i.str.length > 2)

      roads = extractRoadNames(ocrItems, viewport.height)
    } catch {
      setStep('align')
      setMsg({ type: 'error', text: 'OCR failed. Set control points manually or trace manually.' })
      return
    }

    if (roads.length < 2) {
      setStep('align')
      setMsg({ type: 'error', text: `Only found ${roads.length} road name(s) — need at least 2. Set control points manually or trace manually.` })
      return
    }

    setMsg({ type: 'info', text: `Found ${roads.length} road names. Matching to satellite map…` })
    setStep('geocoding')

    // Geocode each road — Nominatim needs 1 req/sec
    const cityHint = route.zones?.city
      ? `${route.zones.city}, ${route.zones.state ?? 'FL'}`
      : 'Jacksonville, FL'

    const matched = []
    const toGeocode = roads.slice(0, 10) // cap at 10 to avoid long waits

    for (let i = 0; i < toGeocode.length; i++) {
      setGeocodingProgress({ done: i, total: toGeocode.length, current: toGeocode[i].name })
      const gps = await geocodeRoad(toGeocode[i].name, cityHint)
      if (gps) matched.push({ ...toGeocode[i], gps })
      if (i < toGeocode.length - 1) await new Promise(r => setTimeout(r, 1100)) // rate limit
    }

    setGeocodingProgress(null)
    setGeocodingDone(true)

    if (matched.length < 2) {
      setStep('align')
      setMsg({ type: 'error', text: `Only matched ${matched.length} road${matched.length === 1 ? '' : 's'} — need at least 2. Set control points manually, or check that the zone city is correct.` })
      return
    }

    // Plot matched roads on map as green dots
    const map = mapInstanceRef.current
    matched.forEach((r, i) => {
      const marker = L.circleMarker(r.gps, {
        radius: 9, color: '#22C55E', fillColor: '#22C55E', fillOpacity: 0.9, weight: 2
      }).addTo(map)
      marker.bindTooltip(r.name, { permanent: false, direction: 'top' })
      cpMarkersRef.current.push(marker)
    })

    // Pan map to matched area
    const bounds = L.latLngBounds(matched.map(r => r.gps))
    map.fitBounds(bounds, { padding: [60, 60] })

    setRoadMatches(matched)

    // Use best 2 spread-out control points (pick first + most-distant from first)
    const p1 = matched[0]
    let p2 = matched[1]
    let maxDist = 0
    for (const r of matched.slice(1)) {
      const d = Math.sqrt((r.gps[0] - p1.gps[0]) ** 2 + (r.gps[1] - p1.gps[1]) ** 2)
      if (d > maxDist) { maxDist = d; p2 = r }
    }

    const cps = [
      { id: 0, px: p1.x, py: p1.y, gps: p1.gps, name: p1.name },
      { id: 1, px: p2.x, py: p2.y, gps: p2.gps, name: p2.name },
    ]
    setControlPoints(cps)

    setStep('extract')
    setMsg({ type: 'success', text: `Matched ${matched.length} roads to satellite map! Ready to auto-extract route.` })
  }

  // Click on overlay canvas = PDF click for manual CP
  function handleOverlayClick(e) {
    if (cpMode !== 'pdf') return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    const newCp = { px, py, gps: null, id: controlPoints.length }
    setControlPoints(prev => [...prev, newCp])
    setCpMode('map')
    setMsg({ type: 'info', text: `Point ${controlPoints.length + 1} marked on PDF. Now click the same intersection on the satellite map.` })
  }

  // Map click handler — manual CPs or manual tracing
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    function onMapClick(e) {
      const { lat, lng } = e.latlng

      if (cpMode === 'map') {
        setControlPoints(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last && !last.gps) {
            last.gps = [lat, lng]
            const marker = L.circleMarker([lat, lng], { radius: 10, color: '#22C55E', fillColor: '#22C55E', fillOpacity: 1, weight: 3 }).addTo(map)
            marker.bindTooltip(`P${updated.length}`, { permanent: true, direction: 'top' })
            cpMarkersRef.current.push(marker)
          }
          return updated
        })
        setControlPoints(prev => {
          const completedCount = prev.filter(cp => cp.gps).length
          if (completedCount >= 2) {
            setCpMode(null); setStep('extract')
            setMsg({ type: 'success', text: '2 control points set! Click Auto-Extract to detect the route.' })
          } else {
            setCpMode('pdf')
            setMsg({ type: 'info', text: `Good! Now set Point ${completedCount + 1} — click PDF overlay first.` })
          }
          return prev
        })
        return
      }

      if (step === 'manual') {
        const pt = [lat, lng]
        pointsRef.current.push(pt)
        setPointCount(pointsRef.current.length)
        const isFirst = pointsRef.current.length === 1
        const m = L.circleMarker(pt, { radius: isFirst ? 7 : 4, color: isFirst ? '#22C55E' : '#F59E0B', fillColor: isFirst ? '#22C55E' : '#F59E0B', fillOpacity: 1 }).addTo(map)
        markersRef.current.push(m)
        if (polylineRef.current) polylineRef.current.setLatLngs(pointsRef.current)
        else polylineRef.current = L.polyline(pointsRef.current, { color: '#F59E0B', weight: 4 }).addTo(map)
      }
    }
    map.on('click', onMapClick)
    return () => map.off('click', onMapClick)
  }, [cpMode, step])

  function extractRoute() {
    const completeCPs = controlPoints.filter(cp => cp.gps)
    if (completeCPs.length < 2) { setMsg({ type: 'error', text: 'Need 2 control points first.' }); return }
    setExtracting(true)
    setTimeout(() => {
      try {
        const extracted = extractYellowRoute(canvasRef.current, completeCPs)
        if (extracted.length < 5) {
          setMsg({ type: 'error', text: 'No yellow route detected. Try manual tracing.' })
          setExtracting(false); return
        }
        pointsRef.current = extracted
        setPointCount(extracted.length)
        const map = mapInstanceRef.current
        if (polylineRef.current) map.removeLayer(polylineRef.current)
        polylineRef.current = L.polyline(extracted, { color: '#F59E0B', weight: 4 }).addTo(map)
        map.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] })
        setStep('preview')
        setMsg({ type: 'success', text: `Extracted ${extracted.length} GPS points! Review the yellow line, then save or refine manually.` })
      } catch {
        setMsg({ type: 'error', text: 'Extraction failed. Try manual tracing.' })
      }
      setExtracting(false)
    }, 100)
  }

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
    setRoadMatches([])
    setStep(pdfReady ? 'align' : 'start')
    setMsg(null)
    setCpMode(null)
    setGeocodingDone(false)
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

  const completeCPs = controlPoints.filter(cp => cp.gps)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0A0F1A', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>

      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#0D1421' }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}>← Back</button>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Tracing: <span style={{ color: '#F59E0B' }}>{route.name}</span></div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{pointCount} pts</div>
        {step === 'manual' && <Btn small color="#FB923C" onClick={undoLast} disabled={pointCount === 0}>↩ Undo</Btn>}
        <Btn small danger onClick={clearAll} disabled={pointCount === 0 && controlPoints.length === 0 && !pdfReady}>Clear</Btn>
        <Btn small onClick={saveRoute} disabled={pointCount < 2 || saving} color="#22C55E">{saving ? 'Saving…' : '✓ Save'}</Btn>
      </div>

      {/* Status message */}
      {msg && (
        <div style={{ padding: '8px 16px', background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : msg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)', fontSize: 11, color: msg.type === 'error' ? '#FCA5A5' : msg.type === 'success' ? '#86EFAC' : '#93C5FD', fontFamily: 'monospace' }}>
          {msg.text}
        </div>
      )}

      {/* Geocoding progress bar */}
      {geocodingProgress && (
        <div style={{ padding: '6px 16px', background: '#0D1421', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
              MATCHING: {geocodingProgress.current}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
              {geocodingProgress.done}/{geocodingProgress.total}
            </span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
            <div style={{ height: '100%', background: '#22C55E', borderRadius: 2, width: `${(geocodingProgress.done / geocodingProgress.total) * 100}%`, transition: 'width 0.3s' }}/>
          </div>
        </div>
      )}

      {/* Road matches panel — shown after geocoding */}
      {roadMatches.length > 0 && (
        <div style={{ padding: '6px 16px', background: '#0D1421', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>AUTO-MATCHED ROADS:</span>
          {roadMatches.map((r, i) => (
            <span key={i} style={{ fontSize: 10, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#86EFAC', borderRadius: 5, padding: '2px 7px', fontFamily: 'monospace' }}>
              ✓ {r.name}
            </span>
          ))}
        </div>
      )}

      {/* Controls bar — shown after PDF loaded */}
      {pdfReady && step !== 'geocoding' && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0D1421', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>PDF OPACITY</div>
          <input type="range" min={0} max={1} step={0.05} value={opacity}
            onChange={e => setOpacity(Number(e.target.value))}
            style={{ width: 100 }}/>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>{Math.round(opacity * 100)}%</div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }}/>

          {/* Manual CP fallback */}
          {step === 'align' && completeCPs.length < 2 && (
            <Btn small color="#3B82F6" onClick={() => { setCpMode('pdf'); setMsg({ type: 'info', text: 'Click a recognizable intersection on the PDF overlay.' }) }}>
              {cpMode === 'pdf' ? '🎯 Click PDF now…' : cpMode === 'map' ? '🗺 Click satellite now…' : `+ Manual Point ${completeCPs.length + 1}`}
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
        </div>
      )}

      {/* Map area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }} ref={mapContainerRef}>

        {/* Satellite map */}
        <div ref={mapRef} style={{ position: 'absolute', inset: 0 }}/>

        {/* PDF canvas — always mounted */}
        <canvas
          ref={canvasRef}
          onClick={handleOverlayClick}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: pdfReady ? opacity : 0,
            pointerEvents: pdfReady && cpMode === 'pdf' ? 'auto' : 'none',
            cursor: cpMode === 'pdf' ? 'crosshair' : 'default',
            zIndex: 500,
            display: 'block',
          }}
        />

        {/* Upload prompt — before PDF loaded */}
        {!pdfReady && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 600 }}>
            <div style={{ background: 'rgba(13,20,33,0.92)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 28, textAlign: 'center', maxWidth: 360 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Upload City Route PDF</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 20, lineHeight: 1.6 }}>
                Road names in the PDF are automatically matched to the satellite map — no manual alignment needed.
              </div>
              <label style={{ display: 'block', background: 'rgba(245,158,11,0.15)', border: '1px dashed rgba(245,158,11,0.5)', borderRadius: 10, padding: '18px 24px', cursor: 'pointer', color: '#F59E0B', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', marginBottom: 16 }}>
                📂 Choose PDF Map
                <input type="file" accept=".pdf" onChange={handlePDFUpload} style={{ display: 'none' }}/>
              </label>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginBottom: 12 }}>— or skip PDF and —</div>
              <Btn small color="#3B82F6" onClick={() => setStep('manual')}>✎ Trace Manually on Map</Btn>
            </div>
          </div>
        )}

        {/* Geocoding spinner overlay */}
        {step === 'geocoding' && (
          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(13,20,33,0.95)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '10px 20px', fontSize: 12, color: '#86EFAC', fontFamily: 'monospace', textAlign: 'center' }}>
            🛰 Matching road names to satellite map…
          </div>
        )}

        {/* Mode indicators */}
        {cpMode === 'pdf' && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(59,130,246,0.95)', borderRadius: 8, padding: '7px 16px', fontSize: 12, color: '#fff', fontFamily: 'monospace', fontWeight: 700 }}>
            🎯 Click a recognizable intersection on the PDF overlay
          </div>
        )}
        {cpMode === 'map' && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(34,197,94,0.95)', borderRadius: 8, padding: '7px 16px', fontSize: 12, color: '#000', fontFamily: 'monospace', fontWeight: 700 }}>
            🗺 Now click the SAME intersection on the satellite map
          </div>
        )}
        {step === 'manual' && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(245,158,11,0.95)', borderRadius: 8, padding: '7px 16px', fontSize: 12, color: '#000', fontFamily: 'monospace', fontWeight: 700 }}>
            🖊 Click on the map to trace the route manually
          </div>
        )}
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
  const [showZoneForm, setShowZoneForm] = useState(false)
  const [newZone, setNewZone] = useState({ name: '', city: '', state: '' })
  const [savingZone, setSavingZone] = useState(false)

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

  async function createZone() {
    setSavingZone(true)
    const { data, error } = await supabase.from('zones').insert({ name: newZone.name, city: newZone.city || 'Jacksonville', state: newZone.state || 'FL' }).select().single()
    if (!error) { setZones(prev => [...prev, data]); setForm(f => ({ ...f, zone_id: data.id })); setNewZone({ name: '', city: '', state: '' }); setShowZoneForm(false) }
    setSavingZone(false)
  }

  async function saveRoute() {
    setSaving(true)
    const zoneId = form.zone_id || (zones.length > 0 ? zones[0].id : null)
    if (!zoneId) { setMsg({ type: 'error', text: 'Please select or create a zone first.' }); setSaving(false); return }
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>ZONE</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={form.zone_id} onChange={e => setForm(f => ({ ...f, zone_id: e.target.value }))} style={{ background: '#1A2235', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', flex: 1 }}>
                  <option value="">Select zone…</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name} — {z.city}</option>)}
                </select>
                <Btn small onClick={() => setShowZoneForm(v => !v)} color="#3B82F6">{showZoneForm ? 'Cancel' : '+ Zone'}</Btn>
              </div>
              {showZoneForm && (
                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Inp label="Zone name" placeholder="e.g. Zone 7A" value={newZone.name} onChange={e => setNewZone(z => ({ ...z, name: e.target.value }))}/>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Inp label="City" placeholder="Jacksonville" value={newZone.city} onChange={e => setNewZone(z => ({ ...z, city: e.target.value }))}/>
                    <Inp label="State" placeholder="FL" value={newZone.state} onChange={e => setNewZone(z => ({ ...z, state: e.target.value }))}/>
                  </div>
                  <Btn small color="#22C55E" onClick={createZone} disabled={!newZone.name || savingZone}>{savingZone ? 'Saving…' : '✓ Create Zone'}</Btn>
                </div>
              )}
            </div>
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