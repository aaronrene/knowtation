/**
 * Memory layer: timestamped event log with provider-based storage. Phase 8.
 *
 * Providers: file (default), vector (semantic recall), mem0 (external API).
 * Backward-compatible: storeMemory() and getMemory() still work for callers
 * that pass (dataDir, key, value) — they delegate to the file provider.
 */

import fs from 'fs';
import path from 'path';
import { createMemoryEvent, DEFAULT_CAPTURE_TYPES } from './memory-event.mjs';
import { FileMemoryProvider } from './memory-provider-file.mjs';

/**
 * Resolve the memory directory for a given vault within a data directory.
 * @param {string} dataDir
 * @param {string} [vaultId]
 * @param {{ scope?: 'vault'|'global' }} [opts]
 * @returns {string}
 */
export function resolveMemoryDir(dataDir, vaultId = 'default', opts = {}) {
  if (opts.scope === 'global') {
    return path.join(dataDir, 'memory', '_global');
  }
  return path.join(dataDir, 'memory', vaultId);
}

/**
 * Confidence levels for memory verification.
 * Computed dynamically at read time — never stored on the event.
 * @type {readonly string[]}
 */
export const MEMORY_CONFIDENCE_LEVELS = Object.freeze(['verified', 'hint', 'stale']);

/**
 * Verify a memory event against the current vault state and return a confidence assessment.
 *
 * Rules:
 * - 'stale'    — the event references a note path that no longer exists, or has been
 *                modified after the event was recorded (vault content has changed)
 * - 'verified' — the event references a path that still exists and hasn't changed since
 *                the event timestamp
 * - 'hint'     — the event has no verifiable path reference; treat as context only
 *
 * The function never throws. On any filesystem error it returns 'hint'.
 *
 * @param {object} config - loadConfig() result (needs config.vault_path)
 * @param {object} event - memory event object
 * @returns {{ confidence: 'verified'|'hint'|'stale', reason: string }}
 */
export function verifyMemoryEvent(config, event) {
  if (!event || typeof event !== 'object') {
    return { confidence: 'hint', reason: 'invalid event object' };
  }

  if (event.status === 'failed') {
    return { confidence: 'stale', reason: 'event recorded a failed operation' };
  }

  const vaultPath = config?.vault_path;
  const data = event.data;
  const eventTs = event.ts;

  const refPath = _extractPathReference(data);

  if (!refPath) {
    return { confidence: 'hint', reason: 'no verifiable path reference in event data' };
  }

  if (!vaultPath) {
    return { confidence: 'hint', reason: 'vault_path not configured, cannot verify' };
  }

  try {
    const absPath = path.isAbsolute(refPath)
      ? refPath
      : path.join(vaultPath, refPath);

    if (!fs.existsSync(absPath)) {
      return { confidence: 'stale', reason: `referenced path no longer exists: ${refPath}` };
    }

    const stat = fs.statSync(absPath);
    if (eventTs && stat.mtime.toISOString() > eventTs) {
      return {
        confidence: 'stale',
        reason: `referenced path modified after event (file: ${stat.mtime.toISOString()}, event: ${eventTs})`,
      };
    }

    return { confidence: 'verified', reason: `path exists and unchanged since event: ${refPath}` };
  } catch (_) {
    return { confidence: 'hint', reason: 'could not verify path — filesystem error' };
  }
}

/**
 * Extract the most meaningful path reference from event data.
 * Looks for common keys used by auto-captured events.
 * @param {object} data
 * @returns {string|null}
 */
function _extractPathReference(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.path === 'string' && data.path) return data.path;
  if (Array.isArray(data.paths) && data.paths[0]) return data.paths[0];
  if (Array.isArray(data.exported) && data.exported[0]?.path) return data.exported[0].path;
  return null;
}

const PRUNE_THROTTLE_MS = 3_600_000; // 1 hour
const INDEX_THROTTLE_MS = 10_000; // 10 seconds — avoids rebuilding index on rapid successive stores
const INDEX_SUMMARY_CHAR_LIMIT = 120;
const INDEX_RECENT_LIMIT = 10;

/**
 * Extract a short human-readable summary phrase from an event's data payload.
 * @param {object} event
 * @returns {string}
 */
function summarizeEventData(event) {
  const d = event.data;
  if (!d || typeof d !== 'object') return '';
  if (d.query) return String(d.query);
  if (d.path) return String(d.path);
  if (d.summary_text) return String(d.summary_text);
  if (d.format) return `format:${d.format}`;
  if (d.source) return `source:${d.source}`;
  if (d.key) return String(d.key);
  const json = JSON.stringify(d);
  return json.length > INDEX_SUMMARY_CHAR_LIMIT ? json.slice(0, INDEX_SUMMARY_CHAR_LIMIT) + '…' : json;
}

/**
 * Truncate a string and append ellipsis if longer than max.
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * Generate a lightweight markdown memory index from a MemoryManager.
 * Designed to be cheap enough (~150 chars/line) for agents to always include in context.
 * Only includes successful events (status !== 'failed').
 *
 * @param {MemoryManager} mm
 * @param {{ recentLimit?: number }} [opts]
 * @returns {{ markdown: string, generated_at: string, total_events: number, types: string[] }}
 */
export function generateMemoryIndex(mm, opts = {}) {
  const recentLimit = opts.recentLimit ?? INDEX_RECENT_LIMIT;
  const stats = mm.stats();
  const generatedAt = new Date().toISOString();

  if (stats.total === 0) {
    return {
      markdown: `# Memory Index\nGenerated: ${generatedAt}\n\n(empty — no memory events recorded yet)\n`,
      generated_at: generatedAt,
      total_events: 0,
      types: [],
    };
  }

  const lines = [`# Memory Index`, `Generated: ${generatedAt}`, ''];

  const types = Object.keys(stats.counts_by_type).sort();

  lines.push('## By Type');
  for (const type of types) {
    const count = stats.counts_by_type[type];
    const latest = mm.getLatest(type);
    if (!latest) {
      lines.push(`- ${type}: ${count} events`);
      continue;
    }
    if (latest.status === 'failed') {
      lines.push(`- ${type}: ${count} events (latest failed)`);
      continue;
    }
    const ts = latest.ts.slice(0, 19) + 'Z';
    const summary = truncate(summarizeEventData(latest), 80);
    lines.push(`- ${type}: ${count} events, last ${ts} — "${summary}"`);
  }

  lines.push('');
  lines.push('## Recent Activity');

  const recent = mm.list({ limit: recentLimit });
  const successRecent = recent.filter((e) => e.status !== 'failed');
  if (successRecent.length === 0) {
    lines.push('(no recent successful events)');
  } else {
    for (const e of successRecent) {
      const ts = e.ts.slice(0, 19) + 'Z';
      const summary = truncate(summarizeEventData(e), 80);
      lines.push(`- ${ts} [${e.type}] ${summary}`);
    }
  }

  const topics = mm.listTopics();
  if (topics.length > 0) {
    lines.push('');
    lines.push('## Topics');
    for (const t of topics) {
      const ts = mm.topicStats(t);
      lines.push(`- ${t}: ${ts.total} events`);
    }
  }

  lines.push('');

  return {
    markdown: lines.join('\n'),
    generated_at: generatedAt,
    total_events: stats.total,
    types,
    topics,
  };
}

export class MemoryManager {
  #provider;
  #config;
  #lastPruneTs;
  #lastIndexTs;
  #cachedIndex;

  /**
   * @param {object} provider — must implement storeEvent, getLatest, listEvents, searchEvents, clearEvents, getStats
   * @param {{ capture?: string[], retentionDays?: number|null }} [config]
   */
  constructor(provider, config = {}) {
    this.#provider = provider;
    this.#config = {
      capture: config.capture || [...DEFAULT_CAPTURE_TYPES],
      retentionDays: config.retentionDays ?? null,
    };
    this.#lastPruneTs = 0;
    this.#lastIndexTs = 0;
    this.#cachedIndex = null;
  }

  get provider() {
    return this.#provider;
  }

  get captureTypes() {
    return this.#config.capture;
  }

  /**
   * Whether this event type should be auto-captured based on config.
   * @param {string} type
   * @returns {boolean}
   */
  shouldCapture(type) {
    return this.#config.capture.includes(type);
  }

  /**
   * Run retention pruning if configured and throttle period has elapsed.
   * @returns {{ pruned: number }|null}
   */
  prune() {
    const days = this.#config.retentionDays;
    if (!days || days <= 0) return null;
    if (typeof this.#provider.pruneExpired !== 'function') return null;
    const now = Date.now();
    if (now - this.#lastPruneTs < PRUNE_THROTTLE_MS) return null;
    this.#lastPruneTs = now;
    return this.#provider.pruneExpired(days);
  }

  /**
   * Store a memory event. Piggybacks retention pruning and index rebuild (both throttled).
   * @param {string} type
   * @param {object} data
   * @param {{ vaultId?: string, ttl?: string|null, airId?: string, status?: 'success'|'failed' }} [opts]
   * @returns {{ id: string, ts: string }}
   */
  store(type, data, opts = {}) {
    const event = createMemoryEvent(type, data, opts);
    const result = this.#provider.storeEvent(event);
    this.prune();
    this.#maybeRebuildIndex();
    return result;
  }

  /**
   * Get the latest event for a type.
   * @param {string} type
   * @returns {object|null}
   */
  getLatest(type) {
    return this.#provider.getLatest(type);
  }

  /**
   * List events with optional filters.
   * @param {{ type?: string, since?: string, until?: string, limit?: number, topic?: string }} [opts]
   * @returns {object[]}
   */
  list(opts = {}) {
    return this.#provider.listEvents(opts);
  }

  /**
   * List all known topic slugs. Only meaningful when topic partitioning is enabled.
   * @returns {string[]}
   */
  listTopics() {
    if (typeof this.#provider.listTopics === 'function') {
      return this.#provider.listTopics();
    }
    return [];
  }

  /**
   * Get statistics for a specific topic.
   * @param {string} slug
   * @returns {{ topic: string, total: number, oldest: string|null, newest: string|null }}
   */
  topicStats(slug) {
    if (typeof this.#provider.getTopicStats === 'function') {
      return this.#provider.getTopicStats(slug);
    }
    return { topic: slug, total: 0, oldest: null, newest: null };
  }

  /**
   * Semantic search over memory entries (vector/mem0 only).
   * @param {string} query
   * @param {{ limit?: number }} [opts]
   * @returns {object[]}
   */
  search(query, opts = {}) {
    return this.#provider.searchEvents(query, opts);
  }

  /**
   * Whether the underlying provider supports semantic search.
   * @returns {boolean}
   */
  supportsSearch() {
    return typeof this.#provider.supportsSearch === 'function' && this.#provider.supportsSearch();
  }

  /**
   * Clear events with optional filters.
   * @param {{ type?: string, before?: string }} [opts]
   * @returns {{ cleared: number }}
   */
  clear(opts = {}) {
    const result = this.#provider.clearEvents(opts);
    this.#cachedIndex = null;
    return result;
  }

  /**
   * Get memory statistics.
   * @returns {{ counts_by_type: Record<string, number>, total: number, oldest: string|null, newest: string|null, size_bytes: number }}
   */
  stats() {
    return this.#provider.getStats();
  }

  /**
   * Generate the lightweight pointer index. Returns cached version if fresh,
   * otherwise rebuilds. Pass force=true to bypass the cache.
   * @param {{ force?: boolean, recentLimit?: number }} [opts]
   * @returns {{ markdown: string, generated_at: string, total_events: number, types: string[] }}
   */
  generateIndex(opts = {}) {
    if (!opts.force && this.#cachedIndex && (Date.now() - this.#lastIndexTs < INDEX_THROTTLE_MS)) {
      return this.#cachedIndex;
    }
    this.#cachedIndex = generateMemoryIndex(this, opts);
    this.#lastIndexTs = Date.now();
    return this.#cachedIndex;
  }

  #maybeRebuildIndex() {
    const now = Date.now();
    if (now - this.#lastIndexTs < INDEX_THROTTLE_MS) return;
    try {
      this.#cachedIndex = generateMemoryIndex(this);
      this.#lastIndexTs = now;
    } catch (_) { /* non-critical */ }
  }
}

/**
 * Create a MemoryManager from a Knowtation config object.
 * For file and mem0 providers this is synchronous.
 * For vector provider, use createMemoryManagerAsync() instead.
 * @param {object} config — result of loadConfig()
 * @param {string} [vaultId]
 * @returns {MemoryManager}
 */
export function createMemoryManager(config, vaultId = 'default', opts = {}) {
  const memCfg = config.memory || {};
  const providerName = memCfg.provider || 'file';
  const scope = opts.scope || memCfg.scope || 'vault';
  const baseDir = resolveMemoryDir(config.data_dir, vaultId, { scope });
  const capture = Array.isArray(memCfg.capture) ? memCfg.capture : [...DEFAULT_CAPTURE_TYPES];
  const retentionDays = memCfg.retention_days ?? null;

  const encrypt = memCfg.encrypt === true;
  const secret = memCfg.secret || process.env.KNOWTATION_MEMORY_SECRET || '';

  const topicPartition = memCfg.topic_partition === true;
  const fileProviderOpts = { topicPartition };

  let provider;
  if (encrypt && secret) {
    try {
      const mod = _encryptedProviderModule;
      if (mod?.EncryptedFileMemoryProvider) {
        provider = new mod.EncryptedFileMemoryProvider(baseDir, secret);
      } else {
        provider = new FileMemoryProvider(baseDir, fileProviderOpts);
      }
    } catch (_) {
      provider = new FileMemoryProvider(baseDir, fileProviderOpts);
    }
  } else if (providerName === 'vector') {
    try {
      const mod = _vectorProviderModule;
      if (mod?.VectorMemoryProvider) {
        provider = new mod.VectorMemoryProvider(baseDir, config);
      } else {
        provider = new FileMemoryProvider(baseDir, fileProviderOpts);
      }
    } catch (_) {
      provider = new FileMemoryProvider(baseDir, fileProviderOpts);
    }
  } else if (providerName === 'mem0') {
    try {
      const mod = _mem0ProviderModule;
      if (mod?.Mem0MemoryProvider) {
        provider = new mod.Mem0MemoryProvider(baseDir, { url: memCfg.url, apiKey: memCfg.api_key });
      } else {
        provider = new FileMemoryProvider(baseDir, fileProviderOpts);
      }
    } catch (_) {
      provider = new FileMemoryProvider(baseDir, fileProviderOpts);
    }
  } else if (providerName === 'supabase') {
    try {
      const mod = _supabaseProviderModule;
      if (mod?.SupabaseMemoryProvider) {
        const sbUrl = memCfg.supabase_url || process.env.KNOWTATION_SUPABASE_URL || '';
        const sbKey = memCfg.supabase_key || process.env.KNOWTATION_SUPABASE_KEY || '';
        provider = new mod.SupabaseMemoryProvider(baseDir, { url: sbUrl, key: sbKey, vaultId });
      } else {
        provider = new FileMemoryProvider(baseDir, fileProviderOpts);
      }
    } catch (_) {
      provider = new FileMemoryProvider(baseDir, fileProviderOpts);
    }
  } else {
    provider = new FileMemoryProvider(baseDir, fileProviderOpts);
  }

  return new MemoryManager(provider, { capture, retentionDays });
}

let _vectorProviderModule = null;
let _mem0ProviderModule = null;
let _encryptedProviderModule = null;
let _supabaseProviderModule = null;

/**
 * Async version that dynamically imports provider modules before creating.
 * @param {object} config
 * @param {string} [vaultId]
 * @returns {Promise<MemoryManager>}
 */
export async function createMemoryManagerAsync(config, vaultId = 'default', opts = {}) {
  const memCfg = config.memory || {};
  if (memCfg.encrypt && !_encryptedProviderModule) {
    try {
      _encryptedProviderModule = await import('./memory-provider-encrypted.mjs');
    } catch (_) {}
  }
  if (memCfg.provider === 'vector' && !_vectorProviderModule) {
    try {
      _vectorProviderModule = await import('./memory-provider-vector.mjs');
    } catch (_) {}
  }
  if (memCfg.provider === 'mem0' && !_mem0ProviderModule) {
    try {
      _mem0ProviderModule = await import('./memory-provider-mem0.mjs');
    } catch (_) {}
  }
  if (memCfg.provider === 'supabase' && !_supabaseProviderModule) {
    try {
      _supabaseProviderModule = await import('./memory-provider-supabase.mjs');
    } catch (_) {}
  }
  return createMemoryManager(config, vaultId, opts);
}

/**
 * Map legacy keys (last_search, last_export) to event types.
 * @param {string} key
 * @returns {string}
 */
function legacyKeyToType(key) {
  if (key === 'last_search') return 'search';
  if (key === 'last_export') return 'export';
  return key;
}

/**
 * Backward-compatible: store a value under a key. Delegates to file provider + legacy file.
 * @param {string} dataDir
 * @param {string} key
 * @param {object} value
 */
export function storeMemory(dataDir, key, value) {
  try {
    const baseDir = resolveMemoryDir(dataDir);
    const provider = new FileMemoryProvider(baseDir);
    const type = legacyKeyToType(key);
    const event = createMemoryEvent(type, value);
    provider.storeEvent(event);

    writeLegacyMemoryJson(dataDir, key, value);
  } catch (e) {
    console.error('knowtation: memory store failed:', e.message);
  }
}

/**
 * Backward-compatible: read a value by key. Returns null on miss.
 * @param {string} dataDir
 * @param {string} key
 * @returns {object|null}
 */
export function getMemory(dataDir, key) {
  try {
    const type = legacyKeyToType(key);
    const baseDir = resolveMemoryDir(dataDir);
    const provider = new FileMemoryProvider(baseDir);
    const event = provider.getLatest(type);
    if (!event) {
      return readLegacyMemoryJson(dataDir, key);
    }
    return { ...event.data, _at: event.ts };
  } catch (_) {
    return readLegacyMemoryJson(dataDir, key);
  }
}

function writeLegacyMemoryJson(dataDir, key, value) {
  try {
    const filePath = path.join(dataDir, 'memory.json');
    let data = {};
    if (fs.existsSync(filePath)) {
      try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) {}
    }
    data[key] = { ...value, _at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

function readLegacyMemoryJson(dataDir, key) {
  try {
    const filePath = path.join(dataDir, 'memory.json');
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data[key] ?? null;
  } catch (_) {
    return null;
  }
}
