export async function verifyCaller(req) {
  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { error: { status: 401, message: 'Missing Authorization header' } }

  const callerRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!callerRes.ok) return { error: { status: 401, message: 'Invalid or expired session' } }
  const caller = await callerRes.json()

  const profileRes = await supabaseServiceFetch(
    `/rest/v1/profiles?auth_user_id=eq.${caller.id}&select=id,role,company_id`
  )
  const [callerProfile] = await profileRes.json()
  if (!callerProfile) return { error: { status: 401, message: 'No profile found for this user' } }
  return { profile: callerProfile }
}

export function isAdminOrSupervisor(profile) {
  return Boolean(profile && ['admin', 'supervisor'].includes(profile.role))
}

export async function supabaseServiceFetch(path, options = {}) {
  return fetch(`${process.env.VITE_SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'apikey': process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}
