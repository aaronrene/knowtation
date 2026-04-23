/**
 * CORS for hosted gateway: browsers reject Access-Control-Allow-Origin: * together with
 * Access-Control-Allow-Credentials: true, which surfaces as fetch() "Failed to fetch".
 * When HUB_CORS_ORIGIN is unset, use * and omit credentials. When set, echo allowed origin + credentials.
 *
 * If the allowlist has only one of `https://example.com` and `https://www.example.com`, a request
 * from the other still matches: we echo the **request** Origin so credentialed fetches from apex
 * vs www both succeed (operators often list only one host; mismatch previously blanked Hub Settings).
 */

/**
 * Same scheme + hostname differs only by leading `www.` (e.g. apex vs www for one site).
 * @param {string} a
 * @param {string} b
 */
export function isWwwApexPair(a, b) {
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol !== ub.protocol) return false;
    const A = ua.hostname;
    const B = ub.hostname;
    return A === B || A === `www.${B}` || B === `www.${A}`;
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} requestOrigin
 * @param {string[]} corsOrigins
 * @returns {string}
 */
export function resolveGatewayAllowOrigin(requestOrigin, corsOrigins) {
  if (corsOrigins.length === 0) return '*';
  if (requestOrigin && corsOrigins.includes(requestOrigin)) return requestOrigin;
  if (requestOrigin) {
    for (const o of corsOrigins) {
      if (isWwwApexPair(o, requestOrigin)) return requestOrigin;
    }
  }
  return corsOrigins[0];
}

/**
 * @param {import('express').Response} res
 * @param {string | undefined} requestOrigin - req.get('Origin')
 * @param {string[]} corsOrigins - trimmed list from HUB_CORS_ORIGIN
 */
export function applyGatewayCors(res, requestOrigin, corsOrigins) {
  let allow;
  if (corsOrigins.length > 0) {
    allow = resolveGatewayAllowOrigin(requestOrigin, corsOrigins);
  } else {
    allow = '*';
  }
  res.set('Access-Control-Allow-Origin', allow);
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vault-Id, X-User-Id');
  if (corsOrigins.length > 0 && allow !== '*') {
    res.set('Access-Control-Allow-Credentials', 'true');
  }
  if (corsOrigins.length > 0) res.set('Vary', 'Origin');
}
