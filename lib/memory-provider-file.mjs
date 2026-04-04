/**
 * File-based memory provider: append-only JSONL event log + latest-value state overlay.
 * Phase 8 Memory Augmentation.
 *
 * Storage layout per vault:
 *   {baseDir}/events.jsonl       — one JSON object per line, append-only
 *   {baseDir}/state.json         — { [type]: latestEvent } for O(1) latest lookup
 *   {baseDir}/topics/{slug}.jsonl — per-topic mirror (opt-in via topicPartition: true)
 */

import fs from 'fs';
import path from 'path';
import { extractTopicFromEvent, slugify } from './memory-event.mjs';

/**
 * @param {string} baseDir — absolute path to the memory directory for one vault
 * @param {{ topicPartition?: boolean }} [opts]
 */
export class FileMemoryProvider {
  #baseDir;
  #topicPartition;

  constructor(baseDir, opts = {}) {
    this.#baseDir = baseDir;
    this.#topicPartition = Boolean(opts.topicPartition);
  }

  get baseDir() {
    return this.#baseDir;
  }

  get topicPartitionEnabled() {
    return this.#topicPartition;
  }

  #eventsPath() {
    return path.join(this.#baseDir, 'events.jsonl');
  }

  #statePath() {
    return path.join(this.#baseDir, 'state.json');
  }

  #topicsDir() {
    return path.join(this.#baseDir, 'topics');
  }

  #topicFilePath(slug) {
    return path.join(this.#topicsDir(), `${slug}.jsonl`);
  }

  #ensureDir() {
    fs.mkdirSync(this.#baseDir, { recursive: true });
  }

  #ensureTopicsDir() {
    fs.mkdirSync(this.#topicsDir(), { recursive: true });
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
   * Append event to log, update state overlay, and optionally write to topic partition.
   * @param {object} event — validated memory event from createMemoryEvent
   * @returns {{ id: string, ts: string, topic?: string }}
   */
  storeEvent(event) {
    this.#ensureDir();
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.#eventsPath(), line, 'utf8');

    const state = this.#readState();
    state[event.type] = event;
    this.#writeState(state);

    let topic;
    if (this.#topicPartition) {
      topic = extractTopicFromEvent(event);
      this.#ensureTopicsDir();
      fs.appendFileSync(this.#topicFilePath(topic), line, 'utf8');
    }

    return topic ? { id: event.id, ts: event.ts, topic } : { id: event.id, ts: event.ts };
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
   * When topic filter is provided and topic partition is enabled, reads from the
   * topic-specific file for efficiency. Otherwise falls back to scanning all events.
   * @param {{ type?: string, since?: string, until?: string, limit?: number, topic?: string }} [opts]
   * @returns {object[]}
   */
  listEvents(opts = {}) {
    const limit = Math.min(opts.limit ?? 100, 1000);
    let events;

    if (opts.topic) {
      events = this.#readTopicEvents(slugify(opts.topic));
    } else {
      const p = this.#eventsPath();
      if (!fs.existsSync(p)) return [];
      events = this.#parseJsonlFile(p);
    }

    if (opts.type) events = events.filter((e) => e.type === opts.type);
    if (opts.since) events = events.filter((e) => e.ts >= opts.since);
    if (opts.until) events = events.filter((e) => e.ts <= opts.until);
    if (opts.topic && !this.#topicPartition) {
      const slug = slugify(opts.topic);
      events = events.filter((e) => extractTopicFromEvent(e) === slug);
    }
    events.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
    return events.slice(0, limit);
  }

  /**
   * Read events from a topic-specific partition file.
   * Falls back to scanning the main log when topic partition is disabled.
   * @param {string} slug
   * @returns {object[]}
   */
  #readTopicEvents(slug) {
    if (this.#topicPartition) {
      const tp = this.#topicFilePath(slug);
      if (!fs.existsSync(tp)) return [];
      return this.#parseJsonlFile(tp);
    }
    const p = this.#eventsPath();
    if (!fs.existsSync(p)) return [];
    return this.#parseJsonlFile(p);
  }

  /**
   * Parse a JSONL file into an array of objects, skipping malformed lines.
   * @param {string} filePath
   * @returns {object[]}
   */
  #parseJsonlFile(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const events = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch (_) { /* skip malformed */ }
    }
    return events;
  }

  /**
   * List all topic slugs that have partition files.
   * @returns {string[]}
   */
  listTopics() {
    const dir = this.#topicsDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl$/, ''))
      .sort();
  }

  /**
   * Get statistics for a specific topic.
   * @param {string} slug
   * @returns {{ topic: string, total: number, oldest: string|null, newest: string|null }}
   */
  getTopicStats(slug) {
    const events = this.#readTopicEvents(slugify(slug));
    if (events.length === 0) return { topic: slug, total: 0, oldest: null, newest: null };
    let oldest = events[0].ts;
    let newest = events[0].ts;
    for (const e of events) {
      if (e.ts < oldest) oldest = e.ts;
      if (e.ts > newest) newest = e.ts;
    }
    return { topic: slug, total: events.length, oldest, newest };
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

    if (this.#topicPartition) {
      this.#rebuildTopicPartitions(kept);
    }

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

    if (this.#topicPartition) {
      this.#rebuildTopicPartitions(kept);
    }

    return { pruned };
  }

  /**
   * Rebuild all topic partition files from a complete set of surviving events.
   * Removes stale topic files and rewrites remaining ones.
   * @param {object[]} events
   */
  #rebuildTopicPartitions(events) {
    const dir = this.#topicsDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.jsonl')) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    }
    if (events.length === 0) return;
    this.#ensureTopicsDir();
    const byTopic = new Map();
    for (const e of events) {
      const slug = extractTopicFromEvent(e);
      if (!byTopic.has(slug)) byTopic.set(slug, []);
      byTopic.get(slug).push(e);
    }
    for (const [slug, topicEvents] of byTopic) {
      const content = topicEvents.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(this.#topicFilePath(slug), content, 'utf8');
    }
  }

  /**
   * Get memory statistics.
   * @returns {{ counts_by_type: Record<string, number>, total: number, oldest: string|null, newest: string|null, size_bytes: number, topics?: string[] }}
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
    const result = { counts_by_type: counts, total, oldest, newest, size_bytes: size };
    if (this.#topicPartition) {
      result.topics = this.listTopics();
    }
    return result;
  }
}
