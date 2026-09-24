import { verifyCaller, isAdminOrSupervisor } from './_lib/auth.js'
import { getStripe, getCompany } from './_lib/stripe.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' })

  const { profile: callerProfile, error } = await verifyCaller(req)
  if (error) return res.status(error.status).json({ error: error.message })
  if (!isAdminOrSupervisor(callerProfile)) {
    return res.status(403).json({ error: 'Only admins and supervisors can request HD captures' })
  }

  const company = await getCompany(callerProfile.company_id)
  if (!company?.stripe_roofing_item_id) {
    return res.status(409).json({ error: 'Subscribe to roofing billing before requesting HD captures.' })
  }

  await stripe.subscriptionItems.createUsageRecord(company.stripe_roofing_item_id, {
    quantity: 1,
    timestamp: Math.floor(Date.now() / 1000),
    action: 'increment',
  })

  return res.status(200).json({ success: true })
}
