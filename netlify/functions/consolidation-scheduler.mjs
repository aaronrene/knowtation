/**
 * Netlify Scheduled Function — consolidation-scheduler
 *
 * Runs hourly. For each hosted user with consolidation_enabled=true whose
 * (consolidation_last_pass_at + consolidation_interval_minutes) <= now, this
 * function calls POST /api/v1/memory/consolidate on the bridge via a fresh
 * short-lived service JWT signed with SESSION_SECRET.
 *
 * Each user's effective schedule is controlled by their own
 * consolidation_interval_minutes setting (e.g. 60, 120, 1440 for daily).
 * The cron runs hourly and only triggers users who are actually due.
 *
 * Env:
 *   SESSION_SECRET                              required — sign per-user service JWTs
 *   BRIDGE_URL                                  required — bridge origin (no trailing slash)
 *   CONSOLIDATION_SCHEDULER_MAX_USERS_PER_RUN   optional — cap per invocation (default 20)
 *   BILLING_ENFORCE                             optional — 'true' to actually call bridge;
 *                                               any other value = shadow-log mode (default)
 *
 * Safety:
 *   - Never forwards user credentials; always generates a fresh 5-minute JWT per user.
 *   - Per-user errors are caught and logged without aborting the rest of the run.
 *   - In shadow-log mode (BILLING_ENFORCE !== 'true'), logs what would have been triggered
 *     without calling the bridge or updating the billing DB.
 */
import { getStore } from '@netlify/blobs';
import jwt from 'jsonwebtoken';
import { loadBillingDb, mutateBillingDb } from '../../hub/gateway/billing-store.mjs';

export const config = { schedule: '0 * * * *' };

const SESSION_SECRET = process.env.SESSION_SECRET || process.env.HUB_JWT_SECRET || '';
const BRIDGE_URL = (process.env.BRIDGE_URL || '').replace(/\/+$/, '');
const MAX_USERS_PER_RUN = (() => {
  const v = parseInt(process.env.CONSOLIDATION_SCHEDULER_MAX_USERS_PER_RUN || '20', 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
})();

/**
 * Returns true if the user is due for a consolidation pass.
 *
 * A user is due when:
 *   - consolidation_enabled = true
 *   - consolidation_interval_minutes is a positive number
 *   - consolidation_last_pass_at is null (never run) OR
 *     (last_pass_at + interval_minutes * 60_000) <= nowMs
 *
 * @param {object} user  - Billing user record
 * @param {number} nowMs - Current epoch ms (injectable for testing)
 * @returns {boolean}
 */
export function isUserDue(user, nowMs) {
  if (!user || !user.consolidation_enabled) return false;
  const interval = Number(user.consolidation_interval_minutes);
  if (!interval || !Number.isFinite(interval) || interval <= 0) return false;
  if (!user.consolidation_last_pass_at) return true;
  const lastPass = new Date(user.consolidation_last_pass_at).getTime();
  if (!Number.isFinite(lastPass)) return true;
  return lastPass + interval * 60_000 <= nowMs;
}

/**
 * Signs a short-lived (5-minute) service JWT for server-to-server bridge calls.
 * The bridge reads payload.sub as the user ID via jwt.verify(token, SESSION_SECRET).
 *
 * @param {string} userId - Billing user ID (becomes JWT sub claim)
 * @param {string} secret - SESSION_SECRET
 * @returns {string} Signed JWT
 */
export function signServiceJwt(userId, secret) {
  return jwt.sign({ sub: userId, role: 'service' }, secret, { expiresIn: '5m' });
}

/**
 * Core scheduler logic — fully dependency-injected for testability.
 *
 * @param {object} opts
 * @param {string}   opts.sessionSecret   - JWT signing secret
 * @param {string}   opts.bridgeUrl       - Bridge origin URL
 * @param {number}   opts.maxUsersPerRun  - Max users to process per invocation
 * @param {boolean}  opts.billingEnforce  - If false, shadow-log only (no bridge calls)
 * @param {number}   opts.nowMs           - Current epoch ms (injectable for testing)
 * @param {Function} opts.loadDb          - Loads the billing DB
 * @param {Function} opts.mutateDb        - Mutates and saves the billing DB
 * @param {Function} opts.fetchFn         - fetch implementation (injectable for testing)
 * @returns {Promise<object>} Summary: pass_count, skipped_not_enabled, skipped_not_due, capped, errors, shadow_mode
 */
export async function runScheduler({
  sessionSecret = SESSION_SECRET,
  bridgeUrl = BRIDGE_URL,
  maxUsersPerRun = MAX_USERS_PER_RUN,
  billingEnforce = process.env.BILLING_ENFORCE === 'true',
  nowMs = Date.now(),
  loadDb = loadBillingDb,
  mutateDb = mutateBillingDb,
  fetchFn = globalThis.fetch,
} = {}) {
  const summary = {
    pass_count: 0,
    skipped_not_enabled: 0,
    skipped_not_due: 0,
    capped: 0,
    errors: [],
    shadow_mode: !billingEnforce,
  };

  if (!sessionSecret) throw new Error('SESSION_SECRET is not configured');
  if (!bridgeUrl) throw new Error('BRIDGE_URL is not configured');

  const db = await loadDb();
  const allUsers = Object.values(db.users);

  const enabledUsers = allUsers.filter(u => u.consolidation_enabled);
  summary.skipped_not_enabled = allUsers.length - enabledUsers.length;

  const dueUsers = enabledUsers.filter(u => isUserDue(u, nowMs));
  summary.skipped_not_due = enabledUsers.length - dueUsers.length;

  // Respect the per-invocation cap to bound total runtime.
  const batch = dueUsers.slice(0, maxUsersPerRun);
  summary.capped = dueUsers.length - batch.length;

  for (const user of batch) {
    const userId = user.user_id;

    if (!billingEnforce) {
      // Shadow-log mode: record what would have been triggered, but do not call
      // the bridge and do not update consolidation_last_pass_at.
      summary.pass_count++;
      console.log(
        JSON.stringify({
          type: 'knowtation_billing_shadow',
          source: 'consolidation_scheduler',
          user_id: userId,
          would_trigger: true,
          ts: new Date(nowMs).toISOString(),
        }),
      );
      continue;
    }

    try {
      // Issue a fresh 5-minute JWT per user — never reuse or forward stored credentials.
      const token = signServiceJwt(userId, sessionSecret);

      const res = await fetchFn(`${bridgeUrl}/api/v1/memory/consolidate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(25_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Bridge responded ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = await res.json();

      // Stamp last_pass_at so this user is not triggered again until their interval elapses.
      await mutateDb(dbMut => {
        const u = dbMut.users[userId];
        if (u) u.consolidation_last_pass_at = new Date(nowMs).toISOString();
      });

      summary.pass_count++;
      console.log(
        JSON.stringify({
          type: 'knowtation_scheduler_pass',
          user_id: userId,
          topics: data.topics,
          total_events: data.total_events,
          cost_usd: data.cost_usd,
          pass_id: data.pass_id,
          ts: new Date(nowMs).toISOString(),
        }),
      );
    } catch (e) {
      // Catch per-user errors without aborting the rest of the run.
      const errMsg = e?.message ?? String(e);
      summary.errors.push({ user_id: userId, error: errMsg });
      console.error(
        JSON.stringify({
          type: 'knowtation_scheduler_error',
          user_id: userId,
          error: errMsg,
          ts: new Date(nowMs).toISOString(),
        }),
      );
    }
  }

  return summary;
}

/**
 * Netlify Scheduled Function entry point.
 * Runs every hour (config.schedule = '0 * * * *').
 * Scheduled functions on Netlify are invoked without an HTTP request;
 * the req parameter is a synthetic Request object.
 */
export default async (_req) => {
  const startMs = Date.now();

  // Set up Netlify Blob store so billing-store.mjs can load/save the billing DB.
  // In Netlify Functions v2 (export default), getStore() works without connectLambda.
  // In local dev, this throws; billing-store.mjs falls back to file-based storage.
  let blobStoreSet = false;
  try {
    globalThis.__knowtation_gateway_blob = getStore({
      name: 'gateway-billing',
      consistency: 'strong',
    });
    blobStoreSet = true;
  } catch (_) {
    // Local / non-Netlify environment: billing-store.mjs uses data/hosted_billing.json.
  }

  try {
    const summary = await runScheduler();
    summary.elapsed_ms = Date.now() - startMs;
    console.log(JSON.stringify({ type: 'knowtation_scheduler_summary', ...summary }));
  } catch (e) {
    console.error(
      JSON.stringify({
        type: 'knowtation_scheduler_fatal',
        error: e?.message ?? String(e),
        elapsed_ms: Date.now() - startMs,
      }),
    );
  } finally {
    if (blobStoreSet) delete globalThis.__knowtation_gateway_blob;
  }

  return new Response('ok');
};
