import Stripe from 'stripe'
import { supabaseServiceFetch } from './auth.js'

/** Null until STRIPE_SECRET_KEY is configured — every caller must handle that. */
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null
  return new Stripe(process.env.STRIPE_SECRET_KEY)
}

export async function getCompany(companyId) {
  const res = await supabaseServiceFetch(`/rest/v1/companies?id=eq.${companyId}&select=*`)
  const [company] = await res.json()
  return company ?? null
}

export async function updateCompany(companyId, fields) {
  await supabaseServiceFetch(`/rest/v1/companies?id=eq.${companyId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

/**
 * Keep the seat subscription item's quantity matched to companies.seat_count.
 * No-op until billing is configured and the company has actually subscribed
 * (stripe_seat_item_id is only set once checkout completes) — inviting a team
 * member must never fail just because billing isn't wired up yet.
 */
export async function syncSeatQuantity(companyId) {
  const stripe = getStripe()
  if (!stripe) return
  const company = await getCompany(companyId)
  if (!company?.stripe_seat_item_id) return
  await stripe.subscriptionItems.update(company.stripe_seat_item_id, {
    quantity: company.seat_count,
  })
}
