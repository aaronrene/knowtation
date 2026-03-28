/**
 * Canonical optimistic-concurrency id for vault notes (Hub proposals approve check).
 * Format: kn1_<16 hex chars> = FNV-1a 64-bit over UTF-8 bytes (documented in docs/PROPOSAL-LIFECYCLE.md).
 * Absent note: hash of single byte 0x00 (so new-file proposals can require "still absent").
 */

/**
 * @param {Buffer} buf
 * @returns {string} 16 lowercase hex chars
 */
export function fnv1a64Hex(buf) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < buf.length; i++) {
    h ^= BigInt(buf[i]);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Deterministic JSON stringify with sorted object keys (no arrays in frontmatter required for v1).
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((x) => stableStringify(x)).join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * State id when the note path has no file (create flow).
 * @returns {string}
 */
export function absentNoteStateId() {
  return 'kn1_' + fnv1a64Hex(Buffer.from([0x00]));
}

/**
 * State id from parsed frontmatter object + body (matches Hub readNote semantics).
 * @param {Record<string, unknown>} frontmatter
 * @param {string} body
 * @returns {string}
 */
export function noteStateIdFromParts(frontmatter, body) {
  const fm = stableStringify(frontmatter && typeof frontmatter === 'object' ? frontmatter : {});
  const payload = `${fm}\0${body ?? ''}`;
  return 'kn1_' + fnv1a64Hex(Buffer.from(payload, 'utf8'));
}

/**
 * Hash exact frontmatter JSON text + body (hosted canister / string responses).
 * @param {string} frontmatterJsonText
 * @param {string} body
 * @returns {string}
 */
export function noteStateIdFromRawStrings(frontmatterJsonText, body) {
  const fm = typeof frontmatterJsonText === 'string' ? frontmatterJsonText : '';
  const payload = `${fm}\0${body ?? ''}`;
  return 'kn1_' + fnv1a64Hex(Buffer.from(payload, 'utf8'));
}

/**
 * Derive kn1_ id from a Hub GET /notes/:path JSON payload (object or string frontmatter).
 * @param {{ frontmatter?: unknown, body?: string }} data
 * @returns {string}
 */
export function noteStateIdFromHubNoteJson(data) {
  const body = data?.body ?? '';
  const fm = data?.frontmatter;
  if (typeof fm === 'string') {
    return noteStateIdFromRawStrings(fm, body);
  }
  return noteStateIdFromParts(fm && typeof fm === 'object' ? fm : {}, body);
}
