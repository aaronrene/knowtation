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

/**
 * First ATX `# heading` in the note body (canister stores body without the YAML block).
 * @param {unknown} body
 * @returns {string|null}
 */
export function titleFromMarkdownBody(body) {
  if (typeof body !== 'string' || !body.trim()) return null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s{0,3}#\s+(.+?)\s*$/.exec(line);
    if (m) {
      let t = m[1].trim();
      t = t.replace(/\s+#+\s*$/, '').trim();
      return t || null;
    }
  }
  return null;
}

/**
 * @param {unknown} path vault-relative path
 * @returns {string|null}
 */
export function titleFromPathStem(path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  const base = path.split('/').pop() || path;
  const stem = base.replace(/\.md$/i, '');
  if (!stem) return null;
  return stem.replace(/[-_]/g, ' ').trim() || null;
}

/**
 * Title for relate / list-style UX when `frontmatter.title` is absent (common on hosted notes).
 * Order: JSON `title` → first `#` line in body → filename stem.
 *
 * @param {{ frontmatter?: unknown, body?: unknown, path?: unknown }} note
 * @returns {string|null}
 */
export function displayTitleFromHostedNote(note) {
  if (!note || typeof note !== 'object') return null;
  const pth = note.path != null ? String(note.path) : '';
  const fromFm = titleFromCanisterFrontmatter(note.frontmatter);
  if (fromFm) return fromFm;
  const fromBody = titleFromMarkdownBody(note.body != null ? String(note.body) : '');
  if (fromBody) return fromBody;
  return titleFromPathStem(pth);
}
