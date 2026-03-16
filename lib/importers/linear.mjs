/**
 * Linear CSV export importer. Parses CSV from Linear export (Exporting Data).
 * One note per issue; frontmatter: source: linear, source_id: issue id; body: title + description.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

function parseCSVLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') {
            field += '"';
            i++;
          } else break;
        } else {
          field += line[i++];
        }
      }
      out.push(field);
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i++];
      }
      out.push(field.trim());
      if (line[i] === ',') i++;
    }
  }
  return out;
}

/**
 * @param {string} input - Path to Linear CSV file
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importLinear(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error(`Linear import expects a CSV file. Export from Linear: Command menu → Export data → CSV.`);
  }
  if (!absInput.endsWith('.csv')) {
    throw new Error('Input must be a .csv file.');
  }

  const raw = fs.readFileSync(absInput, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { imported: [], count: 0 };

  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = header.findIndex((h) => h === 'id' || h === 'identifier');
  const titleIdx = header.findIndex((h) => h === 'title' || h === 'name');
  const descIdx = header.findIndex((h) => h === 'description' || h === 'body');

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (let rowNum = 1; rowNum < lines.length; rowNum++) {
    const row = parseCSVLine(lines[rowNum]);
    const id = idIdx >= 0 ? (row[idIdx] || '').trim() : `linear-${rowNum}`;
    if (!id) continue;
    const title = titleIdx >= 0 ? (row[titleIdx] || '').trim() : '';
    const description = descIdx >= 0 ? (row[descIdx] || '').trim() : '';
    const body = title ? `# ${title}\n\n${description}` : description || '(no content)';
    const safeName = id.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60) + '.md';
    const outputRel = path.join(outputBase, safeName).replace(/\\/g, '/');

    const frontmatter = {
      source: 'linear',
      source_id: id,
      date: now,
      ...(title && { title }),
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter });
    }
    imported.push({ path: outputRel, source_id: id });
  }

  return { imported, count: imported.length };
}
