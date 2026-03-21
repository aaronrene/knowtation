/**
 * Generic Markdown importer. Path to file or folder; add source: markdown, date if missing.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { parseFrontmatterAndBody, normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to .md file or folder of .md files
 * @param {{
 *   vaultPath: string,
 *   outputBase: string,
 *   project?: string,
 *   tags: string[],
 *   dryRun: boolean,
 *   onProgress?: (p: { progress: number, total?: number, message?: string }) => void | Promise<void>
 * }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importMarkdown(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun, onProgress } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }

  const files = [];
  if (fs.statSync(absInput).isFile()) {
    if (absInput.endsWith('.md')) files.push({ fullPath: absInput, relPath: path.basename(absInput) });
  } else {
    walkMarkdown(absInput, absInput, '', files);
  }

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);
  const totalFiles = files.length;
  let lastProgressIdx = 0;
  let lastProgressMs = 0;

  for (let fi = 0; fi < files.length; fi++) {
    const { fullPath, relPath } = files[fi];
    const outputRel = path.join(outputBase, relPath).replace(/\\/g, '/');

    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatterAndBody(content);
    const dateRaw = frontmatter.date || frontmatter.created || now;
    const date = normalizeDate(dateRaw) || now;
    const merged = {
      ...frontmatter,
      source: 'markdown',
      date,
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };
    if (typeof merged.tags === 'string') merged.tags = tags;
    else if (Array.isArray(merged.tags)) merged.tags = [...new Set([...merged.tags, ...tags])];
    else merged.tags = tags;

    if (!dryRun) {
      writeNote(vaultPath, outputRel, {
        body,
        frontmatter: Object.fromEntries(
          Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== '')
        ),
      });
    }
    imported.push({ path: outputRel, source_id: relPath });

    if (onProgress && totalFiles > 0) {
      const n = fi + 1;
      const nowMs = Date.now();
      const force = n === 1 || n === totalFiles || totalFiles <= 10;
      if (force || n - lastProgressIdx >= 10 || nowMs - lastProgressMs >= 5000) {
        lastProgressIdx = n;
        lastProgressMs = nowMs;
        await onProgress({
          progress: n,
          total: totalFiles,
          message: `markdown import ${n}/${totalFiles}: ${relPath}`,
        });
      }
    }
  }

  return { imported, count: imported.length };
}

function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function walkMarkdown(rootDir, dir, relDir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walkMarkdown(rootDir, path.join(dir, e.name), rel, out);
    } else if (e.name.endsWith('.md')) {
      out.push({ fullPath: path.join(dir, e.name), relPath: rel.replace(/\\/g, '/') });
    }
  }
}
