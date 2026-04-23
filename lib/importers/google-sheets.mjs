/**
 * Google Sheets API — read a range, same tabular note model as generic-csv (header row + data rows).
 * Requires: service account with spreadsheet shared (Viewer) or `GOOGLE_SERVICE_ACCOUNT_JSON`
 * (JSON string) or `GOOGLE_APPLICATION_CREDENTIALS` (path to a .json key file).
 */

import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { importStringMatrixToNotes } from './tabular-import.mjs';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/**
 * @returns {Record<string, unknown>}
 */
function loadServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).trim().length) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? String(process.env.GOOGLE_APPLICATION_CREDENTIALS).trim()
    : '';
  if (p && fs.existsSync(p) && fs.statSync(p).isFile()) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error(
    'google-sheets import: set GOOGLE_SERVICE_ACCOUNT_JSON to the service account JSON string, or GOOGLE_APPLICATION_CREDENTIALS to a path to the key file. Share the spreadsheet with that service account (Viewer) or use a sheet owned by the same GCP project.',
  );
}

/**
 * @param {string} spreadsheetId
 * @param {string} accessToken
 * @param {string} [explicitRange]
 * @returns {Promise<(string|number)[][]>}
 */
async function fetchValuesMatrix(spreadsheetId, accessToken, explicitRange) {
  const id = encodeURIComponent(spreadsheetId);
  let rangeParam = (explicitRange && String(explicitRange).trim()) || '';
  if (!rangeParam) {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title,sheetId)`;
    const mRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!mRes.ok) {
      const t = await mRes.text();
      throw new Error(`google-sheets: could not read spreadsheet metadata (${mRes.status}): ${t.slice(0, 200)}`);
    }
    const mJson = await mRes.json();
    const titles = (mJson.sheets || [])
      .map((s) => s && s.properties && s.properties.title)
      .filter((x) => x != null && String(x).length > 0);
    if (!titles.length) {
      return [];
    }
    const esc = String(titles[0]).replace(/'/g, "''");
    rangeParam = `'${esc}'!A1:ZZ10000`;
  }

  const vUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(rangeParam)}`;
  const vRes = await fetch(vUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!vRes.ok) {
    const t = await vRes.text();
    throw new Error(`google-sheets: could not read range (${vRes.status}): ${t.slice(0, 200)}`);
  }
  const vJson = await vRes.json();
  const values = vJson && Array.isArray(vJson.values) ? vJson.values : [];
  if (values.length < 2) {
    return [];
  }
  let maxCol = 0;
  for (const row of values) {
    if (Array.isArray(row) && row.length > maxCol) {
      maxCol = row.length;
    }
  }
  return values.map((row) => {
    const r = Array.isArray(row) ? row : [];
    const out = [];
    for (let c = 0; c < maxCol; c++) {
      out.push(c < r.length && r[c] != null ? String(r[c]) : '');
    }
    return out;
  });
}

/**
 * @param {string} input - Spreadsheet id (from the sheet URL, not a filesystem path for typical use)
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean, sheetsRange?: string }} ctx
 */
export async function importGoogleSheets(input, ctx) {
  const id = String(input || '').trim();
  if (!id) {
    throw new Error('google-sheets: provide a spreadsheet id (the long id in the Google Sheets URL).');
  }
  if (/[\\/]/.test(id) || (id.length > 80 && id.includes('.'))) {
    throw new Error('google-sheets: input should be a spreadsheet id string, not a file path. Paste only the id from the URL.');
  }

  const sa = loadServiceAccount();
  const auth = new GoogleAuth({ credentials: sa, scopes: [SCOPE] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = token && 'token' in token ? token.token : token;
  if (!accessToken) {
    throw new Error('google-sheets: failed to obtain an OAuth access token from the service account.');
  }

  const matrix = await fetchValuesMatrix(id, accessToken, ctx.sheetsRange);
  if (!matrix.length) {
    return { imported: [], count: 0 };
  }
  return importStringMatrixToNotes(matrix, ctx, {
    source: 'google-sheets-import',
    fileLabel: id,
    subdir: 'sheets',
    fileKey: 'spreadsheet_id',
  });
}
