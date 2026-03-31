import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default marker icon issue with Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

export default function RouteMap({ geojson, gpsPos, sweptCoords = [] }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const gpsMarkerRef = useRef(null)
  const sweptLayerRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Parse geojson
    let coords = []
    try {
      const geo = typeof geojson === 'string' ? JSON.parse(geojson) : geojson
      coords = geo?.geometry?.coordinates ?? geo?.coordinates ?? []
    } catch (e) {
      console.error('Invalid GeoJSON', e)
      return
    }

    if (!coords.length) return

    // Convert [lng, lat] to [lat, lng] for Leaflet
    const latLngs = coords.map(c => [c[1], c[0]])

    // Init map centered on route
    const center = latLngs[Math.floor(latLngs.length / 2)]
    const map = L.map(mapRef.current, {
      center,
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    })

    // Satellite tiles (ESRI)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri',
        maxZoom: 19,
      }
    ).addTo(map)

    // Street label overlay
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, opacity: 0.6 }
    ).addTo(map)

    // Full route line (yellow — unswept)
    L.polyline(latLngs, {
      color: '#EAB308',
      weight: 6,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    // Start marker
    L.circleMarker(latLngs[0], {
      radius: 10, fillColor: '#22C55E', color: '#fff',
      weight: 2, fillOpacity: 1,
    }).addTo(map).bindPopup('Start')

    // End marker
    L.circleMarker(latLngs[latLngs.length - 1], {
      radius: 10, fillColor: '#F97316', color: '#fff',
      weight: 2, fillOpacity: 1,
    }).addTo(map).bindPopup('End')

    // Fit map to route
    map.fitBounds(L.polyline(latLngs).getBounds(), { padding: [24, 24] })

    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [geojson])

  // Update GPS marker
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !gpsPos) return

    if (gpsMarkerRef.current) {
      gpsMarkerRef.current.setLatLng([gpsPos.lat, gpsPos.lng])
    } else {
      gpsMarkerRef.current = L.circleMarker([gpsPos.lat, gpsPos.lng], {
        radius: 9, fillColor: '#3B82F6', color: '#fff',
        weight: 2.5, fillOpacity: 1,
      }).addTo(map).bindPopup('You are here')
      // Accuracy circle
      L.circle([gpsPos.lat, gpsPos.lng], {
        radius: gpsPos.accuracy ?? 10,
        color: '#3B82F6', fillColor: '#3B82F6',
        fillOpacity: 0.1, weight: 1,
      }).addTo(map)
    }
    map.panTo([gpsPos.lat, gpsPos.lng])
  }, [gpsPos])

  // Update swept coverage layer
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || sweptCoords.length < 2) return

    if (sweptLayerRef.current) {
      sweptLayerRef.current.remove()
    }
    sweptLayerRef.current = L.polyline(sweptCoords, {
      color: '#D97706',
      weight: 8,
      opacity: 0.9,
      lineCap: 'round',
    }).addTo(map)
  }, [sweptCoords])

  return (
    <div
      ref={mapRef}
      style={{
        height: 280,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    />
  )
}