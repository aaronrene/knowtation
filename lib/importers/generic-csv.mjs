/**
 * Generic tabular CSV: header row, one Markdown note per data row.
 * UTF-8; strips BOM. Row cap and field length cap for safety.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';
import { parseCSVLine } from '../csv-parse-line.mjs';

const MAX_ROWS = 10_000;
const MAX_CSV_BYTES = 50 * 1024 * 1024;
const MAX_FIELD_LEN = 32_000;

/**
 * @param {string} input
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 */
export async function importGenericCsv(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error('generic-csv import expects a path to a .csv file.');
  }
  if (!absInput.toLowerCase().endsWith('.csv')) {
    throw new Error('generic-csv import requires a .csv file.');
  }
  const stat = fs.statSync(absInput);
  if (stat.size > MAX_CSV_BYTES) {
    throw new Error(`CSV file too large (max ${MAX_CSV_BYTES} bytes).`);
  }

  let raw = fs.readFileSync(absInput, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { imported: [], count: 0 };
  }

  const headerCells = parseCSVLine(lines[0]).map((h) => h.trim());
  const headers = headerCells.map((h) => h || 'column');
  const idColIdx = headers.findIndex(
    (h) => /^(id|uuid|key|source_id)$/i.test(h) || /^source[\s_]?id$/i.test(h),
  );

  const baseName = path.basename(absInput);
  const imported = [];
  const now = new Date().toISOString().slice(0, 10);
  const subdir = path.join(outputBase, 'imports', 'csv').replace(/\\/g, '/');

  for (let rowNum = 1; rowNum < lines.length; rowNum++) {
    if (imported.length >= MAX_ROWS) {
      throw new Error(`generic-csv: row limit exceeded (max ${MAX_ROWS} data rows).`);
    }
    const row = parseCSVLine(lines[rowNum]);
    const cells = headers.map((_, j) => {
      const c = j < row.length ? row[j] : '';
      const t = c.length > MAX_FIELD_LEN ? c.slice(0, MAX_FIELD_LEN) + '…' : c;
      return t;
    });

    const rowLine = lines[rowNum];
    const sourceId =
      idColIdx >= 0 && (cells[idColIdx] || '').trim()
        ? (cells[idColIdx] || '').trim().slice(0, 200)
        : crypto.createHash('sha256').update(String(rowLine)).digest('hex').slice(0, 32);

    const bodyLines = [`# Row ${rowNum}`, ''];
    for (let c = 0; c < headers.length; c++) {
      const label = headers[c] || `col_${c}`;
      const val = (cells[c] || '').replace(/\r\n/g, '\n');
      bodyLines.push(`- **${label}:** ${val || '—'}`);
    }
    const body = bodyLines.join('\n');

    const fileSlug = crypto
      .createHash('sha256')
      .update(String(rowLine) + baseName)
      .digest('hex')
      .slice(0, 12);
    const outputRel = path.join(subdir, `row-${String(rowNum).padStart(5, '0')}-${fileSlug}.md`).replace(/\\/g, '/');

    const frontmatter = {
      source: 'csv-import',
      source_id: sourceId,
      date: now,
      csv_file: baseName,
      row_index: rowNum,
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter });
    }
    imported.push({ path: outputRel, source_id: sourceId });
  }

  return { imported, count: imported.length };
}
