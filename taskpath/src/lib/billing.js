import { supabase } from './supabase'

export async function startCheckout() {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ origin: window.location.origin }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to start checkout')
  window.location.href = data.url
}

/** Best-effort — a billing hiccup should never block the actual roof capture. */
export async function reportRoofCaptureUsage() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/report-roof-capture-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error ?? 'Failed to report usage' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export async function openBillingPortal() {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/create-billing-portal-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({ origin: window.location.origin }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to open billing portal')
  window.location.href = data.url
}

/** Trial expiry blocks access; 'active'/'past_due' (payment retrying) do not. */
export function isBillingBlocked(company) {
  if (!company) return false
  const status = company.subscription_status
  if (status === 'trialing') {
    return Boolean(company.trial_ends_at) && new Date(company.trial_ends_at) < new Date()
  }
  return status === 'canceled' || status === 'incomplete'
}

export function trialDaysLeft(company) {
  if (!company?.trial_ends_at) return null
  const ms = new Date(company.trial_ends_at) - new Date()
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)))
}
