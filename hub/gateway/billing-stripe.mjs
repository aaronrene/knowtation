/**
 * Stripe webhook handler + optional session helpers.
 * Stripe SDK (~220 KB) is lazy-loaded on first webhook call to reduce Lambda cold-start time.
 */
import {
  MONTHLY_INCLUDED_CENTS_BY_TIER,
  tierFromEnvPriceId,
  addonCentsFromPackPriceId,
} from './billing-constants.mjs';
import { defaultUserRecord } from './billing-logic.mjs';
import {
  loadBillingDb,
  mutateBillingDb,
  eventAlreadyProcessed,
  markEventProcessed,
  findUserIdByCustomerId,
} from './billing-store.mjs';

let stripeSingleton = null;

export async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeSingleton) {
    const { default: Stripe } = await import('stripe');
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}

function subscriptionPriceId(subscription) {
  const item = subscription?.items?.data?.[0];
  return item?.price?.id ?? null;
}

async function applySubscriptionToUser(stripe, sub, explicitUserId) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const priceId = subscriptionPriceId(sub);
  const tier = tierFromEnvPriceId(priceId) || 'starter';
  const included = MONTHLY_INCLUDED_CENTS_BY_TIER[tier] ?? MONTHLY_INCLUDED_CENTS_BY_TIER.starter;

  await mutateBillingDb((db) => {
    let uid = explicitUserId || findUserIdByCustomerId(db, customerId);
    if (!uid && explicitUserId) uid = explicitUserId;
    if (!uid) return;
    const u = db.users[uid] || defaultUserRecord(uid);
    db.users[uid] = u;
    u.stripe_customer_id = customerId;
    u.stripe_subscription_id = sub.id;
    if (sub.status === 'active' || sub.status === 'trialing') {
      u.tier = tier;
      u.monthly_included_cents = included;
      u.period_start = new Date(sub.current_period_start * 1000).toISOString();
      u.period_end = new Date(sub.current_period_end * 1000).toISOString();
    }
    if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
      u.tier = 'beta';
      u.stripe_subscription_id = null;
      u.monthly_included_cents = 0;
    }
  });
}

async function handleCheckoutSessionCompleted(stripe, session) {
  const uidMeta = session.metadata?.user_id?.trim() || null;

  if (session.mode === 'subscription') {
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) return;
    const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
    await applySubscriptionToUser(stripe, sub, uidMeta);
    return;
  }

  if (session.mode === 'payment') {
    let creditsCents = parseInt(session.metadata?.credits_cents || '0', 10);
    if (!creditsCents && stripe) {
      const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items.data.price'] });
      const priceId = full.line_items?.data?.[0]?.price?.id;
      const mapped = addonCentsFromPackPriceId(priceId);
      if (mapped) creditsCents = mapped;
    }
    if (!creditsCents || creditsCents < 1) return;

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    await mutateBillingDb((db) => {
      let uid = uidMeta || findUserIdByCustomerId(db, customerId);
      if (!uid) return;
      const u = db.users[uid] || defaultUserRecord(uid);
      db.users[uid] = u;
      if (customerId) u.stripe_customer_id = customerId;
      u.addon_cents = (Number(u.addon_cents) || 0) + creditsCents;
    });
  }
}

async function handleInvoicePaid(invoice) {
  if (!invoice.subscription) return;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const line = invoice.lines?.data?.[0];
  const periodEnd = line?.period?.end;
  await mutateBillingDb((db) => {
    const uid = findUserIdByCustomerId(db, customerId);
    if (!uid || !db.users[uid]) return;
    db.users[uid].monthly_used_cents = 0;
    if (periodEnd) db.users[uid].period_end = new Date(periodEnd * 1000).toISOString();
  });
}

/**
 * Express handler: req.body must be raw Buffer (express.raw).
 */
export async function stripeWebhookHandler(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = await getStripe();
  if (!secret || !stripe) {
    return res.status(503).json({ error: 'Stripe webhook not configured', code: 'NOT_CONFIGURED' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature', code: 'BAD_REQUEST' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature: ${err.message}`, code: 'BAD_REQUEST' });
  }

  try {
    const dbPre = await loadBillingDb();
    if (eventAlreadyProcessed(dbPre, event.id)) {
      return res.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(stripe, event.data.object);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;
      case 'customer.subscription.updated': {
        const subId = event.data.object?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });
          await applySubscriptionToUser(stripe, sub, null);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        await mutateBillingDb((db) => {
          const uid = findUserIdByCustomerId(db, customerId);
          if (!uid || !db.users[uid]) return;
          db.users[uid].tier = 'beta';
          db.users[uid].stripe_subscription_id = null;
          db.users[uid].monthly_included_cents = 0;
        });
        break;
      }
      default:
        break;
    }

    await mutateBillingDb((db) => {
      markEventProcessed(db, event.id);
    });

    return res.json({ received: true });
  } catch (e) {
    console.error('[billing] webhook handler error', e);
    return res.status(500).json({ error: 'Webhook processing failed', code: 'SERVER_ERROR' });
  }
}
