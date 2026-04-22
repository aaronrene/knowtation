/**
 * SSRF-hardened HTTP fetch for URL import: HTTPS only, DNS re-check each redirect hop,
 * response size cap, timeout.
 */

import dns from 'node:dns/promises';

/** @type {readonly RegExp[]} */
const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
];

/**
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrBlockedIp(ip) {
  if (!ip || ip === '0.0.0.0') return true;
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return PRIVATE_IPV4.some((r) => r.test(ip));
}

/**
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function assertHostnameResolvesToPublicIp(hostname) {
  if (!hostname || typeof hostname !== 'string') throw new Error('Invalid hostname');
  const h = hostname.trim().toLowerCase();
  if (h === 'localhost' || h === '[::1]') throw new Error('Requests to localhost are blocked (SSRF protection)');
  if (h.endsWith('.local')) throw new Error('Requests to .local hosts are blocked (SSRF protection)');
  try {
    const { address } = await dns.lookup(h);
    if (isPrivateOrBlockedIp(address)) {
      throw new Error(`Requests to private IP ranges are blocked (resolved ${h} -> ${address})`);
    }
  } catch (e) {
    if (e && typeof e.message === 'string' && e.message.includes('blocked')) throw e;
    throw new Error(`DNS resolution failed for ${h}: ${e.message || e}`);
  }
}

/**
 * @param {string} urlString
 * @returns {URL}
 */
function parseHttpsUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) throw new Error('URL is required');
  let u;
  try {
    u = new URL(urlString.trim());
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'https:') throw new Error('Only https:// URLs are allowed');
  if (!u.hostname) throw new Error('URL must include a hostname');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed');
  return u;
}

/**
 * @param {string} urlString
 * @param {{ maxBytes?: number, timeoutMs?: number, maxRedirects?: number, userAgent?: string }} [opts]
 * @returns {Promise<{ finalUrl: string, status: number, contentType: string, text: string }>}
 */
export async function fetchUrlForImport(urlString, opts = {}) {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRedirects = opts.maxRedirects ?? 8;
  const userAgent = opts.userAgent ?? 'Knowtation-UrlImport/1.0';

  let current = parseHttpsUrl(urlString);
  await assertHostnameResolvesToPublicIp(current.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hop === maxRedirects) {
          throw new Error(loc ? 'Too many redirects' : `HTTP ${res.status} without Location`);
        }
        let next;
        try {
          next = new URL(loc, current.href);
        } catch {
          throw new Error('Invalid redirect Location');
        }
        if (next.protocol !== 'https:') throw new Error('Redirect to non-https URL is not allowed');
        if (next.username || next.password) throw new Error('Redirect URL must not contain credentials');
        current = next;
        await assertHostnameResolvesToPublicIp(current.hostname);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${errText ? `: ${errText.slice(0, 200)}` : ''}`);
      }

      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const text = await readTextBodyLimited(res, maxBytes);
      clearTimeout(timer);
      return {
        finalUrl: current.href,
        status: res.status,
        contentType,
        text,
      };
    }
    throw new Error('Too many redirects');
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`URL fetch timed out after ${timeoutMs}ms`);
    throw e;
  }
}

/**
 * @param {Response} res
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
async function readTextBodyLimited(res, maxBytes) {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error(`Response body exceeds ${maxBytes} bytes`);
    return Buffer.from(buf).toString('utf8');
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch (_) {}
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
