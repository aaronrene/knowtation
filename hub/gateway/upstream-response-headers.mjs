/**
 * When the gateway proxies with fetch().text(), the body is already decoded.
 * Forwarding upstream Content-Encoding (e.g. br) causes browsers to ERR_CONTENT_DECODING_FAILED.
 */

const STRIP_FROM_UPSTREAM_DECODED_BODY = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-max-age',
]);

/**
 * @param {Iterable<[string, string]>} entries - upstream Response.headers entries
 * @returns {[string, string][]}
 */
export function filterUpstreamResponseHeadersForDecodedBody(entries) {
  return [...entries].filter(([k]) => !STRIP_FROM_UPSTREAM_DECODED_BODY.has(k.toLowerCase()));
}
