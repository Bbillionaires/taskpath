import L from 'leaflet'

const ESRI_SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_TRANSPORTATION_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

/**
 * Satellite basemap with a labeled roads overlay, so a traced route can be
 * visually checked against real street geometry even when its extracted
 * coordinates are imprecise. Falls back to OSM if Esri's tiles fail
 * (observed failing in some network environments) so the map never goes
 * blank on tile load errors.
 */
export function addSatelliteTiles(map, { maxZoom = 20, overlayOpacity = 0.6 } = {}) {
  let fellBack = false
  const satellite = L.tileLayer(ESRI_SATELLITE_URL, { maxZoom }).addTo(map)
  satellite.on('tileerror', () => {
    if (fellBack) return
    fellBack = true
    map.removeLayer(satellite)
    L.tileLayer(OSM_URL, { maxZoom, attribution: '© OpenStreetMap contributors' }).addTo(map)
  })

  L.tileLayer(ESRI_TRANSPORTATION_URL, { maxZoom, opacity: overlayOpacity }).addTo(map)

  return satellite
}
