import { verifyCaller, isAdminOrSupervisor } from './_lib/auth.js'
import { getStripe, getCompany, updateCompany } from './_lib/stripe.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet. Contact your administrator.' })

  const { profile: callerProfile, error } = await verifyCaller(req)
  if (error) return res.status(error.status).json({ error: error.message })
  if (!isAdminOrSupervisor(callerProfile)) {
    return res.status(403).json({ error: 'Only admins and supervisors can manage billing' })
  }

  const company = await getCompany(callerProfile.company_id)
  if (!company) return res.status(404).json({ error: 'Company not found' })

  let customerId = company.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: company.name,
      metadata: { company_id: company.id },
    })
    customerId = customer.id
    await updateCompany(company.id, { stripe_customer_id: customerId })
  }

  const lineItems = [
    { price: process.env.STRIPE_PRICE_BASE, quantity: 1 },
    { price: process.env.STRIPE_PRICE_SEAT, quantity: Math.max(1, company.seat_count) },
  ]
  if (company.industry === 'roofing' && process.env.STRIPE_PRICE_ROOF_CAPTURE) {
    lineItems.push({ price: process.env.STRIPE_PRICE_ROOF_CAPTURE })
  }

  const { origin } = req.body ?? {}
  const returnOrigin = origin || `https://${req.headers.host}`

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    success_url: `${returnOrigin}/?billing=success`,
    cancel_url: `${returnOrigin}/?billing=canceled`,
    metadata: { company_id: company.id },
    subscription_data: { metadata: { company_id: company.id } },
  })

  return res.status(200).json({ url: session.url })
}
