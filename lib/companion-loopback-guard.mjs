/**
 * Companion loopback endpoint REQUEST-GUARD — pure decision core.
 *
 * Phase 2 of the Companion App build plan (feat/companion-app).
 * See docs/COMPANION-APP-PHASE-2-LOOPBACK-SECURITY.md for the accepted design,
 * the adversarial threat model, and the contract Phase 5 must honour to bind a socket.
 *
 * WHAT THIS MODULE IS
 *   The companion app (a future tray helper) will expose a local AI-inference endpoint on
 *   127.0.0.1:<ephemeral-port>. That listening socket is the single most security-critical
 *   surface in the whole companion design: every web page in the user's browser can issue
 *   requests to http://127.0.0.1:<port>, and DNS-rebinding can make a remote origin appear
 *   to target loopback. Binding to 127.0.0.1 is necessary but NOT sufficient (gate §4).
 *
 *   This module is the *request-decision core* for that endpoint: given a single request's
 *   method, headers, presented token, and the current rate-limit state, it returns a verdict
 *   ({ allow, status, reason }) enforcing gate §4 controls 1, 2, 3, 5, 6, and 8 at the
 *   request-decision level. It binds NO socket and performs NO I/O (the gate's
 *   "DOES NOT approve" list still forbids opening a new local HTTP listener; the bind is
 *   deferred to Phase 5 behind an explicit gate — see the design doc §"What Phase 5 must do").
 *
 * DESIGN CONSTRAINTS (read before modifying — these are security invariants, not style):
 *   - PURE. No I/O, no process.env reads, no network, no logging, no clock reads. Every input
 *     (including `now`) is passed explicitly so the guard is deterministic and testable, and so
 *     it can be composed at any layer without environment coupling.
 *   - FAIL-CLOSED. Anything missing, malformed, ambiguous, or unrecognised → DENY. There is no
 *     fail-open branch anywhere in this module.
 *   - NO AMBIENT AUTHORITY (gate §4.6). The guard's sole output is an inference-admission
 *     verdict. It never returns, references, or has access to the vault, the canister client,
 *     or the stored JWT. The narrow return shape is the structural enforcement of that.
 *   - NO SECRET IN OUTPUT (gate §4.8). Reason codes are fixed constants. The presented token,
 *     the expected token, a JWT, and note bodies are NEVER copied into a reason string, a
 *     returned value, or a thrown error.
 *   - NOTE BODY IS DATA, NEVER CONTROL (gate §4.7 / brief §8.3). The guard does not accept,
 *     read, or branch on any request body. A prompt-injection payload in a note body therefore
 *     cannot influence the admission decision — it is structurally outside this function.
 *
 * Hard constraint from docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md §3:
 *   The cloud gateway NEVER proxies local inference. This endpoint is loopback-only; the only
 *   browser origin permitted to call it is its OWN loopback origin (same-origin). A remote
 *   origin — including the hosted Knowtation web app — is cross-origin and is rejected here.
 *   Permitting a remote origin to drive the companion would be a deliberate allowlist extension
 *   decided at the Phase 5 bind gate, not a default of this guard.
 */

import crypto from 'node:crypto';

/**
 * HTTP methods the loopback inference endpoint accepts.
 *
 * GET  — health/status probe (no model work, no body).
 * POST — inference request (body carried as DATA only; the guard never reads it).
 *
 * Everything else — including OPTIONS — is rejected. The endpoint serves only same-origin
 * (loopback) callers and non-browser local processes, so there is no legitimate CORS preflight
 * to honour; accepting OPTIONS would only widen the surface.
 * @type {ReadonlySet<string>}
 */
export const ALLOWED_METHODS = new Set(['GET', 'POST']);

/**
 * Hostnames recognised as loopback. The request `Host` must resolve to one of these AND appear
 * in the caller-supplied `allowedHosts` allowlist — belt-and-suspenders so a caller that
 * misconfigures `allowedHosts` with a non-loopback literal still cannot open a non-loopback path
 * (gate §4.5: loopback bind only).
 * @type {ReadonlySet<string>}
 */
export const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * `Sec-Fetch-Site` values that may proceed. A browser attaches `Sec-Fetch-Site` automatically
 * and a page cannot forge or strip it (it is a Forbidden header). Only a same-origin fetch from
 * the loopback origin itself ('same-origin') or a top-level user navigation ('none') is allowed.
 * 'same-site' and 'cross-site' are rejected: loopback has no registrable-domain siblings, so any
 * 'same-site'/'cross-site' signal is an out-of-context (cross-origin) caller.
 * @type {ReadonlySet<string>}
 */
const ALLOWED_SEC_FETCH_SITE = new Set(['same-origin', 'none']);

/**
 * Fixed reason codes. These are the ONLY strings the guard ever returns as a reason. None of
 * them is derived from request input, so no secret or attacker-controlled value can leak through
 * the reason channel (gate §4.8).
 * @readonly
 */
export const LOOPBACK_GUARD_REASONS = Object.freeze({
  OK: 'ok',
  MALFORMED_REQUEST: 'malformed_request',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  HOST_NOT_ALLOWED: 'host_not_allowed',
  CROSS_SITE_FORBIDDEN: 'cross_site_forbidden',
  RATE_STATE_UNAVAILABLE: 'rate_state_unavailable',
  RATE_LIMITED: 'rate_limited',
  MISSING_TOKEN: 'missing_token',
  INVALID_TOKEN: 'invalid_token',
});

/**
 * @typedef {Object} LoopbackRateState
 * @property {number} windowMs      Sliding-window size in milliseconds (> 0).
 * @property {number} maxRequests   Max requests permitted within the window (integer > 0).
 * @property {number[]} timestamps  Epoch-ms timestamps of prior requests that reached the
 *                                  rate stage. Maintained by the caller via recordLoopbackRequest.
 */

/**
 * @typedef {Object} LoopbackVerdict
 * @property {boolean} allow                  true only for an admitted request.
 * @property {200|401|403|429} status         HTTP status the listener (Phase 5) should return.
 * @property {string} reason                  A LOOPBACK_GUARD_REASONS value — never a secret.
 */

/**
 * Build a fresh, valid rate-limit state.
 *
 * @param {{ windowMs?: number, maxRequests?: number }} [opts]
 *   windowMs defaults to 60_000 (1 minute); maxRequests defaults to 60.
 * @returns {LoopbackRateState}
 */
export function createLoopbackRateState({ windowMs = 60_000, maxRequests = 60 } = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new TypeError('windowMs must be a positive, finite number');
  }
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new TypeError('maxRequests must be a positive integer');
  }
  return { windowMs, maxRequests, timestamps: [] };
}

/**
 * Constant-time string equality.
 *
 * Both inputs are hashed to a fixed 32-byte digest before comparison, so:
 *   - timingSafeEqual always receives equal-length buffers (it throws on length mismatch, which
 *     would otherwise be an early-exit length oracle),
 *   - the comparison time does not depend on where the first differing byte is, and
 *   - inputs of different lengths simply produce different digests (no length leak in timing).
 *
 * Non-string or empty inputs return false WITHOUT performing a compare — absence of a value is
 * not a content-timing oracle (there is no secret content to compare against yet).
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function constantTimeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const da = crypto.createHash('sha256').update(a, 'utf8').digest();
  const db = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

/**
 * Case-insensitive header lookup over a plain headers object.
 * Returns the trimmed string value, or undefined if absent / not a scalar string.
 * If a header appears as an array (Node can deliver duplicates as arrays), it is treated as
 * ambiguous and returns undefined → fail-closed at the call site.
 *
 * @param {Record<string, unknown>} headers
 * @param {string} name
 * @returns {string | undefined}
 */
function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      if (typeof value === 'string') return value.trim();
      return undefined; // arrays / non-string → ambiguous → fail-closed
    }
  }
  return undefined;
}

/**
 * Parse a `Host` header into { hostname, port }. Handles IPv6 bracket form `[::1]:port`.
 * Returns null on anything malformed.
 *
 * @param {string} host
 * @returns {{ hostname: string, port: string } | null}
 */
export function parseHostHeader(host) {
  if (typeof host !== 'string' || host.length === 0) return null;
  const trimmed = host.trim();
  // IPv6: [::1]:port  or  [::1]
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close === -1) return null;
    const hostname = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    if (rest === '') return { hostname, port: '' };
    if (rest.startsWith(':')) return { hostname, port: rest.slice(1) };
    return null;
  }
  // IPv4 / hostname: split on the LAST colon so we don't mis-split bare IPv6 (which must use
  // bracket form here anyway).
  const idx = trimmed.lastIndexOf(':');
  if (idx === -1) return { hostname: trimmed, port: '' };
  // A colon with more colons before it (bare IPv6 without brackets) is malformed for our purposes.
  if (trimmed.indexOf(':') !== idx) return null;
  return { hostname: trimmed.slice(0, idx), port: trimmed.slice(idx + 1) };
}

/**
 * True when the host string names a loopback hostname (ignoring the port).
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const parsed = parseHostHeader(host);
  if (!parsed) return false;
  return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

/**
 * Evaluate the sliding-window rate limit WITHOUT mutating state.
 * Returns whether the CURRENT request may proceed given prior requests in the window.
 *
 * Fail-closed: a missing or malformed rateState denies (we cannot prove the rate is bounded).
 *
 * @param {LoopbackRateState | undefined} rateState
 * @param {number} now  Epoch-ms for the current request.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function evaluateRateLimit(rateState, now) {
  if (!rateState || typeof rateState !== 'object') {
    return { ok: false, reason: LOOPBACK_GUARD_REASONS.RATE_STATE_UNAVAILABLE };
  }
  const { windowMs, maxRequests, timestamps } = /** @type {LoopbackRateState} */ (rateState);
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return { ok: false, reason: LOOPBACK_GUARD_REASONS.RATE_STATE_UNAVAILABLE };
  }
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    return { ok: false, reason: LOOPBACK_GUARD_REASONS.RATE_STATE_UNAVAILABLE };
  }
  if (!Array.isArray(timestamps)) {
    return { ok: false, reason: LOOPBACK_GUARD_REASONS.RATE_STATE_UNAVAILABLE };
  }
  const windowStart = now - windowMs;
  let countInWindow = 0;
  for (const t of timestamps) {
    if (typeof t === 'number' && Number.isFinite(t) && t > windowStart) countInWindow += 1;
  }
  if (countInWindow >= maxRequests) {
    return { ok: false, reason: LOOPBACK_GUARD_REASONS.RATE_LIMITED };
  }
  return { ok: true };
}

/**
 * Record that a request reached the rate stage, returning a NEW rate state (pure; the input is
 * not mutated). Old timestamps outside the window are pruned so the array cannot grow without
 * bound.
 *
 * Caller contract: invoke this for every request that passed the network-identity gate
 * (method + host + origin/sec-fetch) — i.e. every request that reached the rate/token stage,
 * regardless of whether the token then matched. This is what bounds token brute-force: failed-auth
 * attempts still consume the window budget. Requests rejected EARLIER (bad method/host/cross-site)
 * must NOT be recorded, so cross-origin/rebinding probes cannot exhaust the budget and deny the
 * legitimate client (a budget-exhaustion DoS). See shouldCountTowardRateLimit().
 *
 * @param {LoopbackRateState} rateState
 * @param {number} now  Epoch-ms for the current request.
 * @returns {LoopbackRateState}
 */
export function recordLoopbackRequest(rateState, now) {
  if (!rateState || typeof rateState !== 'object') {
    throw new TypeError('recordLoopbackRequest: rateState must be an object');
  }
  const { windowMs, maxRequests, timestamps } = /** @type {LoopbackRateState} */ (rateState);
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new TypeError('recordLoopbackRequest: rateState is malformed');
  }
  if (!Number.isFinite(now)) {
    throw new TypeError('recordLoopbackRequest: now must be a finite number');
  }
  const windowStart = now - windowMs;
  const source = Array.isArray(timestamps) ? timestamps : [];
  const pruned = source.filter((t) => typeof t === 'number' && Number.isFinite(t) && t > windowStart);
  pruned.push(now);
  return { windowMs, maxRequests, timestamps: pruned };
}

/**
 * Reasons whose request reached the TOKEN stage and therefore consumed a rate-window slot:
 * an admitted request (OK) and a request that passed the network-identity + rate gates but failed
 * authentication (MISSING_TOKEN / INVALID_TOKEN). These are the requests the caller must record.
 *
 * Deliberately EXCLUDED:
 *   - pre-rate rejections (malformed/method/host/cross-site): recording them would let a
 *     cross-origin or DNS-rebinding flood exhaust the shared budget and deny the legitimate
 *     client (a budget-exhaustion DoS).
 *   - rate rejections (rate_limited / rate_state_unavailable): the request did NOT get a slot;
 *     recording it would re-feed the window so it never drains under a sustained flood and would
 *     let the timestamps array grow past maxRequests. Counting only slot-consuming requests keeps
 *     the array bounded by maxRequests while still counting failed-auth attempts (so token
 *     brute-force remains bounded).
 * @type {ReadonlySet<string>}
 */
const SLOT_CONSUMING_REASONS = new Set([
  LOOPBACK_GUARD_REASONS.OK,
  LOOPBACK_GUARD_REASONS.MISSING_TOKEN,
  LOOPBACK_GUARD_REASONS.INVALID_TOKEN,
]);

/**
 * Whether a given verdict consumed a rate-window slot and must be recorded by the caller.
 * True only for verdicts that reached the token stage (OK / missing / invalid token); see
 * SLOT_CONSUMING_REASONS for why pre-rate and rate rejections are excluded.
 *
 * @param {LoopbackVerdict} verdict
 * @returns {boolean}
 */
export function shouldCountTowardRateLimit(verdict) {
  if (!verdict || typeof verdict !== 'object') return false;
  return SLOT_CONSUMING_REASONS.has(verdict.reason);
}

/** Internal helper to build a deny verdict with a fixed reason. */
function deny(status, reason) {
  return { allow: false, status, reason };
}

/**
 * Decide whether a single loopback request may proceed to model inference.
 *
 * Enforces gate §4 controls at the request-decision level:
 *   §4.1 bearer token on every request (constant-time compare)        → 401
 *   §4.2 strict Host allowlist (primary DNS-rebinding defense)         → 403
 *   §4.3 strict Origin / Sec-Fetch-Site (no cross-site, no wildcard)   → 403
 *   §4.5 loopback-only (Host must resolve to a loopback hostname)      → 403
 *   §4.6 no ambient authority (verdict is the ONLY output)            → (structural)
 *   §4.8 rate limiting (bounded request rate)                         → 429
 *   §4.7 untrusted input — note body is never read here              → (structural)
 *
 * EVALUATION ORDER is itself a security decision and must not be reordered casually:
 *   1. Structural validity        — malformed input fails closed (403).
 *   2. Method allowlist           — only GET/POST (403).
 *   3. Host allowlist + loopback  — DNS-rebinding defense (403). Cheap; rejects the bulk of
 *                                   browser-based abuse before any budget is touched.
 *   4. Origin / Sec-Fetch-Site    — cross-site rejection (403).
 *   5. Rate limit                 — BEFORE the token check (429). Placing it before the token
 *                                   check is what bounds token brute-force: once the window is
 *                                   full, even token-guessing requests get 429 rather than an
 *                                   unbounded stream of 401s. It is placed AFTER host/origin so a
 *                                   cross-origin/rebinding flood (already 403'd) cannot consume the
 *                                   shared budget and deny the legitimate client.
 *   6. Token                      — presence then constant-time match (401).
 *   7. Allow                      — 200.
 *
 * The function NEVER throws: any unexpected internal error is caught and converted to a
 * fail-closed 403 with a fixed reason, so no exception can carry input data outward.
 *
 * @param {{
 *   method?: unknown,
 *   headers?: unknown,
 *   token?: unknown,
 *   expectedToken?: unknown,
 *   allowedHosts?: unknown,
 *   now?: unknown,
 *   rateState?: LoopbackRateState,
 * }} params
 * @returns {LoopbackVerdict}
 */
export function verifyLoopbackRequest(params) {
  try {
    const { method, headers, token, expectedToken, allowedHosts, now, rateState } = params ?? {};

    // 1. Structural validity — fail closed on anything malformed.
    if (
      typeof method !== 'string' ||
      method.length === 0 ||
      headers === null ||
      typeof headers !== 'object' ||
      Array.isArray(headers) ||
      typeof now !== 'number' ||
      !Number.isFinite(now)
    ) {
      return deny(403, LOOPBACK_GUARD_REASONS.MALFORMED_REQUEST);
    }
    const headerBag = /** @type {Record<string, unknown>} */ (headers);

    // 2. Method allowlist.
    if (!ALLOWED_METHODS.has(method.toUpperCase())) {
      return deny(403, LOOPBACK_GUARD_REASONS.METHOD_NOT_ALLOWED);
    }

    // 3. Host allowlist + loopback enforcement (primary DNS-rebinding defense, §4.2/§4.5).
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
      return deny(403, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED); // cannot validate → deny
    }
    const hostHeader = getHeader(headerBag, 'host');
    if (hostHeader === undefined || hostHeader.length === 0) {
      return deny(403, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED);
    }
    const hostMatchesAllowlist = allowedHosts.some(
      (h) => typeof h === 'string' && h.toLowerCase() === hostHeader.toLowerCase(),
    );
    if (!hostMatchesAllowlist || !isLoopbackHost(hostHeader)) {
      return deny(403, LOOPBACK_GUARD_REASONS.HOST_NOT_ALLOWED);
    }

    // 4. Origin / Sec-Fetch-Site cross-site rejection (§4.3).
    //    The only browser origins permitted are the loopback origins derived from allowedHosts
    //    (same-origin). A present Origin must be one of them; a present Sec-Fetch-Site must be
    //    same-origin/none. A non-browser local process sends neither and is allowed past this
    //    gate (it still needs a valid token, and loopback bind keeps remote clients out).
    const secFetchSite = getHeader(headerBag, 'sec-fetch-site');
    if (secFetchSite !== undefined && !ALLOWED_SEC_FETCH_SITE.has(secFetchSite.toLowerCase())) {
      return deny(403, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
    }
    const origin = getHeader(headerBag, 'origin');
    if (origin !== undefined && origin.length > 0) {
      const allowedOrigins = new Set();
      for (const h of allowedHosts) {
        if (typeof h === 'string') {
          allowedOrigins.add(`http://${h.toLowerCase()}`);
          allowedOrigins.add(`https://${h.toLowerCase()}`);
        }
      }
      if (!allowedOrigins.has(origin.toLowerCase())) {
        return deny(403, LOOPBACK_GUARD_REASONS.CROSS_SITE_FORBIDDEN);
      }
    }

    // 5. Rate limit — BEFORE token (bounds brute-force), AFTER host/origin (no budget DoS).
    const rate = evaluateRateLimit(rateState, now);
    if (!rate.ok) {
      return deny(429, rate.reason);
    }

    // 6. Token — presence, then constant-time match (§4.1).
    if (typeof token !== 'string' || token.length === 0) {
      return deny(401, LOOPBACK_GUARD_REASONS.MISSING_TOKEN);
    }
    if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
      // No credential is configured → nothing can authenticate. Fail closed.
      return deny(401, LOOPBACK_GUARD_REASONS.INVALID_TOKEN);
    }
    if (!constantTimeStringEqual(token, expectedToken)) {
      return deny(401, LOOPBACK_GUARD_REASONS.INVALID_TOKEN);
    }

    // 7. Admitted.
    return { allow: true, status: 200, reason: LOOPBACK_GUARD_REASONS.OK };
  } catch {
    // Defense in depth: never let an unexpected error escape with input data attached.
    return deny(403, LOOPBACK_GUARD_REASONS.MALFORMED_REQUEST);
  }
}
