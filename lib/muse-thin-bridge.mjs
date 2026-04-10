/**
 * Optional Muse thin bridge (Option C). Fail-closed when MUSE_URL is unset.
 * Server-side only; never expose MUSE_API_KEY to clients.
 */

export const DEFAULT_MAX_EXTERNAL_REF_LEN = 512;
export const DEFAULT_LINEAGE_TIMEOUT_MS = 5000;
export const DEFAULT_PROXY_MAX_BYTES = 1024 * 1024;

/** Documented operator callback path (Knowtation-defined contract). */
export const MUSE_LINEAGE_REF_PATH = '/knowtation/v1/lineage-ref';

/**
 * @param {unknown} raw
 * @param {number} [maxLen]
 * @returns {string}
 */
export function normalizeExternalRef(raw, maxLen = DEFAULT_MAX_EXTERNAL_REF_LEN) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (s.length > maxLen) return '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return '';
  }
  return s;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ baseUrl: string, apiKey: string, lineageTimeoutMs: number, proxyMaxBytes: number } | null}
 */
export function parseMuseConfigFromEnv(env = process.env) {
  const base = String(env.MUSE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) return null;
  if (!base.startsWith('http://') && !base.startsWith('https://')) return null;
  try {
    void new URL(base);
  } catch {
    return null;
  }
  const apiKey =
    env.MUSE_API_KEY != null && String(env.MUSE_API_KEY).trim()
      ? String(env.MUSE_API_KEY).trim()
      : '';
  const lineageTimeoutMs = Math.min(
    60_000,
    Math.max(
      1000,
      parseInt(String(env.MUSE_LINEAGE_TIMEOUT_MS || DEFAULT_LINEAGE_TIMEOUT_MS), 10) ||
        DEFAULT_LINEAGE_TIMEOUT_MS,
    ),
  );
  const proxyMaxBytes = Math.min(
    10 * 1024 * 1024,
    Math.max(
      1024,
      parseInt(String(env.MUSE_PROXY_MAX_BYTES || DEFAULT_PROXY_MAX_BYTES), 10) ||
        DEFAULT_PROXY_MAX_BYTES,
    ),
  );
  return { baseUrl: base, apiKey, lineageTimeoutMs, proxyMaxBytes };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function parseMuseProxyPathPrefixes(env = process.env) {
  const raw = env.MUSE_PROXY_PATH_PREFIXES || '/knowtation/v1/';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`));
}

/**
 * @param {string} relPath
 * @param {string[]} prefixes
 * @returns {boolean}
 */
export function isAllowedMuseProxyPath(relPath, prefixes) {
  const path = String(relPath || '').trim();
  if (!path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes('..') || decoded.includes('\\')) return false;
  for (const pre of prefixes) {
    const preNorm = pre.endsWith('/') ? pre.slice(0, -1) : pre;
    if (decoded === preNorm) return true;
    const withSlash = pre.endsWith('/') ? pre : `${pre}/`;
    if (decoded.startsWith(withSlash)) return true;
  }
  return false;
}

function lineageRefUrl(baseUrl, proposalId, vaultId) {
  const u = new URL(MUSE_LINEAGE_REF_PATH.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`);
  u.searchParams.set('proposal_id', proposalId);
  u.searchParams.set('vault_id', vaultId);
  return u.href;
}

/**
 * Prefer client-supplied ref; else optional GET lineage-ref. Never throws.
 *
 * @param {{
 *   clientRef: unknown,
 *   proposalId: string,
 *   vaultId: string,
 *   config: ReturnType<typeof parseMuseConfigFromEnv>,
 *   fetchFn?: typeof fetch,
 *   logWarn?: (msg: string, extra?: Record<string, unknown>) => void,
 * }} opts
 * @returns {Promise<string>}
 */
export async function resolveExternalRefForApprove({
  clientRef,
  proposalId,
  vaultId,
  config,
  fetchFn = globalThis.fetch,
  logWarn = (msg, extra) => console.warn(msg, extra ?? ''),
}) {
  const fromClient = normalizeExternalRef(clientRef);
  if (fromClient) return fromClient;
  if (!config) return '';
  const pid = String(proposalId || '').trim();
  const vid = String(vaultId || 'default').trim() || 'default';
  if (!pid) return '';
  const url = lineageRefUrl(config.baseUrl, pid, vid);
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), config.lineageTimeoutMs);
  try {
    const res = await fetchFn(url, { method: 'GET', headers, signal: ac.signal });
    if (!res.ok) {
      logWarn('[knowtation:muse-bridge] lineage-ref request failed', { status: res.status });
      return '';
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      logWarn('[knowtation:muse-bridge] lineage-ref invalid JSON', {});
      return '';
    }
    const ref = data && typeof data.external_ref === 'string' ? data.external_ref : '';
    return normalizeExternalRef(ref);
  } catch (e) {
    const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
    logWarn('[knowtation:muse-bridge] lineage-ref unreachable', { message });
    return '';
  } finally {
    clearTimeout(t);
  }
}

/**
 * Admin read-only proxy: GET only, allowlisted path, size cap.
 *
 * @param {{
 *   config: NonNullable<ReturnType<typeof parseMuseConfigFromEnv>>,
 *   relativePath: string,
 *   fetchFn?: typeof fetch,
 *   logWarn?: (msg: string, extra?: Record<string, unknown>) => void,
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 * @returns {Promise<{ ok: true, status: number, body: Buffer, contentType: string } | { ok: false, status: number, code: string, body: Buffer | null, contentType: string | null }>}
 */
export async function fetchMuseProxiedGet({
  config,
  relativePath,
  fetchFn = globalThis.fetch,
  logWarn = (msg, extra) => console.warn(msg, extra ?? ''),
  env = process.env,
}) {
  const prefixes = parseMuseProxyPathPrefixes(env);
  if (!isAllowedMuseProxyPath(relativePath, prefixes)) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', body: null, contentType: null };
  }
  const base = config.baseUrl.replace(/\/+$/, '');
  const rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const url = `${base}${rel}`;
  /** @type {Record<string, string>} */
  const headers = { Accept: '*/*' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), config.lineageTimeoutMs);
  try {
    const res = await fetchFn(url, { method: 'GET', headers, signal: ac.signal });
    const ct = res.headers.get('content-type') || 'application/octet-stream';
    const buf = await res.arrayBuffer();
    if (buf.byteLength > config.proxyMaxBytes) {
      logWarn('[knowtation:muse-bridge] proxy response too large', { bytes: buf.byteLength });
      return { ok: false, status: 502, code: 'BAD_GATEWAY', body: null, contentType: null };
    }
    const body = Buffer.from(buf);
    if (!res.ok) {
      return { ok: false, status: res.status, code: 'UPSTREAM', body, contentType: ct };
    }
    return { ok: true, status: res.status, body, contentType: ct };
  } catch (e) {
    const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
    logWarn('[knowtation:muse-bridge] proxy fetch failed', { message });
    return { ok: false, status: 502, code: 'BAD_GATEWAY', body: null, contentType: null };
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} pathOnlyForBody
 * @returns {string | null} proposal id
 */
export function proposalIdFromApprovePath(pathOnlyForBody) {
  const m = String(pathOnlyForBody || '').match(/^\/api\/v1\/proposals\/([^/]+)\/approve\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}
