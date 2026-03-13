/**
 * MIF (Memory Interchange Format) importer. Copy .memory.md or folder into vault.
 * Add source: mif; optionally normalize frontmatter (mif:id -> source_id).
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { parseFrontmatterAndBody, normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to .memory.md, .memory.json, or folder of MIF files
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importMIF(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }

  const files = [];
  if (fs.statSync(absInput).isFile()) {
    if (absInput.endsWith('.memory.md') || absInput.endsWith('.memory.json') || absInput.endsWith('.md')) {
      files.push({ fullPath: absInput, relPath: path.basename(absInput).replace(/\.memory\.(md|json)$/, '.md') });
    }
  } else {
    walkMIF(absInput, absInput, '', files);
  }

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (const { fullPath, relPath } of files) {
    const ext = path.extname(fullPath);
    let content, frontmatter = {}, body = '';

    if (ext === '.json') {
      const raw = fs.readFileSync(fullPath, 'utf8');
      let mif;
      try {
        mif = JSON.parse(raw);
      } catch (e) {
        continue; // skip invalid JSON
      }
      body = typeof mif.content === 'string' ? mif.content : (mif.text || JSON.stringify(mif));
      frontmatter = mif.metadata || mif.frontmatter || {};
      if (mif.id) frontmatter.source_id = mif.id;
    } else {
      content = fs.readFileSync(fullPath, 'utf8');
      const parsed = parseFrontmatterAndBody(content);
      frontmatter = { ...parsed.frontmatter };
      body = parsed.body;
    }

    frontmatter.source = 'mif';
    frontmatter.date = frontmatter.date || frontmatter.created || now;
    if (frontmatter['mif:id'] && !frontmatter.source_id) frontmatter.source_id = frontmatter['mif:id'];
    if (project) frontmatter.project = normalizeSlug(project);
    if (tags.length) frontmatter.tags = [...new Set([...(Array.isArray(frontmatter.tags) ? frontmatter.tags : []), ...tags])];

    const outputRel = path.join(outputBase, relPath).replace(/\\/g, '/');
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(frontmatter).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter: cleanFrontmatter });
    }
    imported.push({ path: outputRel, source_id: frontmatter.source_id });
  }

  return { imported, count: imported.length };
}

function walkMIF(rootDir, dir, relDir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walkMIF(rootDir, path.join(dir, e.name), rel, out);
    } else if (e.name.endsWith('.memory.md') || e.name.endsWith('.memory.json')) {
      const outName = e.name.replace(/\.memory\.(md|json)$/, '.md');
      out.push({ fullPath: path.join(dir, e.name), relPath: (relDir ? `${relDir}/` : '') + outName });
    }
  }
}
