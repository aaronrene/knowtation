/**
 * Companion App — Phase 5 download adapter.
 *
 * A deliberately dumb HTTPS byte pump: it verifies transport, streams chunks in
 * order, and makes no integrity decision. The shell owns hashing and finalization.
 */

import https from 'node:https';

export const DOWNLOAD_ADAPTER_REASONS = Object.freeze({
  HTTPS_REQUIRED: 'https_required',
  DOWNLOAD_FAILED: 'download_failed',
  BAD_STATUS: 'bad_status',
  BAD_CHUNK: 'bad_chunk',
});

/**
 * Validate that a model download URL uses HTTPS.
 * @param {unknown} url
 * @returns {URL}
 */
export function requireHttpsDownloadUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError(DOWNLOAD_ADAPTER_REASONS.HTTPS_REQUIRED);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(DOWNLOAD_ADAPTER_REASONS.HTTPS_REQUIRED);
  }
  if (parsed.protocol !== 'https:') {
    throw new TypeError(DOWNLOAD_ADAPTER_REASONS.HTTPS_REQUIRED);
  }
  return parsed;
}

/**
 * Create the Phase 5 HTTPS streaming adapter.
 * @param {{ get?: typeof https.get }} [deps]
 * @returns {{ download: (url: string, onChunk: (chunk: Uint8Array) => void) => Promise<void> }}
 */
export function createCompanionDownloadAdapter(deps = {}) {
  const get = deps.get ?? https.get;
  return {
    async download(url, onChunk) {
      const parsed = requireHttpsDownloadUrl(url);
      if (typeof onChunk !== 'function') {
        throw new TypeError(DOWNLOAD_ADAPTER_REASONS.BAD_CHUNK);
      }
      await new Promise((resolve, reject) => {
        const req = get(parsed, { rejectUnauthorized: true }, (res) => {
          if (!res || typeof res.statusCode !== 'number' || res.statusCode < 200 || res.statusCode >= 300) {
            res?.resume?.();
            reject(new Error(DOWNLOAD_ADAPTER_REASONS.BAD_STATUS));
            return;
          }
          res.on('data', (chunk) => {
            if (!(chunk instanceof Uint8Array) && !Buffer.isBuffer(chunk)) {
              reject(new Error(DOWNLOAD_ADAPTER_REASONS.BAD_CHUNK));
              return;
            }
            try {
              onChunk(chunk);
            } catch {
              reject(new Error(DOWNLOAD_ADAPTER_REASONS.BAD_CHUNK));
            }
          });
          res.on('end', resolve);
          res.on('error', () => reject(new Error(DOWNLOAD_ADAPTER_REASONS.DOWNLOAD_FAILED)));
        });
        req.on('error', () => reject(new Error(DOWNLOAD_ADAPTER_REASONS.DOWNLOAD_FAILED)));
        req.end();
      });
    },
  };
}
