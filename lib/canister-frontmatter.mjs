/**
 * Hub canister note APIs return `frontmatter` as JSON **text** (Motoko escapes it in the outer JSON).
 * Browsers/clients may also see an extra JSON string layer. Parse to an object for `title` and friends.
 */

/**
 * @param {unknown} fm
 * @returns {Record<string, unknown>|null}
 */
export function parseCanisterFrontmatter(fm) {
  if (fm == null) return null;
  if (typeof fm === 'object' && !Array.isArray(fm)) return /** @type {Record<string, unknown>} */ (fm);
  if (typeof fm !== 'string') return null;
  let s = fm.trim();
  if (!s || s === '{}') return null;

  const tryParseObject = (t) => {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object' && !Array.isArray(o)) return /** @type {Record<string, unknown>} */ (o);
      if (typeof o === 'string') return tryParseObject(o.trim());
      return null;
    } catch {
      return null;
    }
  };

  let o = tryParseObject(s);
  if (o) return o;

  if (/\\"/.test(s)) {
    o = tryParseObject(s.replace(/\\"/g, '"'));
    if (o) return o;
  }

  if (s.startsWith('"') && s.endsWith('"')) {
    o = tryParseObject(JSON.parse(s));
    if (o) return o;
  }

  return null;
}

/**
 * @param {unknown} fm
 * @returns {string|null}
 */
export function titleFromCanisterFrontmatter(fm) {
  const o = parseCanisterFrontmatter(fm);
  if (!o || o.title == null) return null;
  const t = String(o.title).trim();
  return t !== '' ? t : null;
}
