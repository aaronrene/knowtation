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
  // staking / earn rewards are inflows
  'staking reward': 'received',
  'staking rewards': 'received',
  'earn interest': 'received',
  earn: 'received',
  reward: 'received',
  airdrop: 'received',
  sell: 'sent',
  send: 'sent',
  sent: 'sent',
  out: 'sent',
  withdrawal: 'sent',
  withdraw: 'sent',
  // swap/trade — direction depends on perspective; leave as-is for user review
  swap: 'swap',
  trade: 'trade',
  exchange: 'swap',
  convert: 'swap',
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
 * Kraken export
 * Headers: txid, refid, time, type, subtype, aclass, asset, amount, fee, balance
 * Notes:
 *   - `txid` may be empty for some row types; fall back to `refid` (Kraken's internal ref).
 *   - `asset` uses Kraken ticker notation (XXBT=BTC, XETH=ETH, ZUSD=USD); we strip leading
 *     X/Z for common cases so the currency field stays readable.
 *   - `network` is hardcoded to 'kraken' because the CSV carries no chain information.
 */
function normalizeKraken(header, row) {
  const rawAsset = row['asset'] || '';
  // Strip Kraken's X/Z prefix from common assets (XXBT→BTC, XETH→ETH, ZUSD→USD)
  const currency = rawAsset.replace(/^X(XBT|ETH|LTC|XRP|XDG|ZEC|XMR|REP)$/i, (_, a) => a === 'XBT' ? 'BTC' : a)
    .replace(/^Z(USD|EUR|GBP|JPY|CAD|AUD|CHF)$/i, (_, a) => a)
    || rawAsset;
  return {
    txhash: row['txid'] || row['refid'] || '',
    date: row['time'] || '',
    type: row['type'] || row['subtype'] || '',
    amount: row['amount'] || '',
    currency,
    network: 'kraken',
  };
}

/**
 * Binance deposit/withdrawal history export
 * Headers: Date(UTC), Coin, Network, Amount, TransactionFee, Address, TXID, Status, Remark
 *
 * Binance also exports a "spot wallet history" format with UTC_Time / Operation / Coin / Change.
 * Both are handled: detectFormat distinguishes them by header shape.
 */
function normalizeBinance(header, row) {
  const h = header.map((c) => c.toLowerCase());
  // Spot wallet history: UTC_Time, Account, Operation, Coin, Change, Remark
  if (h.includes('utc_time') || h.includes('operation')) {
    const change = parseFloat(row['Change'] || '0');
    return {
      date: row['UTC_Time'] || '',
      type: change >= 0 ? 'deposit' : 'withdrawal',
      currency: row['Coin'] || '',
      amount: String(Math.abs(change)),
      network: 'binance',
    };
  }
  // Deposit/withdrawal history: Date(UTC), Coin, Network, Amount, …, TXID, Status
  return {
    txhash: row['TXID'] || '',
    date: row['Date(UTC)'] || '',
    type: header.some((h2) => /withdrawal/i.test(h2)) ? 'withdrawal' : 'deposit',
    currency: row['Coin'] || '',
    amount: row['Amount'] || '',
    address: row['Address'] || '',
    network: (row['Network'] || 'binance').toLowerCase(),
    status: row['Status'] || '',
  };
}

/**
 * MetaMask / Etherscan address export
 * Headers: Txhash, Blockno, UnixTimestamp, DateTime (UTC), From, To,
 *          ContractAddress, Value_IN(ETH), Value_OUT(ETH), CurrentValue @ $...,
 *          TxnFee(ETH), TxnFee(USD), Historical $Price/Eth, Status, ErrCode, Method
 *
 * Direction is inferred from Value_IN vs Value_OUT since the user's address
 * is not available in the CSV itself.
 */
function normalizeMetaMask(header, row) {
  const valueIn = parseFloat(row['Value_IN(ETH)'] || '0');
  const valueOut = parseFloat(row['Value_OUT(ETH)'] || '0');
  const direction = valueIn > 0 ? 'received' : valueOut > 0 ? 'sent' : '';
  const amount = String(valueIn > 0 ? valueIn : valueOut);
  const rawStatus = (row['Status'] || '').toLowerCase();
  // Etherscan encodes failed txs with non-empty ErrCode or Status ''
  const status = rawStatus === '' && row['ErrCode'] ? 'failed'
    : rawStatus === '' ? 'settled'
    : rawStatus;
  return {
    txhash: row['Txhash'] || '',
    block: row['Blockno'] || '',
    // Prefer the human-readable column; fall back to Unix timestamp
    date: row['DateTime (UTC)'] || row['UnixTimestamp'] || '',
    type: direction,
    from: row['From'] || '',
    to: row['To'] || '',
    amount,
    currency: 'ETH',
    network: 'ethereum',
    status,
  };
}

/**
 * Phantom wallet export (Solana)
 * Headers: Transaction ID, Date, Type, Amount, Token, Status, Fee (SOL), Signature
 *
 * `Signature` is the canonical Solana tx identifier (base58, 88 chars).
 * `Transaction ID` may be the same value or a short alias.
 */
function normalizePhantom(header, row) {
  return {
    txhash: row['Signature'] || row['Transaction ID'] || '',
    date: row['Date'] || '',
    type: row['Type'] || '',
    amount: row['Amount'] || '',
    currency: row['Token'] || 'SOL',
    status: row['Status'] || '',
    network: 'solana',
  };
}

/**
 * Ledger Live export
 * Headers: Operation Date, Currency ticker, Operation Amount, Operation Fees,
 *          Operation Hash, Account Name, Account xpub, Countervalue Ticker,
 *          Countervalue at Operation Date, Countervalue now
 *
 * `Operation Amount` is signed: positive = received, negative = sent.
 * Currency ticker maps directly to the frontmatter `currency` field.
 */
function normalizeLedger(header, row) {
  const rawAmount = row['Operation Amount'] || '';
  const parsed = parseFloat(rawAmount);
  const direction = isNaN(parsed) ? '' : parsed >= 0 ? 'received' : 'sent';
  const ticker = (row['Currency ticker'] || '').toUpperCase();
  // Infer network from common tickers
  const TICKER_NETWORK = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ICP: 'icp',
    BNB: 'bsc', MATIC: 'polygon', AVAX: 'avalanche', DOT: 'polkadot',
    ADA: 'cardano', XRP: 'xrp', LTC: 'litecoin', DOGE: 'dogecoin',
  };
  return {
    txhash: row['Operation Hash'] || '',
    date: row['Operation Date'] || '',
    type: direction,
    amount: String(Math.abs(parsed) || rawAmount),
    currency: ticker,
    network: TICKER_NETWORK[ticker] || ticker.toLowerCase() || 'ledger',
    address: row['Account xpub'] || '',
  };
}

/**
 * Detect named wallet format by inspecting the raw header row.
 * Returns a normaliser function, or null for generic processing.
 * Checks are ordered most-specific → least-specific so distinctive headers
 * take precedence over partial matches.
 * @param {string[]} header
 * @returns {((header: string[], row: Record<string,string>) => Record<string,string>) | null}
 */
function detectFormat(header) {
  const h = header.map((c) => c.toLowerCase().trim());

  // Ledger Live — "operation date" + "currency ticker" are unique to Ledger
  if (h.includes('operation date') && h.includes('currency ticker')) return normalizeLedger;

  // MetaMask / Etherscan — signed value columns are unique
  if (h.includes('value_in(eth)') || h.includes('value_out(eth)') || h.includes('blockno')) return normalizeMetaMask;

  // Phantom — "signature" or "fee (sol)" alongside "token"
  if ((h.includes('signature') || h.includes('fee (sol)')) && h.includes('token')) return normalizePhantom;

  // Kraken — "refid" + "aclass" are specific to Kraken ledger exports
  if (h.includes('refid') && (h.includes('aclass') || h.includes('asset'))) return normalizeKraken;

  // Binance — "coin" + either "date(utc)" or "utc_time"
  if (h.includes('coin') && (h.includes('date(utc)') || h.includes('utc_time'))) return normalizeBinance;

  // Coinbase standard — "quantity transacted" is unique
  if (h.includes('quantity transacted') || (h.includes('transaction type') && h.includes('asset'))) return normalizeCoinbase;

  // Exodus — "fromamount" + "fromcurrency"
  if (h.includes('fromamount') && h.includes('fromcurrency')) return normalizeExodus;

  // ICP Rosetta — narrow column set with "block_index"
  if (h.includes('block_index') && h.includes('hash') && header.length <= 10) return normalizeICPRosetta;

  // Coinbase Pro / Advanced Trade — "portfolio" + "amount/balance unit"
  if (h.includes('portfolio') && h.includes('amount/balance unit')) return normalizeCoinbasePro;

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
  // Network-specific tag: e.g. icp → icp-tx, ethereum → eth-tx, solana → sol-tx
  if (network === 'icp' || currency === 'ICP') {
    tags.push('icp-tx');
  } else if (network) {
    const SHORT = {
      ethereum: 'eth', bitcoin: 'btc', solana: 'sol', binance: 'bnb',
      bsc: 'bnb', polygon: 'matic', avalanche: 'avax', polkadot: 'dot',
      cardano: 'ada', kraken: null, coinbase: null, 'coinbase-pro': null, ledger: null,
    };
    const abbr = SHORT[network] !== undefined ? SHORT[network] : network;
    if (abbr) tags.push(`${abbr}-tx`);
  }

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
