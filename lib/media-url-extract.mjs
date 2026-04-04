/**
 * Extract image and video URLs from markdown note bodies.
 * Foundation for Phase 18 MCP image/video resources and Hub rendering.
 */

const MAX_URLS_PER_NOTE = 50;

const IMAGE_EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const VIDEO_EXT_MIME = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const IMAGE_EXTENSIONS = Object.keys(IMAGE_EXT_MIME);
const VIDEO_EXTENSIONS = Object.keys(VIDEO_EXT_MIME);

/**
 * Strip query string and fragment from a URL for extension detection.
 * @param {string} url
 * @returns {string} extension without dot, lowercased
 */
function extractExtension(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return '';
    return pathname.slice(dot + 1).toLowerCase();
  } catch {
    const clean = url.split('?')[0].split('#')[0];
    const dot = clean.lastIndexOf('.');
    if (dot === -1) return '';
    return clean.slice(dot + 1).toLowerCase();
  }
}

/**
 * Markdown image syntax: ![alt](url)
 * Captures: group 1 = alt text, group 2 = URL
 */
const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;

/**
 * Bare URL on its own line (not inside markdown link/image syntax).
 * Matches lines that are just a URL (with optional whitespace).
 */
const BARE_URL_LINE_RE = /^[ \t]*(https?:\/\/[^\s]+)[ \t]*$/gm;

/**
 * Extract image URLs from a markdown body.
 * Finds both `![alt](url)` syntax and bare image URLs on their own line.
 * @param {string} body
 * @returns {Array<{ alt: string, url: string, mimeType: string }>}
 */
export function extractImageUrls(body) {
  if (!body || typeof body !== 'string') return [];

  const seen = new Set();
  const results = [];

  function addIfImage(url, alt) {
    if (results.length >= MAX_URLS_PER_NOTE) return;
    const trimmed = url.trim();
    if (seen.has(trimmed)) return;
    if (/^data:/i.test(trimmed)) return;
    const ext = extractExtension(trimmed);
    if (!IMAGE_EXTENSIONS.includes(ext)) return;
    if (VIDEO_EXTENSIONS.includes(ext)) return;
    seen.add(trimmed);
    results.push({
      alt: alt || '',
      url: trimmed,
      mimeType: IMAGE_EXT_MIME[ext] || 'image/png',
    });
  }

  let m;
  MD_IMAGE_RE.lastIndex = 0;
  while ((m = MD_IMAGE_RE.exec(body)) !== null) {
    const url = m[2];
    const ext = extractExtension(url);
    if (VIDEO_EXTENSIONS.includes(ext)) continue;
    addIfImage(url, m[1]);
  }

  BARE_URL_LINE_RE.lastIndex = 0;
  while ((m = BARE_URL_LINE_RE.exec(body)) !== null) {
    addIfImage(m[1], '');
  }

  return results;
}

/**
 * Extract video URLs from a markdown body.
 * Finds bare video URLs and video URLs inside `![alt](url)` syntax.
 * @param {string} body
 * @returns {Array<{ url: string, mimeType: string }>}
 */
export function extractVideoUrls(body) {
  if (!body || typeof body !== 'string') return [];

  const seen = new Set();
  const results = [];

  function addIfVideo(url) {
    if (results.length >= MAX_URLS_PER_NOTE) return;
    const trimmed = url.trim();
    if (seen.has(trimmed)) return;
    if (/^data:/i.test(trimmed)) return;
    const ext = extractExtension(trimmed);
    if (!VIDEO_EXTENSIONS.includes(ext)) return;
    seen.add(trimmed);
    results.push({
      url: trimmed,
      mimeType: VIDEO_EXT_MIME[ext] || 'video/mp4',
    });
  }

  let m;
  MD_IMAGE_RE.lastIndex = 0;
  while ((m = MD_IMAGE_RE.exec(body)) !== null) {
    addIfVideo(m[2]);
  }

  BARE_URL_LINE_RE.lastIndex = 0;
  while ((m = BARE_URL_LINE_RE.exec(body)) !== null) {
    addIfVideo(m[1]);
  }

  return results;
}

export { MAX_URLS_PER_NOTE, IMAGE_EXT_MIME, VIDEO_EXT_MIME };
