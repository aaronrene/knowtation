/**
 * Pure JS mirror of Motoko gateway / operator-export secret auth in
 * `hub/icp/src/hub/main.mo` (SEC-KN-1 fail-closed + SEC-KN-6 constant-time compare).
 *
 * Contract (Pass 2 P1 / fail-closed):
 * - Empty or missing `gateway_auth_secret` → DENY (never allow).
 * - Missing / wrong-length / wrong `X-Gateway-Auth` → DENY.
 * - Exact match → ALLOW.
 *
 * Contract (Pass 2 P14 / constant-time):
 * - Equal-length secrets are compared by OR-of-XOR over every code point — no early
 *   exit on the first mismatch (mirrors Motoko `constantTimeTextEqual`).
 *
 * Health and OPTIONS bypass this check in the canister `http_request` handler
 * (they return before calling `gatewayAuthorized`). Use
 * {@link httpRequestRequiresGatewayAuth} to model that routing.
 */

/**
 * Constant-time Text equality (Motoko `constantTimeTextEqual` mirror).
 * Length mismatch returns false without scanning content. Equal-length inputs always
 * scan every Unicode scalar; result is whether the OR of pairwise XORs is zero.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function constantTimeTextEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = [...a];
  const bb = [...b];
  if (aa.length !== bb.length) return false;
  let acc = 0;
  for (let i = 0; i < aa.length; i++) {
    acc |= aa[i].codePointAt(0) ^ bb[i].codePointAt(0);
  }
  return acc === 0;
}

/**
 * Pre-fix P14 compare — Motoko `got == expected` after a length check.
 * Short-circuits on the first differing character (timing oracle).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function textEqualEarlyExitLegacy(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * @param {string} gatewayAuthSecret — canister `storage.gateway_auth_secret`
 * @param {string|null|undefined} headerValue — raw `X-Gateway-Auth` header value
 * @returns {boolean}
 */
export function gatewayAuthorized(gatewayAuthSecret, headerValue) {
  const expected = typeof gatewayAuthSecret === 'string' ? gatewayAuthSecret : '';
  if (expected.length === 0) return false;
  if (headerValue === undefined || headerValue === null) return false;
  if (typeof headerValue !== 'string') return false;
  return constantTimeTextEqual(headerValue, expected);
}

/**
 * Mirror of Motoko `operatorExportAuthorized` (same fail-closed + constant-time contract).
 *
 * @param {string} operatorExportSecret
 * @param {string|null|undefined} headerValue — raw `X-Operator-Export-Key`
 * @returns {boolean}
 */
export function operatorExportAuthorized(operatorExportSecret, headerValue) {
  const expected = typeof operatorExportSecret === 'string' ? operatorExportSecret : '';
  if (expected.length === 0) return false;
  if (headerValue === undefined || headerValue === null) return false;
  if (typeof headerValue !== 'string') return false;
  return constantTimeTextEqual(headerValue, expected);
}

/**
 * Whether a canister HTTP request must pass `gatewayAuthorized` before serving data.
 * Mirrors order in `http_request`: health → OPTIONS → gatewayAuthorized → …
 *
 * @param {string} method — HTTP method
 * @param {string} pathKind — first element of Motoko `parsePath` result (`health`, `vaults`, …)
 * @returns {boolean}
 */
export function httpRequestRequiresGatewayAuth(method, pathKind) {
  if (pathKind === 'health') return false;
  if (String(method || '').toUpperCase() === 'OPTIONS') return false;
  return true;
}

/**
 * Loud health payload when gateway auth is unset — status remains 200 / ok:true.
 *
 * @param {string} gatewayAuthSecret
 * @returns {{ ok: true, gateway_auth_configured: boolean }}
 */
export function healthPayload(gatewayAuthSecret) {
  const configured =
    typeof gatewayAuthSecret === 'string' && gatewayAuthSecret.length > 0;
  return { ok: true, gateway_auth_configured: configured };
}
