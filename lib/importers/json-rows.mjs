/**
 * Import a JSON file whose root is an array of objects (one note per object).
 * Frontmatter: provenance + optional title; body holds the full object as fenced JSON.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

const MAX_ITEMS = 10_000;
const MAX_JSON_BYTES = 50 * 1024 * 1024;

/**
 * @param {string} input
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 */
export async function importJsonRows(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error('json-rows import expects a path to a .json file.');
  }
  if (!absInput.toLowerCase().endsWith('.json')) {
    throw new Error('json-rows import requires a .json file.');
  }
  const stat = fs.statSync(absInput);
  if (stat.size > MAX_JSON_BYTES) {
    throw new Error(`JSON file too large (max ${MAX_JSON_BYTES} bytes).`);
  }

  const raw = fs.readFileSync(absInput, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`json-rows: invalid JSON (${e && e.message ? e.message : e})`);
  }
  if (!Array.isArray(data)) {
    throw new Error('json-rows: root JSON value must be an array of objects.');
  }
  if (data.length > MAX_ITEMS) {
    throw new Error(`json-rows: array too long (max ${MAX_ITEMS} items).`);
  }

  const baseName = path.basename(absInput);
  const imported = [];
  const now = new Date().toISOString().slice(0, 10);
  const subdir = path.join(outputBase, 'imports', 'json').replace(/\\/g, '/');

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`json-rows: item at index ${i} must be a plain object, not an array.`);
    }

    const idVal =
      item.id != null
        ? String(item.id)
        : item.uuid != null
          ? String(item.uuid)
          : item.source_id != null
            ? String(item.source_id)
            : null;
    const sourceId = idVal
      ? idVal.slice(0, 200)
      : crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 32);

    const titleFrom =
      typeof item.title === 'string'
        ? item.title.slice(0, 200)
        : typeof item.name === 'string'
          ? item.name.slice(0, 200)
          : null;

    const frontmatter = {
      source: 'json-import',
      source_id: sourceId,
      date: now,
      json_file: baseName,
      item_index: i,
      ...(titleFrom && { title: titleFrom }),
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    const body = ['## Record', '', '```json', JSON.stringify(item, null, 2), '```'].join('\n');
    const fileSlug = crypto
      .createHash('sha256')
      .update(JSON.stringify(item) + baseName + String(i))
      .digest('hex')
      .slice(0, 12);
    const outputRel = path
      .join(subdir, `item-${String(i).padStart(5, '0')}-${fileSlug}.md`)
      .replace(/\\/g, '/');

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter });
    }
    imported.push({ path: outputRel, source_id: sourceId });
  }

  return { imported, count: imported.length };
}
