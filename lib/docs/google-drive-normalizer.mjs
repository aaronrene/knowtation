/**
 * Pure Google Drive metadata normalization and query validation.
 */

export const ALLOWED_DRIVE_MIMES = Object.freeze([
  'application/vnd.google-apps.document',
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_MIME_SET = new Set(ALLOWED_DRIVE_MIMES);
export const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const LIST_Q_RE = /^[A-Za-z0-9 ._-]{1,128}$/;

/**
 * Return true only for the frozen D15 note MIME allowlist. Drive folders are
 * deliberately absent because they are containers, not importable notes.
 * @param {unknown} mime
 */
export function isImportableMime(mime) {
  return typeof mime === 'string' && ALLOWED_MIME_SET.has(mime);
}

/**
 * Convert an untrusted provider id to a bounded path segment.
 * @param {unknown} providerId
 */
export function safeId(providerId) {
  return String(providerId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/**
 * Build a Drive API `name contains` expression only after strict allowlist
 * validation. No caller-supplied query syntax is accepted.
 * @param {unknown} q
 * @returns {string|null}
 */
export function buildDriveNameContainsQuery(q) {
  if (typeof q !== 'string' || !LIST_Q_RE.test(q)) return null;
  const escaped = q.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `name contains '${escaped}'`;
}
