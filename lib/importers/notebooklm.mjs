/**
 * NotebookLM import. Accepts (1) a folder of markdown files (e.g. from Google takeout or Apify export),
 * or (2) a JSON file with an array of sources/conversations. One note per file or per entry.
 * Frontmatter: source: notebooklm, source_id from filename or entry id.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { parseFrontmatterAndBody, normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to folder of .md files or to a .json export
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importNotebookLM(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}. Use a folder of markdown files or a NotebookLM export JSON.`);
  }

  if (fs.statSync(absInput).isFile()) {
    if (absInput.endsWith('.json')) {
      return importNotebookLMJson(absInput, ctx);
    }
    throw new Error('NotebookLM import expects a folder of .md files or a .json export file.');
  }

  const files = [];
  walkMarkdown(absInput, absInput, '', files);
  if (files.length === 0) {
    throw new Error('No .md files found in folder. Export NotebookLM sources to markdown (e.g. Google takeout or Apify), then pass the folder.');
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
      source: 'notebooklm',
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

async function importNotebookLMJson(jsonPath, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const raw = fs.readFileSync(jsonPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  const entries = Array.isArray(data) ? data : (data.sources || data.conversations || data.notes || []);
  if (!Array.isArray(entries)) {
    throw new Error('JSON must be an array or have sources/conversations/notes array.');
  }

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const body = e.content || e.text || e.markdown || e.body || JSON.stringify(e);
    const sourceId = e.id || e.source_id || e.name || `notebooklm-${i}`;
    const safeName = String(sourceId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) + '.md';
    const outputRel = path.join(outputBase, safeName).replace(/\\/g, '/');
    const date = e.created_at || e.date || now;
    const d = typeof date === 'number' ? new Date(date).toISOString().slice(0, 10) : String(date).slice(0, 10);

    const frontmatter = {
      source: 'notebooklm',
      source_id: String(sourceId).slice(0, 128),
      date: d,
      ...(e.title && { title: e.title }),
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body: String(body).trim(), frontmatter });
    }
    imported.push({ path: outputRel, source_id: frontmatter.source_id });
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
