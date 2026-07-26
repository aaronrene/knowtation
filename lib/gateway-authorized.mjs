/**
 * Pure JS mirror of Motoko `gatewayAuthorized` in `hub/icp/src/hub/main.mo` (SEC-KN-1).
 *
 * Contract (Pass 2 P1 / fail-closed):
 * - Empty or missing `gateway_auth_secret` → DENY (never allow).
 * - Missing / wrong-length / wrong `X-Gateway-Auth` → DENY.
 * - Exact match → ALLOW.
 *
 * Health and OPTIONS bypass this check in the canister `http_request` handler
 * (they return before calling `gatewayAuthorized`). Use
 * {@link httpRequestRequiresGatewayAuth} to model that routing.
 *
 * @param {string} gatewayAuthSecret — canister `storage.gateway_auth_secret`
 * @param {string|null|undefined} headerValue — raw `X-Gateway-Auth` header value
 * @returns {boolean}
 */
export function gatewayAuthorized(gatewayAuthSecret, headerValue) {
  const expected = typeof gatewayAuthSecret === 'string' ? gatewayAuthSecret : '';
  if (expected.length === 0) return false;
  if (headerValue === undefined || headerValue === null) return false;
  if (typeof headerValue !== 'string') return false;
  if (headerValue.length !== expected.length) return false;
  return headerValue === expected;
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
