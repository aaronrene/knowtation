/**
 * CORS for hosted gateway: browsers reject Access-Control-Allow-Origin: * together with
 * Access-Control-Allow-Credentials: true, which surfaces as fetch() "Failed to fetch".
 * When HUB_CORS_ORIGIN is unset, use * and omit credentials. When set, echo allowed origin + credentials.
 */

/**
 * @param {import('express').Response} res
 * @param {string | undefined} requestOrigin - req.get('Origin')
 * @param {string[]} corsOrigins - trimmed list from HUB_CORS_ORIGIN
 */
export function applyGatewayCors(res, requestOrigin, corsOrigins) {
  let allow;
  if (corsOrigins.length > 0) {
    allow =
      requestOrigin && corsOrigins.includes(requestOrigin) ? requestOrigin : corsOrigins[0];
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
