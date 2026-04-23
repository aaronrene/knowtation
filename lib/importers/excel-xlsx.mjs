/**
 * Microsoft Excel .xlsx (first sheet) → one note per data row (same as generic-csv).
 * Uses `exceljs` (not the unmaintained `xlsx` / SheetJS community) for secure parsing.
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { importStringMatrixToNotes } from './tabular-import.mjs';

const MAX_XLSX_BYTES = 50 * 1024 * 1024;
const MAX_FIELD = 32_000;

/**
 * @param {unknown} val
 * @returns {string}
 */
function valueToString(val) {
  if (val == null) return '';
  if (typeof val === 'object' && val && 'richText' in val && Array.isArray(val.richText)) {
    return val.richText.map((t) => (t && t.text) || '').join('');
  }
  if (typeof val === 'object' && val && 'hyperlink' in val) {
    const t = val;
    return t.text != null ? String(t.text) : '';
  }
  if (typeof val === 'object' && val && 'formula' in val && 'result' in val) {
    const t = val;
    return t.result == null ? '' : String(t.result);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'object') {
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * @param {import('exceljs').Cell} cell
 * @returns {string}
 */
function stringFromCell(cell) {
  if (!cell) return '';
  if (cell.text != null && String(cell.text).length > 0) {
    return String(cell.text);
  }
  return valueToString(cell.value);
}

/**
 * @param {import('exceljs').Row} row
 * @returns {string[]}
 */
function rowToStringArray(row) {
  if (!row) return [];
  let maxC = 0;
  const sparse = new Map();
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber < 1) return;
    maxC = Math.max(maxC, colNumber);
    let s = stringFromCell(cell);
    if (s.length > MAX_FIELD) s = s.slice(0, MAX_FIELD) + '…';
    sparse.set(colNumber, s);
  });
  if (maxC < 1) return [];
  const r = new Array(maxC).fill('');
  for (let c = 1; c <= maxC; c++) {
    r[c - 1] = sparse.has(c) ? sparse.get(c) : '';
  }
  return r;
}

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
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  if (!wb.worksheets || wb.worksheets.length === 0) {
    return { imported: [], count: 0 };
  }
  const ws = wb.worksheets[0];
  /** @type {string[][]} */
  const rawMatrix = [];
  let maxCol = 0;
  ws.eachRow({ includeEmpty: true }, (row) => {
    const r = rowToStringArray(row);
    maxCol = Math.max(maxCol, r.length);
    rawMatrix.push(r);
  });
  if (rawMatrix.length < 2) {
    return { imported: [], count: 0 };
  }
  /** @type {(string|number)[][]} */
  const matrix = rawMatrix.map((r) => {
    const out = r.slice();
    while (out.length < maxCol) {
      out.push('');
    }
    return out;
  });
  return importStringMatrixToNotes(matrix, ctx, {
    source: 'xlsx-import',
    fileLabel: path.basename(absInput),
    subdir: 'xlsx',
    fileKey: 'xlsx_file',
  });
}
