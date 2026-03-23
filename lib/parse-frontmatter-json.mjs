/**
 * Parse hosted canister `frontmatter` wire values (JSON object text, sometimes JSON-string-wrapped).
 * Must tolerate BOM, quoted JSON blobs, and multi-layer string encoding from the ICP/gateway chain.
 * @param {unknown} t
 * @returns {Record<string, unknown>}
 */
export function parseFrontmatterJsonText(t) {
  let cur = String(t ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!cur) return {};
  for (let i = 0; i < 8; i++) {
    try {
      const o = JSON.parse(cur);
      if (o !== null && typeof o === 'object' && !Array.isArray(o)) {
        return /** @type {Record<string, unknown>} */ (o);
      }
      if (typeof o === 'string') {
        const next = o.trim();
        if (next === cur) return {};
        cur = next;
        continue;
      }
      return {};
    } catch {
      // Value may be a JSON *string literal* whose contents are more JSON text.
      if (cur.length >= 2 && cur.charCodeAt(0) === 34) {
        try {
          const inner = JSON.parse(cur);
          if (typeof inner === 'string') {
            cur = inner.trim();
            continue;
          }
        } catch {
          /* fall through */
        }
      }
      return {};
    }
  }
  return {};
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function materializeWireFrontmatter(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw);
  }
  if (typeof raw === 'string') return parseFrontmatterJsonText(raw);
  return {};
}
