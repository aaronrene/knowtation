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

const BILLING_FILE = path.join(projectRoot, 'data', 'hosted_billing.json');
const BLOB_KEY = 'billing-db-v1';
const MAX_EVENTS = 8000;

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
  try {
    const raw = await fs.readFile(BILLING_FILE, 'utf8');
    return normalizeDb(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyDb();
    throw e;
  }
}

async function writeToFile(db) {
  await fs.mkdir(path.dirname(BILLING_FILE), { recursive: true });
  await fs.writeFile(BILLING_FILE, JSON.stringify(db, null, 2), 'utf8');
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
 * @param {(db: object) => void} fn - mutates db in place
 */
export async function mutateBillingDb(fn) {
  const db = await loadBillingDb();
  fn(db);
  trimEvents(db);
  await saveBillingDb(db);
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

    // Advance period by one month.
    const newStart = new Date(pe);
    const newEnd = new Date(pe);
    newEnd.setMonth(newEnd.getMonth() + 1);
    user.period_start = newStart.toISOString();
    user.period_end = newEnd.toISOString();
  });
}
