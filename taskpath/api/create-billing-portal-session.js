import { verifyCaller, isAdminOrSupervisor } from './_lib/auth.js'
import { getStripe, getCompany } from './_lib/stripe.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' })

  const { profile: callerProfile, error } = await verifyCaller(req)
  if (error) return res.status(error.status).json({ error: error.message })
  if (!isAdminOrSupervisor(callerProfile)) {
    return res.status(403).json({ error: 'Only admins and supervisors can manage billing' })
  }

  const company = await getCompany(callerProfile.company_id)
  if (!company?.stripe_customer_id) {
    return res.status(409).json({ error: 'No billing account yet — subscribe first.' })
  }

  const { origin } = req.body ?? {}
  const returnOrigin = origin || `https://${req.headers.host}`

  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripe_customer_id,
    return_url: `${returnOrigin}/`,
  })

  return res.status(200).json({ url: session.url })
}
