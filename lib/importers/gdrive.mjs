/**
 * Google Drive import. Accepts a folder of Markdown files (e.g. from export, Takeout conversion, or sync script).
 * One note per file; frontmatter: source: gdrive, source_id from filename or path.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { parseFrontmatterAndBody, normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to folder containing .md files
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importGDrive(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}. Use a folder of Markdown files (e.g. exported from Google Docs).`);
  }
  if (fs.statSync(absInput).isFile()) {
    throw new Error('GDrive import expects a folder of .md files. Export Docs as Markdown or use a sync script, then pass the folder path.');
  }

  const files = [];
  walkMarkdown(absInput, absInput, '', files);
  if (files.length === 0) {
    throw new Error('No .md files found in folder. Add Markdown files (e.g. from Google Docs export or pandoc conversion).');
  }

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (const { fullPath, relPath } of files) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatterAndBody(content);
    const date = (frontmatter.date && String(frontmatter.date).slice(0, 10)) || now;
    const outputRel = path.join(outputBase, relPath).replace(/\\/g, '/');
    const sourceId = frontmatter.source_id || path.basename(relPath, '.md');
    const merged = {
      ...frontmatter,
      source: 'gdrive',
      source_id: sourceId,
      date,
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, {
        body,
        frontmatter: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== '')),
      });
    }
    imported.push({ path: outputRel, source_id: sourceId });
  }

  return { imported, count: imported.length };
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
