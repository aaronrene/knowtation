/**
 * Encrypted file-based memory provider: wraps FileMemoryProvider with AES-256-GCM.
 * Each JSONL line and the state.json content are encrypted at rest.
 *
 * Key derivation: scrypt(secret, per-vault-salt, 32).
 * Salt: random 16 bytes stored in {memoryDir}/.salt (created once per vault).
 * Ciphertext format per line: base64url(iv):base64url(authTag):base64url(ciphertext)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SCRYPT_N = 16384;

export class EncryptedFileMemoryProvider {
  #baseDir;
  #key;

  /**
   * @param {string} baseDir — memory directory for one vault
   * @param {string} secret — encryption secret (from KNOWTATION_MEMORY_SECRET or config)
   */
  constructor(baseDir, secret) {
    if (!secret || typeof secret !== 'string' || secret.length < 8) {
      throw new Error('Encrypted memory requires a secret of at least 8 characters.');
    }
    this.#baseDir = baseDir;
    fs.mkdirSync(baseDir, { recursive: true });
    const salt = this.#loadOrCreateSalt();
    this.#key = crypto.scryptSync(secret, salt, KEY_LENGTH, { N: SCRYPT_N });
  }

  get baseDir() {
    return this.#baseDir;
  }

  #saltPath() {
    return path.join(this.#baseDir, '.salt');
  }

  #eventsPath() {
    return path.join(this.#baseDir, 'events.jsonl.enc');
  }

  #statePath() {
    return path.join(this.#baseDir, 'state.json.enc');
  }

  #loadOrCreateSalt() {
    const sp = this.#saltPath();
    if (fs.existsSync(sp)) {
      return fs.readFileSync(sp);
    }
    const salt = crypto.randomBytes(SALT_LENGTH);
    fs.writeFileSync(sp, salt);
    return salt;
  }

  #encrypt(plaintext) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  #decrypt(line) {
    const parts = line.split(':');
    if (parts.length !== 3) throw new Error('Malformed encrypted line');
    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.#key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
  }

  #readState() {
    const p = this.#statePath();
    if (!fs.existsSync(p)) return {};
    try {
      const enc = fs.readFileSync(p, 'utf8').trim();
      if (!enc) return {};
      const json = this.#decrypt(enc);
      return JSON.parse(json);
    } catch (_) {
      return {};
    }
  }

  #writeState(state) {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(this.#statePath(), this.#encrypt(json) + '\n', 'utf8');
  }

  #readAllEvents() {
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const events = [];
    for (const line of lines) {
      try {
        const json = this.#decrypt(line);
        events.push(JSON.parse(json));
      } catch (_) {}
    }
    return events;
  }

  storeEvent(event) {
    fs.mkdirSync(this.#baseDir, { recursive: true });
    const encLine = this.#encrypt(JSON.stringify(event)) + '\n';
    fs.appendFileSync(this.#eventsPath(), encLine, 'utf8');

    const state = this.#readState();
    state[event.type] = event;
    this.#writeState(state);

    return { id: event.id, ts: event.ts };
  }

  getLatest(type) {
    const state = this.#readState();
    return state[type] ?? null;
  }

  listEvents(opts = {}) {
    const limit = Math.min(opts.limit ?? 100, 1000);
    let events = this.#readAllEvents();
    if (opts.type) events = events.filter((e) => e.type === opts.type);
    if (opts.since) events = events.filter((e) => e.ts >= opts.since);
    if (opts.until) events = events.filter((e) => e.ts <= opts.until);
    events.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
    return events.slice(0, limit);
  }

  searchEvents(_query, _opts) {
    return [];
  }

  supportsSearch() {
    return false;
  }

  clearEvents(opts = {}) {
    const events = this.#readAllEvents();
    const before = events.length;
    let kept = events;
    if (opts.type) kept = kept.filter((e) => e.type !== opts.type);
    if (opts.before) kept = kept.filter((e) => e.ts >= opts.before);
    if (!opts.type && !opts.before) kept = [];

    const cleared = before - kept.length;
    fs.mkdirSync(this.#baseDir, { recursive: true });
    if (kept.length === 0) {
      fs.writeFileSync(this.#eventsPath(), '', 'utf8');
    } else {
      const lines = kept.map((e) => this.#encrypt(JSON.stringify(e)));
      fs.writeFileSync(this.#eventsPath(), lines.join('\n') + '\n', 'utf8');
    }

    const state = this.#readState();
    const removedTypes = new Set(events.filter((e) => !kept.includes(e)).map((e) => e.type));
    for (const t of removedTypes) {
      const latestOfType = kept.filter((e) => e.type === t).sort((a, b) => (b.ts > a.ts ? 1 : -1))[0];
      if (latestOfType) {
        state[t] = latestOfType;
      } else {
        delete state[t];
      }
    }
    this.#writeState(state);
    return { cleared };
  }

  pruneExpired(retentionDays) {
    if (!retentionDays || retentionDays <= 0) return { pruned: 0 };
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const events = this.#readAllEvents();
    const kept = events.filter((e) => e.ts >= cutoff);
    const pruned = events.length - kept.length;
    if (pruned === 0) return { pruned: 0 };

    fs.mkdirSync(this.#baseDir, { recursive: true });
    if (kept.length === 0) {
      fs.writeFileSync(this.#eventsPath(), '', 'utf8');
    } else {
      const lines = kept.map((e) => this.#encrypt(JSON.stringify(e)));
      fs.writeFileSync(this.#eventsPath(), lines.join('\n') + '\n', 'utf8');
    }

    const state = this.#readState();
    const removedTypes = new Set(events.filter((e) => e.ts < cutoff).map((e) => e.type));
    for (const t of removedTypes) {
      const latestOfType = kept.filter((e) => e.type === t).sort((a, b) => (b.ts > a.ts ? 1 : -1))[0];
      if (latestOfType) {
        state[t] = latestOfType;
      } else {
        delete state[t];
      }
    }
    this.#writeState(state);
    return { pruned };
  }

  getStats() {
    const events = this.#readAllEvents();
    if (events.length === 0) {
      return { counts_by_type: {}, total: 0, oldest: null, newest: null, size_bytes: 0 };
    }
    const counts = {};
    let oldest = null;
    let newest = null;
    for (const e of events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (!oldest || e.ts < oldest) oldest = e.ts;
      if (!newest || e.ts > newest) newest = e.ts;
    }
    let size = 0;
    try { size = fs.statSync(this.#eventsPath()).size; } catch (_) {}
    try { size += fs.statSync(this.#statePath()).size; } catch (_) {}
    return { counts_by_type: counts, total: events.length, oldest, newest, size_bytes: size };
  }
}
