/**
 * Persistent billing DB: local file data/hosted_billing.json or Netlify Blob (gateway-billing).
 */
import { normalizeBillingUser } from './billing-logic.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}

const BLOB_KEY = 'billing-db-v1';
const MAX_EVENTS = 8000;

/**
 * Resolve the local billing DB path at call time so tests can isolate via
 * KNOWTATION_BILLING_DB_PATH or KNOWTATION_GATEWAY_DATA_DIR without sharing
 * (or hanging on) a corrupt repo-local data/hosted_billing.json.
 * @returns {string}
 */
function billingFilePath() {
  if (process.env.KNOWTATION_BILLING_DB_PATH) {
    return path.resolve(process.env.KNOWTATION_BILLING_DB_PATH);
  }
  const dataDir = process.env.KNOWTATION_GATEWAY_DATA_DIR || path.join(projectRoot, 'data');
  return path.join(dataDir, 'hosted_billing.json');
}

function emptyDb() {
  return { users: {}, processed_events: [] };
}

function getBlobStore() {
  return globalThis.__knowtation_gateway_blob;
}

async function readFromBlob() {
  const store = getBlobStore();
  if (!store) return null;
  const raw = await store.get(BLOB_KEY, { type: 'json' });
  if (!raw) return emptyDb();
  return normalizeDb(raw);
}

async function writeToBlob(db) {
  const store = getBlobStore();
  if (!store) throw new Error('Netlify Blob store not configured');
  await store.setJSON(BLOB_KEY, db);
}

async function readFromFile() {
  const billingFile = billingFilePath();
  try {
    const raw = await fs.readFile(billingFile, 'utf8');
    return normalizeDb(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyDb();
    throw e;
  }
}

async function writeToFile(db) {
  const billingFile = billingFilePath();
  await fs.mkdir(path.dirname(billingFile), { recursive: true });
  await fs.writeFile(billingFile, JSON.stringify(db, null, 2), 'utf8');
}

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : emptyDb();
  if (!db.users || typeof db.users !== 'object') db.users = {};
  if (!Array.isArray(db.processed_events)) db.processed_events = [];
  for (const uid of Object.keys(db.users)) {
    normalizeBillingUser(db.users[uid]);
  }
  return db;
}

export async function loadBillingDb() {
  if (getBlobStore()) {
    return readFromBlob();
  }
  return readFromFile();
}

export async function saveBillingDb(db) {
  if (getBlobStore()) {
    await writeToBlob(db);
  } else {
    await writeToFile(db);
  }
}

/**
 * In-process write queue. Serializes all mutateBillingDb calls so that concurrent
 * requests within the same process (tests, local dev, single Netlify function instance)
 * never interleave their read-modify-write cycles.
 *
 * Note: across separate Netlify function instances (cold starts, concurrent invocations
 * handled by different workers) this queue has no effect — the backing Blob store is the
 * only coordination point there. But eliminating in-process races is sufficient to keep
 * CI stable and to prevent data loss during high-throughput local dev.
 */
let _mutationQueue = Promise.resolve();

/**
 * @param {(db: object) => void} fn - mutates db in place
 */
export async function mutateBillingDb(fn) {
  const run = _mutationQueue.then(async () => {
    const db = await loadBillingDb();
    fn(db);
    trimEvents(db);
    await saveBillingDb(db);
  });
  // Keep the queue alive even if this call throws; errors propagate to the caller, not the chain.
  _mutationQueue = run.catch(() => {});
  return run;
}

function trimEvents(db) {
  while (db.processed_events.length > MAX_EVENTS) {
    db.processed_events.shift();
  }
}

export function eventAlreadyProcessed(db, eventId) {
  return db.processed_events.includes(eventId);
}

export function markEventProcessed(db, eventId) {
  if (!db.processed_events.includes(eventId)) db.processed_events.push(eventId);
}

export function findUserIdByCustomerId(db, customerId) {
  if (!customerId) return null;
  for (const uid of Object.keys(db.users)) {
    if (db.users[uid].stripe_customer_id === customerId) return uid;
  }
  return null;
}

/**
 * If the user's billing period has expired, reset monthly_indexing_tokens_used to 0 and
 * advance period_start / period_end by one calendar month.
 *
 * This is a client-side guard for cases where the `invoice.paid` webhook is delayed or missed.
 * It does NOT reset the credit (cents) ledger — that is handled by the Stripe invoice webhook.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function resetMonthlyTokensIfNeeded(userId) {
  if (!userId) return;
  const db = await loadBillingDb();
  const u = db.users[userId];
  if (!u) return;

  const periodEnd = u.period_end ? new Date(u.period_end) : null;
  if (!periodEnd || isNaN(periodEnd.getTime())) return;

  const now = new Date();
  if (now <= periodEnd) return;

  await mutateBillingDb((dbMut) => {
    const user = dbMut.users[userId];
    if (!user) return;

    const pe = new Date(user.period_end);
    if (isNaN(pe.getTime()) || now <= pe) return;

    // Reset all monthly counters.
    user.monthly_indexing_tokens_used = 0;
    user.monthly_used_cents = 0;
    user.monthly_searches_used = 0;
    user.monthly_index_jobs_used = 0;
    user.monthly_consolidation_jobs_used = 0;

    // Advance period by one month.
    const newStart = new Date(pe);
    const newEnd = new Date(pe);
    newEnd.setMonth(newEnd.getMonth() + 1);
    user.period_start = newStart.toISOString();
    user.period_end = newEnd.toISOString();
  });
}
