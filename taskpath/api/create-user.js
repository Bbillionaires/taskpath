import { verifyCaller, isAdminOrSupervisor, supabaseServiceFetch } from './_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { profile: callerProfile, error } = await verifyCaller(req)
  if (error) return res.status(error.status).json({ error: error.message })
  if (!isAdminOrSupervisor(callerProfile)) {
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
  await supabaseServiceFetch(`/rest/v1/profiles?auth_user_id=eq.${data.id}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({ full_name, role, assigned_zone_id: zone_id || null }),
  })

  // Best-effort: keep the Stripe subscription's seat quantity in sync. Billing
  // may not be configured yet (no Stripe account), or the company may still be
  // on trial with no subscription created — neither should ever block an invite.
  try {
    const { syncSeatQuantity } = await import('./_lib/stripe.js')
    await syncSeatQuantity(callerProfile.company_id)
  } catch (e) {
    console.error('Seat sync failed (non-blocking):', e.message)
  }

  return res.status(200).json({ success: true, user_id: data.id })
}
