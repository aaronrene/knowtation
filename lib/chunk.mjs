/**
 * Chunk Markdown for indexing. Split by heading or fixed size; configurable overlap.
 * SPEC §5: path, project, tags, date on each chunk; stable chunk id for upsert.
 */

/**
 * Default chunk size in characters (~512 tokens at ~4 chars/token). Overlap in chars.
 */
const DEFAULT_CHUNK_SIZE = 2048;
const DEFAULT_CHUNK_OVERLAP = 256;

/**
 * Split text into chunks by heading (## or ###) first, then by size with overlap.
 * @param {string} text - Markdown body (no frontmatter)
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {string[]} Chunk texts
 */
function splitByHeadingOrSize(text, options = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split by ## or ### (headings)
  const sections = trimmed.split(/(?=^#{2,3}\s)/m).map((s) => s.trim()).filter(Boolean);
  const out = [];

  for (const section of sections) {
    if (section.length <= chunkSize) {
      out.push(section);
    } else {
      // Fixed-size split with overlap
      let start = 0;
      while (start < section.length) {
        let end = start + chunkSize;
        if (end < section.length) {
          // Try to break at sentence or newline
          const slice = section.slice(start, end);
          const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
          if (lastBreak > chunkSize / 2) {
            end = start + lastBreak + 1;
          }
        } else {
          end = section.length;
        }
        out.push(section.slice(start, end).trim());
        if (end >= section.length) break;
        start = end - chunkOverlap;
        if (start < 0) start = 0;
      }
    }
  }

  return out.filter(Boolean);
}

/**
 * Build chunks for one note. Each chunk has text and metadata (path, project, tags, date).
 * @param {{ body: string, path: string, project?: string, tags?: string[], date?: string }} note - From vault.readNote
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {{ id: string, text: string, path: string, project?: string, tags: string[], date?: string }[]}
 */
export function chunkNote(note, options = {}) {
  const chunks = splitByHeadingOrSize(note.body, options);
  const path = note.path.replace(/\\/g, '/');
  const project = note.project || undefined;
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const date = note.date || undefined;

  return chunks.map((text, index) => ({
    id: stableChunkId(path, index),
    text,
    path,
    project,
    tags,
    date,
  }));
}

/**
 * Stable chunk id for upsert (no duplicates on re-run). SPEC §5.
 * @param {string} vaultRelativePath
 * @param {number} index
 * @returns {string}
 */
export function stableChunkId(vaultRelativePath, index) {
  const safe = vaultRelativePath.replace(/\\/g, '/').replace(/[^a-zA-Z0-9/._-]/g, '_');
  return `${safe}_${index}`;
}

export { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, splitByHeadingOrSize };
