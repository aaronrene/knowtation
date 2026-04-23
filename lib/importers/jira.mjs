/**
 * Jira CSV export importer. Parses CSV from Jira Cloud/Server export.
 * One note per issue; frontmatter: source: jira, source_id: issue key, project, summary; body: description + comments if present.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';
import { buildRowObjectForJson } from './tabular-import.mjs';

/**
 * Parse a CSV line respecting quoted fields (handles commas inside quotes).
 * @param {string} line
 * @returns {string[]}
 */
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
 * @param {string} input - Path to Jira CSV file (or folder containing one .csv)
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importJira(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }

  let csvPath = absInput;
  if (fs.statSync(absInput).isDirectory()) {
    const files = fs.readdirSync(absInput).filter((f) => f.endsWith('.csv'));
    if (files.length === 0) throw new Error('No .csv file found in folder. Export issues from Jira as CSV first.');
    csvPath = path.join(absInput, files[0]);
  } else if (!absInput.endsWith('.csv')) {
    throw new Error('Jira import expects a .csv file (or folder containing one). Export from Jira: list or search → Export CSV.');
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return { imported: [], count: 0 };
  }

  const header = parseCSVLine(lines[0]);
  const keyIdx = header.findIndex((h) => /^(Issue key|Key|key)$/i.test(h));
  const summaryIdx = header.findIndex((h) => /^Summary$/i.test(h));
  const descIdx = header.findIndex((h) => /^Description$/i.test(h));
  const projIdx = header.findIndex((h) => /^Project$/i.test(h));

  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  const nCols = header.length;
  for (let rowNum = 1; rowNum < lines.length; rowNum++) {
    const row = parseCSVLine(lines[rowNum]);
    if (row.length < 2) continue;
    const issueKey = keyIdx >= 0 ? (row[keyIdx] || '').trim() : `row-${rowNum}`;
    if (!issueKey) continue;
    const summary = summaryIdx >= 0 ? (row[summaryIdx] || '').trim() : '';
    const description = descIdx >= 0 ? (row[descIdx] || '').trim() : '';
    const proj = projIdx >= 0 ? (row[projIdx] || '').trim() : '';
    const labelHeaders = header.map((h, i) => h.trim() || `column_${i}`);
    const rowCells = Array.from({ length: nCols }, (_, i) => (i < row.length ? row[i] : ''));
    const fullRowJson = buildRowObjectForJson(labelHeaders, rowCells);
    const jsonStr = JSON.stringify(fullRowJson, null, 2);
    let body = summary ? `# ${summary}\n\n${description}` : description || '(no description)';
    body += '\n\n## All CSV fields (JSON)\n\n```json\n' + jsonStr + '\n```\n';
    const safeName = issueKey.replace(/[^a-zA-Z0-9-_]/g, '_') + '.md';
    const outputRel = path.join(outputBase, safeName).replace(/\\/g, '/');

    const frontmatter = {
      source: 'jira',
      source_id: issueKey,
      date: now,
      import_column_headers: JSON.stringify(labelHeaders),
      ...(summary && { title: summary }),
      ...(project && { project: normalizeSlug(project) }),
      ...(proj && !project && { project: normalizeSlug(proj) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter });
    }
    imported.push({ path: outputRel, source_id: issueKey });
  }

  return { imported, count: imported.length };
}
