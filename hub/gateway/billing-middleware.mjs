/**
 * Billing gate: deduct credits + enforce storage caps before hosted operations.
 * BILLING_ENFORCE=false (default) → shadow logs only; no requests are blocked.
 * BILLING_ENFORCE=true → hard enforcement: 402 on quota/storage exceeded.
 */
import {
  billingEnforced,
  billingShadowLogEnabled,
  COST_CENTS,
  NOTE_CAP_BY_TIER,
  CONSOLIDATION_PASSES_BY_TIER,
} from './billing-constants.mjs';
import {
  tryDeduct,
  defaultUserRecord,
  effectiveMonthlyConsolidationPassesIncluded,
} from './billing-logic.mjs';
import { loadBillingDb, saveBillingDb, resetMonthlyTokensIfNeeded } from './billing-store.mjs';
import { effectiveRequestPath } from './request-path.mjs';

function operationFromRequest(method, req) {
  const path = effectiveRequestPath(req);
  if (method === 'POST' && path.endsWith('/search')) return 'search';
  if (method === 'POST' && path.endsWith('/index')) return 'index';
  if (method === 'POST' && /\/memory\/consolidate\/?$/.test(path)) return 'consolidation';
  if (method === 'POST' && /\/api\/v1\/notes\/?$/.test(path)) return 'note_write';
  if (method === 'POST' && /\/api\/v1\/notes\/delete-by-prefix\/?$/.test(path)) return 'note_write';
  if (method === 'POST' && /\/api\/v1\/notes\/delete-by-project\/?$/.test(path)) return 'note_write';
  if (method === 'POST' && /\/api\/v1\/notes\/rename-project\/?$/.test(path)) return 'note_write';
  if (method === 'PUT' && /\/api\/v1\/notes\//.test(path)) return 'note_write';
  if (
    method === 'DELETE' &&
    /^\/api\/v1\/notes\/.+/.test(path) &&
    path !== '/api/v1/notes/facets'
  ) {
    return 'note_write';
  }
  if (method === 'POST' && /\/api\/v1\/proposals\/?$/.test(path)) return 'proposal_write';
  return null;
}

/**
 * Returns true if the request is a note CREATE (POST /api/v1/notes), which is the only operation
 * that increases note count and needs the storage cap check.
 */
function isNoteCreate(method, req) {
  const path = effectiveRequestPath(req);
  return method === 'POST' && /\/api\/v1\/notes\/?$/.test(path);
}

/**
 * Check note count against tier cap.
 * Returns { ok: true } if under cap, or { ok: false, code: 'STORAGE_QUOTA_EXCEEDED', cap, tier } if over.
 *
 * @param {object} u - Billing user record
 * @param {number} currentNoteCount - Current number of notes for this user
 * @returns {{ ok: boolean, code?: string, cap?: number, tier?: string }}
 */
function checkNoteStorageCap(u, currentNoteCount) {
  const tier = String(u?.tier || 'beta');
  const cap = NOTE_CAP_BY_TIER[tier] ?? null;
  if (cap === null) return { ok: true };
  if (currentNoteCount >= cap) {
    return { ok: false, code: 'STORAGE_QUOTA_EXCEEDED', cap, tier };
  }
  return { ok: true };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {(req: import('express').Request) => string|null} getUserId
 * @param {{ getNoteCount?: (userId: string, req: import('express').Request) => Promise<number> }} [opts]
 * @returns {Promise<boolean>} true if request may proceed
 */
export async function runBillingGate(req, res, getUserId, opts = {}) {
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

  // Storage cap check — only for note CREATE, only when enforce is on.
  if (isNoteCreate(req.method, req) && uid) {
    if (billingEnforced() && typeof opts.getNoteCount === 'function') {
      try {
        await resetMonthlyTokensIfNeeded(uid);
        const db = await loadBillingDb();
        const u = db.users[uid] || defaultUserRecord(uid);

        const noteCount = await opts.getNoteCount(uid, req);
        const storageCheck = checkNoteStorageCap(u, noteCount);

        if (!storageCheck.ok) {
          res.status(402).json({
            error: `Note storage quota exceeded for tier '${storageCheck.tier}' (cap: ${storageCheck.cap} notes).`,
            code: 'STORAGE_QUOTA_EXCEEDED',
            note_cap: storageCheck.cap,
            tier: storageCheck.tier,
          });
          return false;
        }
      } catch (e) {
        // Never block a request due to a storage-check failure — fail open.
        console.error('[billing] storage cap check failed (non-fatal):', e?.message || String(e));
      }
    } else if (billingShadowLogEnabled() && uid) {
      // Shadow log: record that a note create happened (count enforcement deferred).
      console.log(
        JSON.stringify({
          type: 'knowtation_billing_shadow',
          ts: new Date().toISOString(),
          user_id: uid,
          operation: 'note_create_storage_cap_check',
          note_count_fetcher_available: typeof opts.getNoteCount === 'function',
          billing_enforced: billingEnforced(),
        })
      );
    }
  }

  // Always track usage when the user is authenticated, regardless of enforcement mode.
  // Enforcement (blocking) only fires when BILLING_ENFORCE=true.
  if (uid && cost != null && cost > 0) {
    try {
      await resetMonthlyTokensIfNeeded(uid);
      const db = await loadBillingDb();
      const u = db.users[uid] || defaultUserRecord(uid);
      if (!db.users[uid]) db.users[uid] = u;

      // Increment operation counters unconditionally so Usage this period is always accurate.
      // NOTE: 'index' job counter is intentionally omitted here — it is incremented atomically
      // in recordIndexingTokensAfterBridgeIndex (billing-index-usage.mjs) alongside the token
      // counter in a single mutateBillingDb call. A second write here would race with that call
      // and risk overwriting the counter back to 0 on Netlify's eventually-consistent Blob store.
      if (op === 'search') u.monthly_searches_used = Math.max(0, Math.floor(Number(u.monthly_searches_used) || 0)) + 1;
      if (op === 'consolidation') {
        u.monthly_consolidation_jobs_used = Math.max(0, Math.floor(Number(u.monthly_consolidation_jobs_used) || 0)) + 1;
        u.consolidation_last_pass_at = new Date().toISOString();
      }

      if (billingEnforced()) {
        // Consolidation-specific cap check.
        if (op === 'consolidation') {
          const passCap = effectiveMonthlyConsolidationPassesIncluded(u);

          // Free tier: no hosted consolidation at all.
          if (passCap !== null && passCap === 0) {
            res.status(402).json({
              error: 'Hosted memory consolidation is not available on the free tier. Upgrade to a paid plan.',
              code: 'CONSOLIDATION_NOT_AVAILABLE',
              tier: u.tier || 'free',
            });
            return false;
          }

          // Paid tier with a monthly cap: check if the monthly allotment is exhausted.
          // NOTE: monthly_consolidation_jobs_used was already incremented above (line ~152),
          // so the current value reflects the operation being attempted (post-increment).
          if (passCap !== null) {
            const passesUsedAfterIncrement = Math.max(0, Math.floor(Number(u.monthly_consolidation_jobs_used) || 0));
            if (passesUsedAfterIncrement > passCap) {
              // Monthly exhausted — try to draw one pass from the pack balance.
              const packPasses = Math.max(0, Math.floor(Number(u.pack_consolidation_passes_balance) || 0));
              if (packPasses > 0) {
                u.pack_consolidation_passes_balance = packPasses - 1;
              } else {
                // Undo the counter increment so the display stays accurate.
                u.monthly_consolidation_jobs_used = passesUsedAfterIncrement - 1;
                res.status(402).json({
                  error: 'Monthly consolidation passes exhausted. Purchase a token pack to add more.',
                  code: 'CONSOLIDATION_QUOTA_EXHAUSTED',
                  tier: u.tier || 'free',
                  monthly_cap: passCap,
                  pack_passes_remaining: 0,
                });
                return false;
              }
            }
          }
        }

        const result = tryDeduct(u, cost);
        if (!result.ok) {
          res.status(402).json({
            error: 'Billing quota exceeded for this operation',
            code: result.code || 'QUOTA_EXHAUSTED',
          });
          return false;
        }
      }

      await saveBillingDb(db);
    } catch (e) {
      // Never block a request due to a billing tracking failure — fail open.
      console.error('[billing] usage tracking failed (non-fatal):', e?.message || String(e));
    }
  }

  return true;
}

/**
 * Express middleware factory for the catch-all /api/v1 canister proxy.
 *
 * @param {(req: import('express').Request) => string|null} getUserId
 * @param {{ getNoteCount?: (userId: string, req: import('express').Request) => Promise<number> }} [opts]
 */
export function billingGatewayMiddleware(getUserId, opts = {}) {
  return async (req, res, next) => {
    const ok = await runBillingGate(req, res, getUserId, opts);
    if (ok) next();
  };
}
