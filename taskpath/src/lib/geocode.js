/** Geocode a free-text address via Nominatim (OpenStreetMap) — free, keyless. */
export async function geocodeAddress(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=0`
    const res = await fetch(url, { headers: { 'User-Agent': 'TaskPath-Properties/1.0' } })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.length) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    return null
  }
}
