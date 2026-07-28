/**
 * ICP canister HTTP expects X-Gateway-Auth matching canister `gateway_auth_secret`
 * (see hub/icp `gatewayAuthorized` — SEC-KN-1 fail-closed: empty secret DENIES).
 * The gateway proxy always merges this; direct fetch helpers must do the same.
 * When CANISTER_AUTH_SECRET is empty, callers send no header and the canister returns
 * GATEWAY_AUTH_REQUIRED on every protected route.
 */
export function canisterAuthHeaders() {
  const secret = process.env.CANISTER_AUTH_SECRET || '';
  if (!secret) return {};
  return { 'x-gateway-auth': secret };
}
