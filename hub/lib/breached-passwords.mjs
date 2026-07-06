/**
 * Phase 8 P1b-b — offline breached-password SHA-1 lookup (HIBP-style, no network).
 * Loads hub/data/breached-passwords-sha1.txt once at import.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Netlify gateway bundle: import.meta.url may be missing at load time — never throw here.
function hubLibDirname() {
  try {
    const u = typeof import.meta !== 'undefined' ? import.meta.url : '';
    if (u) return path.dirname(fileURLToPath(u));
  } catch (_) {}
  return path.join(process.cwd(), 'hub', 'lib');
}

const __dirname = hubLibDirname();
const HASH_FILE = path.join(__dirname, 'breached-passwords-sha1.txt');

/** @type {Set<string>|null} */
let cachedSet = null;

/**
 * @returns {Set<string>}
 */
export function loadBreachedPasswordSha1Set() {
  if (cachedSet) return cachedSet;
  cachedSet = new Set();
  if (!fs.existsSync(HASH_FILE)) return cachedSet;
  const raw = fs.readFileSync(HASH_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const h = line.trim().toUpperCase();
    if (/^[0-9A-F]{40}$/.test(h)) cachedSet.add(h);
  }
  return cachedSet;
}

/**
 * @param {string} passphrase
 * @returns {boolean}
 */
export function isBreachedPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || !passphrase) return false;
  const sha1 = crypto.createHash('sha1').update(passphrase.toUpperCase()).digest('hex').toUpperCase();
  return loadBreachedPasswordSha1Set().has(sha1);
}

/**
 * Passphrase strength policy (§6.2): ≥12 chars, mixed case, digit, symbol, not breached.
 * @param {string} passphrase
 * @returns {{ ok: boolean, code?: string }}
 */
export function validatePassphraseStrength(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    return { ok: false, code: 'WEAK_PASSPHRASE' };
  }
  if (!/[a-z]/.test(passphrase)) return { ok: false, code: 'WEAK_PASSPHRASE' };
  if (!/[A-Z]/.test(passphrase)) return { ok: false, code: 'WEAK_PASSPHRASE' };
  if (!/[0-9]/.test(passphrase)) return { ok: false, code: 'WEAK_PASSPHRASE' };
  if (!/[^a-zA-Z0-9]/.test(passphrase)) return { ok: false, code: 'WEAK_PASSPHRASE' };
  if (isBreachedPassphrase(passphrase)) return { ok: false, code: 'WEAK_PASSPHRASE' };
  return { ok: true };
}
