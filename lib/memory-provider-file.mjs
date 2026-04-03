/**
 * File-based memory provider: append-only JSONL event log + latest-value state overlay.
 * Phase 8 Memory Augmentation.
 *
 * Storage layout per vault:
 *   {baseDir}/events.jsonl   — one JSON object per line, append-only
 *   {baseDir}/state.json     — { [type]: latestEvent } for O(1) latest lookup
 */

import fs from 'fs';
import path from 'path';

/**
 * @param {string} baseDir — absolute path to the memory directory for one vault
 */
export class FileMemoryProvider {
  #baseDir;

  constructor(baseDir) {
    this.#baseDir = baseDir;
  }

  get baseDir() {
    return this.#baseDir;
  }

  #eventsPath() {
    return path.join(this.#baseDir, 'events.jsonl');
  }

  #statePath() {
    return path.join(this.#baseDir, 'state.json');
  }

  #ensureDir() {
    fs.mkdirSync(this.#baseDir, { recursive: true });
  }

  #readState() {
    const p = this.#statePath();
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  #writeState(state) {
    this.#ensureDir();
    fs.writeFileSync(this.#statePath(), JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * Append event to log and update state overlay.
   * @param {object} event — validated memory event from createMemoryEvent
   * @returns {{ id: string, ts: string }}
   */
  storeEvent(event) {
    this.#ensureDir();
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.#eventsPath(), line, 'utf8');

    const state = this.#readState();
    state[event.type] = event;
    this.#writeState(state);

    return { id: event.id, ts: event.ts };
  }

  /**
   * Get latest event for a given type from the state overlay.
   * @param {string} type
   * @returns {object|null}
   */
  getLatest(type) {
    const state = this.#readState();
    return state[type] ?? null;
  }

  /**
   * List events from the JSONL log with optional filters.
   * @param {{ type?: string, since?: string, until?: string, limit?: number }} [opts]
   * @returns {object[]}
   */
  listEvents(opts = {}) {
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) return [];
    const limit = Math.min(opts.limit ?? 100, 1000);
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    let events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch (_) { /* skip malformed */ }
    }
    if (opts.type) events = events.filter((e) => e.type === opts.type);
    if (opts.since) events = events.filter((e) => e.ts >= opts.since);
    if (opts.until) events = events.filter((e) => e.ts <= opts.until);
    events.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
    return events.slice(0, limit);
  }

  /**
   * Semantic search is not supported by the file provider.
   * @returns {object[]}
   */
  searchEvents(_query, _opts) {
    return [];
  }

  /**
   * @returns {boolean}
   */
  supportsSearch() {
    return false;
  }

  /**
   * Clear events, optionally by type or before a date.
   * @param {{ type?: string, before?: string }} [opts]
   * @returns {{ cleared: number }}
   */
  clearEvents(opts = {}) {
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) return { cleared: 0 };

    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    let events = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch (_) {}
    }

    const before = events.length;
    let kept = events;
    if (opts.type) {
      kept = kept.filter((e) => e.type !== opts.type);
    }
    if (opts.before) {
      kept = kept.filter((e) => e.ts >= opts.before);
    }
    if (!opts.type && !opts.before) {
      kept = [];
    }

    const cleared = before - kept.length;

    this.#ensureDir();
    if (kept.length === 0) {
      fs.writeFileSync(p, '', 'utf8');
    } else {
      fs.writeFileSync(p, kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
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

  /**
   * Remove events older than retentionDays from the log and update state.
   * @param {number} retentionDays
   * @returns {{ pruned: number }}
   */
  pruneExpired(retentionDays) {
    if (!retentionDays || retentionDays <= 0) return { pruned: 0 };
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) return { pruned: 0 };

    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const events = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch (_) {}
    }

    const kept = events.filter((e) => e.ts >= cutoff);
    const pruned = events.length - kept.length;
    if (pruned === 0) return { pruned: 0 };

    this.#ensureDir();
    if (kept.length === 0) {
      fs.writeFileSync(p, '', 'utf8');
    } else {
      fs.writeFileSync(p, kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    }

    const state = this.#readState();
    const removedTypes = new Set(
      events.filter((e) => e.ts < cutoff).map((e) => e.type)
    );
    for (const t of removedTypes) {
      const latestOfType = kept
        .filter((e) => e.type === t)
        .sort((a, b) => (b.ts > a.ts ? 1 : -1))[0];
      if (latestOfType) {
        state[t] = latestOfType;
      } else {
        delete state[t];
      }
    }
    this.#writeState(state);

    return { pruned };
  }

  /**
   * Get memory statistics.
   * @returns {{ counts_by_type: Record<string, number>, total: number, oldest: string|null, newest: string|null, size_bytes: number }}
   */
  getStats() {
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) {
      return { counts_by_type: {}, total: 0, oldest: null, newest: null, size_bytes: 0 };
    }
    const raw = fs.readFileSync(p, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const counts = {};
    let oldest = null;
    let newest = null;
    let total = 0;
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        counts[e.type] = (counts[e.type] || 0) + 1;
        total++;
        if (!oldest || e.ts < oldest) oldest = e.ts;
        if (!newest || e.ts > newest) newest = e.ts;
      } catch (_) {}
    }
    let size = 0;
    try { size = fs.statSync(p).size; } catch (_) {}
    try { size += fs.statSync(this.#statePath()).size; } catch (_) {}
    return { counts_by_type: counts, total, oldest, newest, size_bytes: size };
  }
}
