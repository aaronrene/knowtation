/**
 * Billing gate: deduct before expensive hosted operations when BILLING_ENFORCE is on.
 */
import { billingEnforced, billingShadowLogEnabled, COST_CENTS } from './billing-constants.mjs';
import { tryDeduct, defaultUserRecord } from './billing-logic.mjs';
import { loadBillingDb, saveBillingDb } from './billing-store.mjs';
import { effectiveRequestPath } from './request-path.mjs';

function operationFromRequest(method, req) {
  const path = effectiveRequestPath(req);
  if (method === 'POST' && path.endsWith('/search')) return 'search';
  if (method === 'POST' && path.endsWith('/index')) return 'index';
  if (method === 'POST' && /\/api\/v1\/notes\/?$/.test(path)) return 'note_write';
  if (method === 'PUT' && /\/api\/v1\/notes\//.test(path)) return 'note_write';
  if (method === 'POST' && /\/api\/v1\/proposals\/?$/.test(path)) return 'proposal_write';
  return null;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {() => string|null} getUserId
 * @returns {Promise<boolean>} true if request may proceed
 */
export async function runBillingGate(req, res, getUserId) {
  const op = operationFromRequest(req.method, req);
  if (!op) return true;

  const uid = getUserId(req);
  const cost = COST_CENTS[op];

  if (billingShadowLogEnabled() && uid && cost != null && cost > 0) {
    console.log(
      JSON.stringify({
        type: 'knowtation_billing_shadow',
        ts: new Date().toISOString(),
        user_id: uid,
        operation: op,
        cost_cents: cost,
        path: effectiveRequestPath(req),
        billing_enforced: billingEnforced(),
      })
    );
  }

  if (!billingEnforced()) return true;

  if (!uid) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return false;
  }

  if (cost == null || cost <= 0) return true;

  const db = await loadBillingDb();
  const u = db.users[uid] || defaultUserRecord(uid);
  if (!db.users[uid]) db.users[uid] = u;

  const result = tryDeduct(u, cost);
  if (!result.ok) {
    res.status(402).json({
      error: 'Billing quota exceeded for this operation',
      code: result.code || 'QUOTA_EXHAUSTED',
    });
    return false;
  }

  await saveBillingDb(db);
  return true;
}

/**
 * Express middleware factory for the catch-all /api/v1 canister proxy.
 */
export function billingGatewayMiddleware(getUserId) {
  return async (req, res, next) => {
    const ok = await runBillingGate(req, res, getUserId);
    if (ok) next();
  };
}
