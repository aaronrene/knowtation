/**
 * Canonical HTTP path for gateway → canister proxy.
 * Under app.use('/api/v1', handler), Express sets req.path to the suffix (e.g. /notes);
 * serverless-http / Netlify may leave req.originalUrl inconsistent. Prefer baseUrl + path.
 */

/**
 * @param {import('express').Request} req
 * @returns {string} pathname only (no query)
 */
export function effectiveRequestPath(req) {
  const combined = (req.baseUrl || '') + (req.path || '');
  const noQuery = combined.split('?')[0];
  if (noQuery.startsWith('/api/v1')) return noQuery;
  const raw = (req.originalUrl || req.url || '/').split('?')[0];
  return raw;
}

/**
 * Path + query for upstream canister (preserve search from originalUrl).
 * @param {import('express').Request} req
 */
export function upstreamPathAndQuery(req) {
  const raw = req.originalUrl || req.url || '/';
  const q = raw.indexOf('?');
  const search = q >= 0 ? raw.slice(q) : '';
  return effectiveRequestPath(req) + search;
}

/**
 * @param {import('express').Request} req
 */
export function pathPartNoQuery(req) {
  return effectiveRequestPath(req);
}
