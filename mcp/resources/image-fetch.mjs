/**
 * Secure image fetcher for MCP image resources (Phase 18A).
 * Fetches an image URL and returns base64 blob with MIME type.
 * Defences: HTTPS-only, SSRF blocklist, size cap, timeout, Content-Type validation.
 */

import dns from 'node:dns/promises';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 8000;

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd/i,
];

function isPrivateIp(ip) {
  if (!ip) return true;
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

/**
 * @param {string} url
 * @param {{ maxBytes?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ blob: string, mimeType: string, byteLength: number }>}
 */
export async function fetchImageAsBase64(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Only https:// image URLs are allowed');
  }

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error('Invalid URL');
  }

  if (/^localhost$/i.test(hostname) || hostname === '[::1]') {
    throw new Error('Requests to localhost are blocked (SSRF protection)');
  }

  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIp(address)) {
      throw new Error(`Requests to private IP ranges are blocked (resolved ${hostname} -> ${address})`);
    }
  } catch (e) {
    if (e.message && e.message.includes('blocked')) throw e;
    throw new Error(`DNS resolution failed for ${hostname}: ${e.message || e}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Knowtation-MCP/1.0',
        Accept: 'image/*',
      },
      redirect: 'follow',
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`Image fetch timed out after ${timeoutMs}ms`);
    throw new Error(`Image fetch failed: ${e.message || e}`);
  }

  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Image fetch returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Expected image/* Content-Type, got: ${contentType}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Image exceeds size limit (${contentLength} bytes > ${maxBytes} bytes)`);
  }

  const arrayBuf = await response.arrayBuffer();
  if (arrayBuf.byteLength > maxBytes) {
    throw new Error(`Image exceeds size limit (${arrayBuf.byteLength} bytes > ${maxBytes} bytes)`);
  }

  const buffer = Buffer.from(arrayBuf);
  const blob = buffer.toString('base64');

  const mimeType = contentType.split(';')[0].trim();

  return { blob, mimeType, byteLength: buffer.byteLength };
}

export { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS };
