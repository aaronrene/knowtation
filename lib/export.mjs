/**
 * Export note(s) to file or directory. Formats: md, html. Provenance. SPEC §4.1.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { readNote } from './vault.mjs';

/**
 * Escape HTML for minimal HTML export.
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Export one note to HTML (minimal wrapper).
 * @param {{ path: string, frontmatter: object, body: string }} note
 * @returns {string}
 */
function noteToHtml(note) {
  const title = note.frontmatter?.title || note.path;
  const body = note.body || '';
  const bodyEscaped = escapeHtml(body).replace(/\n/g, '<br>\n');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<pre>${bodyEscaped}</pre>
</body>
</html>`;
}

/**
 * Export notes to output path (file or directory). Records provenance.
 * @param {string} vaultPath - Absolute vault root
 * @param {string[]} relativePaths - Vault-relative paths to export
 * @param {string} outputPath - File path or directory path
 * @param {{ format?: 'md'|'html' }} options
 * @returns {{ exported: { path: string, output: string }[], provenance: string }}
 */
export function exportNotes(vaultPath, relativePaths, outputPath, options = {}) {
  const format = options.format || 'md';
  const resolvedOutput = path.resolve(outputPath);
  const exists = fs.existsSync(resolvedOutput);
  const isDir =
    relativePaths.length > 1 ||
    (exists && fs.statSync(resolvedOutput).isDirectory()) ||
    (!exists && !resolvedOutput.endsWith('.md') && !resolvedOutput.endsWith('.html'));
  const exported = [];

  for (const rel of relativePaths) {
    let note;
    try {
      note = readNote(vaultPath, rel);
    } catch (e) {
      throw new Error(`Export failed: ${e.message}`);
    }

    const base = path.basename(rel, '.md') || path.basename(rel);
    const outPath = isDir
      ? path.join(resolvedOutput, format === 'html' ? `${base}.html` : `${base}.md`)
      : resolvedOutput;

    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (format === 'html') {
      const html = noteToHtml(note);
      fs.writeFileSync(outPath, html, 'utf8');
    } else {
      const frontmatterWithProvenance = {
        ...note.frontmatter,
        source_notes: relativePaths,
      };
      const y = yaml.dump(frontmatterWithProvenance, { lineWidth: -1, noRefs: true }).trimEnd();
      fs.writeFileSync(outPath, `---\n${y}\n---\n${note.body || ''}`, 'utf8');
    }

    exported.push({ path: rel, output: outPath });
  }

  const provenance = relativePaths.length ? `Exported from vault paths: ${relativePaths.join(', ')}` : '';
  return { exported, provenance };
}
