/**
 * Wallet / exchange transaction history CSV importer.
 *
 * Converts wallet export files into vault notes with blockchain frontmatter.
 * Each CSV row → one note under inbox/wallet-import/<date>-<tx_hash_prefix>.md
 *
 * Handles multiple wallet/exchange export formats via a column alias table.
 * Generic parser is the primary path; named parsers (Coinbase, Exodus, …) are
 * thin pre-normalizers that rename columns before the generic parse.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

// ---------------------------------------------------------------------------
// Column alias table
// Keys are canonical field names; values are ordered arrays of case-insensitive
// column header aliases. First match wins.
// ---------------------------------------------------------------------------
const COLUMN_ALIASES = {
  tx_hash: ['txhash', 'transaction_hash', 'hash', 'tx id', 'txid', 'transaction id', 'transaction_id'],
  date: ['date', 'timestamp', 'time', 'confirmed at', 'confirmed_at', 'block time', 'block_time'],
  amount: ['amount', 'value', 'quantity'],
  currency: ['currency', 'asset', 'token', 'coin', 'symbol'],
  direction: ['type', 'direction', 'side'],
  payment_status: ['status'],
  wallet_address: ['from', 'to', 'address', 'wallet', 'sender', 'recipient', 'from_address', 'to_address'],
  network: ['network', 'chain', 'blockchain'],
  block_height: ['block', 'block number', 'block_number', 'block height', 'block_height'],
};

// ---------------------------------------------------------------------------
// Direction normalisation
// ---------------------------------------------------------------------------
const DIRECTION_MAP = {
  buy: 'received',
  receive: 'received',
  received: 'received',
  in: 'received',
  deposit: 'received',
  sell: 'sent',
  send: 'sent',
  sent: 'sent',
  out: 'sent',
  withdrawal: 'sent',
  withdraw: 'sent',
};

// ---------------------------------------------------------------------------
// Payment status normalisation
// ---------------------------------------------------------------------------
const STATUS_MAP = {
  completed: 'settled',
  complete: 'settled',
  success: 'settled',
  succeeded: 'settled',
  confirmed: 'settled',
  settled: 'settled',
  pending: 'pending',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  rejected: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

// ---------------------------------------------------------------------------
// Named wallet format pre-normalisers
// Each returns a header array and row-object mapper so the generic parser
// gets consistently named columns.
// ---------------------------------------------------------------------------

/**
 * Coinbase standard export
 * Headers: Date, Transaction Type, Asset, Quantity Transacted, Price Currency,
 *          Price At Transaction, Subtotal, Total (inclusive of fees and/or spread),
 *          Fees and/or Spread, Notes
 */
function normalizeCoinbase(header, row) {
  return {
    date: row['Date'] || row['Timestamp'] || '',
    type: row['Transaction Type'] || '',
    currency: row['Asset'] || '',
    amount: row['Quantity Transacted'] || '',
    status: 'settled',
    network: 'coinbase',
  };
}

/**
 * Coinbase Pro / Advanced Trade export
 * Headers: portfolio, type, time, amount, balance, amount/balance unit, …
 */
function normalizeCoinbasePro(header, row) {
  const unit = row['amount/balance unit'] || row['amount_balance_unit'] || '';
  return {
    date: row['time'] || '',
    type: row['type'] || '',
    amount: row['amount'] || '',
    currency: unit,
    network: 'coinbase-pro',
  };
}

/**
 * Exodus wallet export
 * Headers: DATE, TYPE, FROMAMOUNT, FROMCURRENCY, TOAMOUNT, TOCURRENCY,
 *          TXID, STATUS, …
 */
function normalizeExodus(header, row) {
  return {
    txhash: row['TXID'] || '',
    date: row['DATE'] || '',
    type: row['TYPE'] || '',
    amount: row['FROMAMOUNT'] || row['TOAMOUNT'] || '',
    currency: row['FROMCURRENCY'] || row['TOCURRENCY'] || '',
    status: row['STATUS'] || '',
  };
}

/**
 * ICP Rosetta standard export
 * Headers: hash, block_index, timestamp, type, account, amount, fee
 */
function normalizeICPRosetta(header, row) {
  return {
    txhash: row['hash'] || '',
    block: row['block_index'] || '',
    timestamp: row['timestamp'] || '',
    type: row['type'] || '',
    address: row['account'] || '',
    amount: row['amount'] || '',
    currency: 'ICP',
    network: 'icp',
  };
}

/**
 * Detect named wallet format by inspecting the raw header row.
 * Returns a normaliser function, or null for generic processing.
 * @param {string[]} header
 * @returns {((header: string[], row: Record<string,string>) => Record<string,string>) | null}
 */
function detectFormat(header) {
  const h = header.map((c) => c.toLowerCase());
  if (h.includes('quantity transacted') || h.includes('transaction type') && h.includes('asset')) {
    return normalizeCoinbase;
  }
  if (h.includes('fromamount') && h.includes('fromcurrency')) {
    return normalizeExodus;
  }
  if (h.includes('block_index') && h.includes('hash') && header.length <= 8) {
    return normalizeICPRosetta;
  }
  if (h.includes('portfolio') && h.includes('amount/balance unit')) {
    return normalizeCoinbasePro;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields, escaped quotes)
// ---------------------------------------------------------------------------
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
      out.push(field.trim());
      if (i < line.length && line[i] === ',') i++;
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
 * Parse entire CSV text into an array of row-objects keyed by header names.
 * @param {string} text
 * @returns {{ header: string[], rows: Record<string,string>[] }}
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return { header: [], rows: [] };
  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.every((c) => !c)) continue; // skip blank rows
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = cols[j] || '';
    }
    rows.push(obj);
  }
  return { header, rows };
}

// ---------------------------------------------------------------------------
// Column resolution helpers
// ---------------------------------------------------------------------------

/**
 * Build a lookup: canonical field → actual column name present in this CSV's header.
 * Case-insensitive; first alias match wins.
 * @param {string[]} header
 * @returns {Record<string, string>}
 */
function buildColumnMap(header) {
  const lower = header.map((h) => h.toLowerCase().trim());
  const result = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = lower.indexOf(alias.toLowerCase());
      if (idx !== -1) {
        result[canonical] = header[idx];
        break;
      }
    }
  }
  return result;
}

/**
 * Extract canonical field value from a row-object.
 * @param {Record<string,string>} row
 * @param {Record<string,string>} colMap
 * @param {string} canonical
 * @returns {string}
 */
function get(row, colMap, canonical) {
  const key = colMap[canonical];
  if (!key) return '';
  return (row[key] || '').trim();
}

// ---------------------------------------------------------------------------
// Date normalisation
// ---------------------------------------------------------------------------
function normalizeDate(v) {
  if (!v) return null;
  // Handle Unix timestamps (seconds or milliseconds)
  if (/^\d{10}$/.test(v.trim())) {
    return new Date(parseInt(v, 10) * 1000).toISOString();
  }
  if (/^\d{13}$/.test(v.trim())) {
    return new Date(parseInt(v, 10)).toISOString();
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isoToDateStr(iso) {
  if (!iso) return null;
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Slug / filename helpers
// ---------------------------------------------------------------------------
function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build the vault-relative output path for a row.
 * Convention: inbox/wallet-import/<YYYY-MM-DD>-<tx_hash_prefix>.md
 * If no tx_hash, use date + amount + currency.
 */
function buildOutputPath(outputBase, dateStr, txHash, amount, currency, rowIdx) {
  const date = dateStr || new Date().toISOString().slice(0, 10);
  let slug;
  if (txHash) {
    slug = String(txHash).replace(/^0x/i, '').slice(0, 12);
  } else if (amount || currency) {
    slug = slugify(`${amount || 'tx'}-${currency || 'unknown'}`);
  } else {
    slug = `row-${rowIdx}`;
  }
  const filename = `${date}-${slug}.md`;
  return path.join(outputBase, 'wallet-import', filename).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Note builder
// ---------------------------------------------------------------------------
function buildNote(fields, rowObj, extraTags, project) {
  const {
    txHash,
    dateStr,
    confirmedAt,
    amount,
    currency,
    direction,
    paymentStatus,
    walletAddress,
    network,
    blockHeight,
  } = fields;

  const title = buildTitle(direction, amount, currency, network);
  const tags = [...new Set(['payment', 'on-chain', ...extraTags])];
  if (network === 'icp' || currency === 'ICP') tags.push('icp-tx');

  const frontmatter = {
    title,
    date: dateStr || new Date().toISOString().slice(0, 10),
    source: 'wallet-csv-import',
    source_id: txHash || buildFallbackSourceId(dateStr, amount, currency),
    ...(network && { network }),
    ...(walletAddress && { wallet_address: walletAddress }),
    ...(txHash && { tx_hash: txHash }),
    ...(paymentStatus && { payment_status: paymentStatus }),
    ...(amount && { amount }),
    ...(currency && { currency }),
    ...(direction && { direction }),
    ...(confirmedAt && { confirmed_at: confirmedAt }),
    ...(blockHeight && { block_height: parseInt(blockHeight, 10) || blockHeight }),
    tags,
    ...(project && { project: normalizeSlug(project) }),
  };

  // Human-readable body
  const blockStr = blockHeight ? `Block: ${Number(blockHeight).toLocaleString()} | ` : '';
  const confirmedStr = confirmedAt
    ? `Confirmed: ${confirmedAt.replace('T', ' ').replace('Z', ' UTC')}`
    : '';
  const body = [
    'Transaction imported from wallet CSV export.',
    `Amount: ${amount || '?'} ${currency || '?'} | Direction: ${direction || '?'} | Status: ${paymentStatus || '?'}`,
    blockStr + confirmedStr,
  ]
    .filter(Boolean)
    .join('\n');

  return { frontmatter, body };
}

function buildTitle(direction, amount, currency, network) {
  const parts = [network ? `${network.toUpperCase()} transfer` : 'Transaction'];
  if (amount && currency) parts.push(`— ${amount} ${currency}`);
  if (direction) parts.push(direction);
  return parts.join(' ');
}

function buildFallbackSourceId(dateStr, amount, currency) {
  return slugify(`${dateStr || 'unknown'}-${amount || 'tx'}-${currency || 'x'}`);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
function noteExists(vaultPath, outputRel) {
  return fs.existsSync(path.join(vaultPath, outputRel));
}

// ---------------------------------------------------------------------------
// Main importer
// ---------------------------------------------------------------------------

/**
 * @param {string} input - Path to wallet CSV file (or folder containing one .csv)
 * @param {{
 *   vaultPath: string,
 *   outputBase: string,
 *   project?: string,
 *   tags: string[],
 *   dryRun: boolean,
 *   onProgress?: (p: { progress: number, total?: number, message?: string }) => void | Promise<void>
 * }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number, skipped: number }>}
 */
export async function importWalletCSV(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun, onProgress } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);

  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }

  let csvPath = absInput;
  if (fs.statSync(absInput).isDirectory()) {
    const files = fs.readdirSync(absInput).filter((f) => f.toLowerCase().endsWith('.csv'));
    if (files.length === 0) {
      throw new Error('No .csv file found in folder. Export transactions from your wallet or exchange first.');
    }
    csvPath = path.join(absInput, files[0]);
  } else if (!absInput.toLowerCase().endsWith('.csv')) {
    throw new Error('wallet-csv import expects a .csv file (or folder containing one).');
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const { header, rows } = parseCSV(raw);

  if (rows.length === 0) {
    return { imported: [], count: 0, skipped: 0 };
  }

  // Detect named format and build normaliser
  const formatNormalizer = detectFormat(header);

  // Build column alias map for the generic path
  const colMap = buildColumnMap(header);

  const imported = [];
  let skipped = 0;
  const total = rows.length;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const rawRow = rows[rowIdx];

    // If we have a named format normaliser, merge its output into the row
    // so the generic column map can still pick up fields the normaliser produces.
    const row = formatNormalizer ? { ...rawRow, ...formatNormalizer(header, rawRow) } : rawRow;
    // Rebuild colMap with potentially normalised keys for this row
    const effectiveColMap = formatNormalizer ? buildColumnMap(Object.keys(row)) : colMap;

    // Extract canonical fields
    const txHashRaw = get(row, effectiveColMap, 'tx_hash');
    const dateRaw = get(row, effectiveColMap, 'date');
    const amountRaw = get(row, effectiveColMap, 'amount');
    const currencyRaw = get(row, effectiveColMap, 'currency');
    const directionRaw = get(row, effectiveColMap, 'direction');
    const statusRaw = get(row, effectiveColMap, 'payment_status');
    const walletRaw = get(row, effectiveColMap, 'wallet_address');
    const networkRaw = get(row, effectiveColMap, 'network');
    const blockRaw = get(row, effectiveColMap, 'block_height');

    const confirmedAt = normalizeDate(dateRaw);
    const dateStr = isoToDateStr(confirmedAt);
    const txHash = txHashRaw || '';
    const amount = amountRaw ? String(parseFloat(amountRaw) || amountRaw) : '';
    const currency = currencyRaw.toUpperCase() || '';
    const direction = DIRECTION_MAP[directionRaw.toLowerCase()] || (directionRaw ? directionRaw.toLowerCase() : '');
    const paymentStatus = STATUS_MAP[statusRaw.toLowerCase()] || (statusRaw ? statusRaw.toLowerCase() : '');
    const network = networkRaw.toLowerCase() || '';
    const walletAddress = walletRaw || '';
    const blockHeight = blockRaw || '';

    const outputRel = buildOutputPath(
      outputBase,
      dateStr,
      txHash,
      amount,
      currency,
      rowIdx
    );

    // Deduplication: skip if a note with the same source_id already exists
    if (!dryRun && noteExists(vaultPath, outputRel)) {
      skipped++;
      continue;
    }

    const fields = {
      txHash,
      dateStr,
      confirmedAt,
      amount,
      currency,
      direction,
      paymentStatus,
      walletAddress,
      network,
      blockHeight,
    };

    const { frontmatter, body } = buildNote(fields, row, tags, project);

    // Clean frontmatter — remove empty strings and nulls
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(frontmatter).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter: cleanFrontmatter });
    }

    imported.push({ path: outputRel, source_id: cleanFrontmatter.source_id });

    if (onProgress && total > 0) {
      const n = rowIdx + 1;
      const force = n === 1 || n === total || total <= 10;
      if (force || n % 25 === 0) {
        await onProgress({
          progress: n,
          total,
          message: `wallet-csv import ${n}/${total}: ${path.basename(outputRel)}`,
        });
      }
    }
  }

  return { imported, count: imported.length, skipped };
}
