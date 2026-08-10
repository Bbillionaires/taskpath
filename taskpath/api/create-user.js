export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' })

  const callerRes = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${token}`,
    },
  })
  if (!callerRes.ok) return res.status(401).json({ error: 'Invalid or expired session' })
  const caller = await callerRes.json()

  const profileRes = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/profiles?auth_user_id=eq.${caller.id}&select=role,company_id`,
    {
      headers: {
        'apikey': process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  )
  const [callerProfile] = await profileRes.json()
  if (!callerProfile || !['admin', 'supervisor'].includes(callerProfile.role)) {
    return res.status(403).json({ error: 'Only admins and supervisors can create team members' })
  }

  const { email, password, full_name, role, zone_id } = req.body

  const response = await fetch(
    `${process.env.VITE_SUPABASE_URL}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role, zone_id, company_id: callerProfile.company_id },
      }),
    }
  )

  const data = await response.json()
  if (!response.ok) return res.status(400).json({ error: data.message ?? data.msg ?? data.error_description ?? JSON.stringify(data) })

  // Update profile
  await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/profiles?auth_user_id=eq.${data.id}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ full_name, role, assigned_zone_id: zone_id || null }),
    }
  )

  return res.status(200).json({ success: true, user_id: data.id })
}
