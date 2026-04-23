/**
 * Microsoft Excel .xlsx (first sheet) → one note per data row (same as generic-csv).
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { importStringMatrixToNotes } from './tabular-import.mjs';

const MAX_XLSX_BYTES = 50 * 1024 * 1024;

/**
 * @param {string} input
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 */
export async function importExcelXlsx(input, ctx) {
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error('excel-xlsx import expects a path to an .xlsx file.');
  }
  if (!absInput.toLowerCase().endsWith('.xlsx')) {
    throw new Error('excel-xlsx import requires a .xlsx file (Office Open XML). Legacy .xls is not supported.');
  }
  const stat = fs.statSync(absInput);
  if (stat.size > MAX_XLSX_BYTES) {
    throw new Error(`Excel file too large (max ${MAX_XLSX_BYTES} bytes).`);
  }

  const buf = fs.readFileSync(absInput);
  const wb = XLSX.read(buf, { type: 'buffer' });
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { imported: [], count: 0 };
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!data || data.length < 2) {
    return { imported: [], count: 0 };
  }
  /** @type {(string|number)[][]} */
  const matrix = data.map((row) => {
    const r = Array.isArray(row) ? row : [];
    return r.map((c) => (c == null ? '' : String(c)));
  });
  return importStringMatrixToNotes(matrix, ctx, {
    source: 'xlsx-import',
    fileLabel: path.basename(absInput),
    subdir: 'xlsx',
    fileKey: 'xlsx_file',
  });
}
