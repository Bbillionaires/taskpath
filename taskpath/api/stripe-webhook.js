import { getStripe, updateCompany } from './_lib/stripe.js'

export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function findItem(subscription, priceEnvVar) {
  const priceId = process.env[priceEnvVar]
  if (!priceId) return null
  return subscription.items.data.find(item => item.price.id === priceId) ?? null
}

// companies.subscription_status only allows a subset of Stripe's statuses —
// map the rest to the closest meaningful bucket rather than erroring.
const STATUS_MAP = {
  trialing: 'trialing', active: 'active', past_due: 'past_due',
  canceled: 'canceled', incomplete: 'incomplete',
  incomplete_expired: 'canceled', unpaid: 'past_due', paused: 'past_due',
}

async function syncFromSubscription(stripe, subscription) {
  const companyId = subscription.metadata?.company_id
  if (!companyId) return
  const seatItem = findItem(subscription, 'STRIPE_PRICE_SEAT')
  const roofItem = findItem(subscription, 'STRIPE_PRICE_ROOF_CAPTURE')
  await updateCompany(companyId, {
    stripe_subscription_id: subscription.id,
    subscription_status: STATUS_MAP[subscription.status] ?? 'incomplete',
    ...(seatItem ? { stripe_seat_item_id: seatItem.id } : {}),
    ...(roofItem ? { stripe_roofing_item_id: roofItem.id } : {}),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured' })

  const sig = req.headers['stripe-signature']
  const rawBody = await readRawBody(req)

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const companyId = session.metadata?.company_id
        if (companyId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription)
          await syncFromSubscription(stripe, subscription)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        await syncFromSubscription(stripe, event.data.object)
        break
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const companyId = subscription.metadata?.company_id
        if (companyId) await updateCompany(companyId, { subscription_status: 'canceled' })
        break
      }
      default:
        break
    }
  } catch (err) {
    console.error('Stripe webhook handler error:', err.message)
    return res.status(500).json({ error: 'Webhook handler failed' })
  }

  return res.status(200).json({ received: true })
}
