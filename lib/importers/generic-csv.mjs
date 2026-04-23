/**
 * Generic tabular CSV: header row, one Markdown note per data row.
 * UTF-8; strips BOM. Row cap and field length cap for safety.
 */

import fs from 'fs';
import path from 'path';
import { parseCSVLine } from '../csv-parse-line.mjs';
import { importStringMatrixToNotes } from './tabular-import.mjs';

const MAX_CSV_BYTES = 50 * 1024 * 1024;

/**
 * @param {string} input
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 */
export async function importGenericCsv(input, ctx) {
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

  const h0 = parseCSVLine(lines[0]).map((h) => h.trim());
  const headerLabels = h0.map((h) => h || 'column');
  /** @type {(string|number)[][]} */
  const matrix = [headerLabels];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    matrix.push(headerLabels.map((_, j) => (j < row.length ? row[j] : '')));
  }

  const baseName = path.basename(absInput);
  return importStringMatrixToNotes(matrix, ctx, {
    source: 'csv-import',
    fileLabel: baseName,
    subdir: 'csv',
    fileKey: 'csv_file',
  });
}
