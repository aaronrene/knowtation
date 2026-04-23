/**
 * Shared: tabular data (header row + data rows) → one Markdown note per row.
 * Used by generic-csv, excel-xlsx, google-sheets.
 * Each note has frontmatter `title` (source file or spreadsheet id + optional label from a `title|name|subject|summary|label` column) and body H1 matching that title.
 */

import crypto from 'crypto';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

const MAX_ROWS = 10_000;
const MAX_FIELD_LEN = 32_000;
/** Headers (normalized to lowercase) checked in order for a short human label for `title` frontmatter. */
const PRIMARY_LABEL_HEADER_ORDER = ['title', 'name', 'subject', 'summary', 'label'];

/**
 * @param {string[]} headers
 * @param {string[]} cells
 * @returns {string | null} First non-empty cell for a "primary" column, or null
 */
function findPrimaryLabelValue(headers, cells) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const want of PRIMARY_LABEL_HEADER_ORDER) {
    const idx = lower.findIndex((h) => h === want);
    if (idx < 0) continue;
    const v = (cells[idx] || '').replace(/\r\n/g, '\n').trim();
    if (v) {
      return v.length > 200 ? v.slice(0, 200) + '…' : v;
    }
  }
  return null;
}

/**
 * Human-readable `title` frontmatter: always includes the source file/sheet id; includes row when no label column.
 * @param {string} fileLabel
 * @param {number} rowNum
 * @param {string | null} primary
 */
function buildNoteTitleForRow(fileLabel, rowNum, primary) {
  const file = String(fileLabel || 'tabular').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (primary) {
    const p = String(primary).replace(/\r\n/g, ' ').trim().slice(0, 120);
    const combined = `${file} · ${p}`;
    return combined.length > 220 ? combined.slice(0, 217) + '…' : combined;
  }
  return `${file} (row ${rowNum})`.slice(0, 220);
}

/**
 * @param {(string|number|boolean|null|undefined)[][]} matrix - row0 = headers, rest = data
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @param {{ source: string, fileLabel: string, subdir: string, fileKey: string }} meta - fileKey = frontmatter key for file id (e.g. csv_file, xlsx_file)
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importStringMatrixToNotes(matrix, ctx, meta) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const { source, fileLabel, subdir, fileKey } = meta;
  if (!matrix || matrix.length < 2) {
    return { imported: [], count: 0 };
  }

  const headerRow = matrix[0].map((c) => String(c ?? '').trim());
  const headers = headerRow.map((h) => h || 'column');
  const idColIdx = headers.findIndex(
    (h) => /^(id|uuid|key|source_id)$/i.test(h) || /^source[\s_]?id$/i.test(h),
  );

  const outSub = path.join(outputBase, 'imports', subdir).replace(/\\/g, '/');
  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (let rowNum = 1; rowNum < matrix.length; rowNum++) {
    if (imported.length >= MAX_ROWS) {
      throw new Error(`tabular import: row limit exceeded (max ${MAX_ROWS} data rows).`);
    }
    const row = matrix[rowNum] || [];
    const cells = headers.map((_, j) => {
      const c = j < row.length ? String(row[j] ?? '') : '';
      return c.length > MAX_FIELD_LEN ? c.slice(0, MAX_FIELD_LEN) + '…' : c;
    });
    const rowLine = cells.join('\t');
    const sourceId =
      idColIdx >= 0 && (cells[idColIdx] || '').trim()
        ? (cells[idColIdx] || '').trim().slice(0, 200)
        : crypto.createHash('sha256').update(String(rowLine) + fileLabel + String(rowNum)).digest('hex').slice(0, 32);

    const primaryLabel = findPrimaryLabelValue(headers, cells);
    const noteTitle = buildNoteTitleForRow(fileLabel, rowNum, primaryLabel);

    const bodyLines = [`# ${noteTitle}`, ''];
    for (let c = 0; c < headers.length; c++) {
      const label = headers[c] || `col_${c}`;
      const val = (cells[c] || '').replace(/\r\n/g, '\n');
      bodyLines.push(`- **${label}:** ${val || '—'}`);
    }
    const body = bodyLines.join('\n');

    const fileSlug = crypto
      .createHash('sha256')
      .update(String(rowLine) + fileLabel + String(rowNum))
      .digest('hex')
      .slice(0, 12);
    const outputRel = path.join(outSub, `row-${String(rowNum).padStart(5, '0')}-${fileSlug}.md`).replace(/\\/g, '/');

    const frontmatter = {
      source,
      title: noteTitle,
      source_id: sourceId,
      date: now,
      [fileKey]: fileLabel,
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
