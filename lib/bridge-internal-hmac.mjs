/**
 * Inter-function HMAC authentication for the bridge.
 *
 * The synchronous bridge function (`netlify/functions/bridge.mjs`) needs to kick
 * off the background indexing function (`netlify/functions/bridge-index-background.mjs`)
 * via an HTTP POST to its public Netlify endpoint. Because that endpoint is
 * publicly addressable on the internet, we MUST require proof that the request
 * actually came from the sync bridge — otherwise an attacker who finds the URL
 * could trigger arbitrary background re-indexes against any vaultId they can guess
 * (and burn the operator's DeepInfra budget).
 *
 * Defense in depth:
 *   1. The user JWT is forwarded in the Authorization header (so the background
 *      function still runs `requireBridgeAuth` and the user must be a real one).
 *   2. THIS module's HMAC adds a second signature proving the request came from
 *      the bridge sync function — an attacker would need both the user's JWT
 *      AND the bridge's `SESSION_SECRET` to forge a request, which means they
 *      have to compromise the operator's Netlify env, in which case all bets
 *      are off anyway.
 *   3. The signature includes a UNIX timestamp; we reject signatures > 60 s old
 *      to prevent replay of an intercepted request.
 *
 * Pure module: no I/O, no fetch. Tests inject `now` for deterministic clock.
 */

import crypto from 'crypto';

/**
 * Replay window. 60 s is generous for inter-function HTTP latency (P99 ~1 s
 * inside the same Netlify region) but small enough that a captured signature
 * cannot be replayed hours later.
 */
export const HMAC_REPLAY_WINDOW_MS = 60 * 1000;

/**
 * Build the canonical message that gets signed. Centralized so signer + verifier
 * cannot drift out of sync.
 *
 * @param {{ canisterUid: string, vaultId: string, jobId: string, ts: number }} payload
 * @returns {string}
 */
export function canonicalMessage(payload) {
  if (payload == null || typeof payload !== 'object') {
    throw new TypeError('canonicalMessage: payload is required');
  }
  const { canisterUid, vaultId, jobId, ts } = payload;
  if (typeof canisterUid !== 'string' || canisterUid === '') {
    throw new TypeError('canonicalMessage: canisterUid must be a non-empty string');
  }
  if (typeof vaultId !== 'string' || vaultId === '') {
    throw new TypeError('canonicalMessage: vaultId must be a non-empty string');
  }
  if (typeof jobId !== 'string' || jobId === '') {
    throw new TypeError('canonicalMessage: jobId must be a non-empty string');
  }
  if (!Number.isFinite(ts)) {
    throw new TypeError('canonicalMessage: ts must be a finite number (epoch ms)');
  }
  return `bridge-index-background\n${canisterUid}\n${vaultId}\n${jobId}\n${ts}`;
}

/**
 * Sign the canonical message with HMAC-SHA256 using the bridge `SESSION_SECRET`.
 * Returns hex digest.
 *
 * @param {string} secret - Bridge `SESSION_SECRET` (must be the same in both
 *   the sync function and the background function — Netlify's per-site env vars
 *   guarantee this in production).
 * @param {{ canisterUid: string, vaultId: string, jobId: string, ts: number }} payload
 * @returns {string} 64-char hex.
 */
export function signInternalRequest(secret, payload) {
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('signInternalRequest: secret must be a non-empty string');
  }
  return crypto.createHmac('sha256', secret).update(canonicalMessage(payload)).digest('hex');
}

/**
 * Verify a signature on the receiving end (background function). Returns
 * `{ ok: true, payload }` on success, or `{ ok: false, reason }` for one of:
 *   - `'missing_secret'` — server misconfiguration; the operator must set
 *     SESSION_SECRET on the bridge background site (same value as sync site).
 *   - `'missing_header'` — caller did not include the required headers.
 *   - `'bad_timestamp'` — `ts` is not a finite number.
 *   - `'expired'` — the signature is older than the replay window.
 *   - `'bad_signature'` — HMAC mismatch (forged or wrong secret).
 *
 * Uses `crypto.timingSafeEqual` to avoid leaking signature bytes via timing.
 *
 * @param {string|undefined|null} secret - Bridge `SESSION_SECRET`.
 * @param {{
 *   canisterUid?: string,
 *   vaultId?: string,
 *   jobId?: string,
 *   ts?: string|number,
 *   sig?: string,
 *   now?: () => number,
 *   replayWindowMs?: number,
 * }} headers
 * @returns {{ ok: true, payload: { canisterUid: string, vaultId: string, jobId: string, ts: number } } | { ok: false, reason: string }}
 */
export function verifyInternalRequest(secret, headers) {
  if (typeof secret !== 'string' || secret === '') {
    return { ok: false, reason: 'missing_secret' };
  }
  if (headers == null || typeof headers !== 'object') {
    return { ok: false, reason: 'missing_header' };
  }
  const canisterUid = stringOrEmpty(headers.canisterUid);
  const vaultId = stringOrEmpty(headers.vaultId);
  const jobId = stringOrEmpty(headers.jobId);
  const sig = stringOrEmpty(headers.sig);
  if (canisterUid === '' || vaultId === '' || jobId === '' || sig === '') {
    return { ok: false, reason: 'missing_header' };
  }
  const tsRaw = headers.ts;
  const ts = typeof tsRaw === 'number' ? tsRaw : parseInt(String(tsRaw || ''), 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };

  const now = typeof headers.now === 'function' ? headers.now : Date.now;
  const replayWindowMs = Number.isFinite(headers.replayWindowMs)
    ? headers.replayWindowMs
    : HMAC_REPLAY_WINDOW_MS;
  const drift = Math.abs(now() - ts);
  if (drift > replayWindowMs) return { ok: false, reason: 'expired' };

  const expected = signInternalRequest(secret, { canisterUid, vaultId, jobId, ts });
  // Both buffers must be the same length for timingSafeEqual; sig length should
  // equal expected length for HMAC-SHA256 hex (64 chars), but reject early if not.
  if (sig.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  let ok;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!ok) return { ok: false, reason: 'bad_signature' };
  return { ok: true, payload: { canisterUid, vaultId, jobId, ts } };
}

function stringOrEmpty(value) {
  if (value == null) return '';
  return String(value);
}
