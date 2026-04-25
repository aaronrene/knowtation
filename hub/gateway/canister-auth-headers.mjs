/**
 * ICP canister HTTP expects X-Gateway-Auth when the canister has a non-empty
 * gateway_auth_secret (see hub/icp `gatewayAuthorized`). The gateway proxy
 * always merges this; direct fetch helpers must do the same.
 */
export function canisterAuthHeaders() {
  const secret = process.env.CANISTER_AUTH_SECRET || '';
  if (!secret) return {};
  return { 'x-gateway-auth': secret };
}
