/**
 * Memory event types, ID generation, validation, and secret detection.
 * Phase 8 Memory Augmentation.
 */

import crypto from 'crypto';

export const MEMORY_EVENT_TYPES = Object.freeze([
  'search',
  'export',
  'write',
  'import',
  'index',
  'propose',
  'agent_interaction',
  'capture',
  'error',
  'session_summary',
  'user',
  'consolidation',
  'maintenance',
  'insight',
]);

export const DEFAULT_CAPTURE_TYPES = Object.freeze([
  'search',
  'export',
  'write',
  'import',
  'index',
  'propose',
]);

const SENSITIVE_VALUE = /(api[_-]?key|secret|password|token|credential|authorization|bearer|private[_-]?key)/i;

/**
 * Generate a memory event ID: mem_ + 12 hex chars.
 * @returns {string}
 */
export function generateMemoryId() {
  return 'mem_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Check if a string value likely contains secrets.
 * @param {string} str
 * @returns {boolean}
 */
export function containsSensitivePattern(str) {
  if (typeof str !== 'string') return false;
  return SENSITIVE_VALUE.test(str);
}

/**
 * Recursively scan an object for keys that match secret patterns.
 * @param {unknown} obj
 * @param {number} depth
 * @returns {boolean}
 */
export function hasSensitiveKeys(obj, depth = 0) {
  if (depth > 8 || obj == null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some((v) => hasSensitiveKeys(v, depth + 1));
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_VALUE.test(k)) return true;
    if (typeof v === 'object' && v !== null && hasSensitiveKeys(v, depth + 1)) return true;
  }
  return false;
}

/** @type {readonly string[]} Valid values for the event status field. */
export const MEMORY_EVENT_STATUSES = Object.freeze(['success', 'failed']);

/**
 * Create a validated memory event object.
 * @param {string} type - Event type (must be in MEMORY_EVENT_TYPES)
 * @param {object} data - Event payload
 * @param {{ vaultId?: string, ttl?: string|null, airId?: string, status?: 'success'|'failed' }} [opts]
 * @returns {{ id: string, type: string, ts: string, vault_id: string, data: object, status: string, ttl: string|null, air_id?: string }}
 * @throws if type is invalid or data contains secrets
 */
export function createMemoryEvent(type, data, opts = {}) {
  if (!MEMORY_EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid memory event type: "${type}". Valid: ${MEMORY_EVENT_TYPES.join(', ')}`);
  }
  if (data == null || typeof data !== 'object') {
    throw new Error('Memory event data must be a non-null object.');
  }
  if (hasSensitiveKeys(data)) {
    throw new Error('Memory event data contains sensitive key patterns. Remove secrets before storing.');
  }
  const status = opts.status || 'success';
  if (!MEMORY_EVENT_STATUSES.includes(status)) {
    throw new Error(`Invalid memory event status: "${status}". Valid: ${MEMORY_EVENT_STATUSES.join(', ')}`);
  }
  const event = {
    id: generateMemoryId(),
    type,
    ts: new Date().toISOString(),
    vault_id: opts.vaultId || 'default',
    data,
    status,
    ttl: opts.ttl || null,
  };
  if (opts.airId) event.air_id = opts.airId;
  return event;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'of', 'to', 'in', 'on', 'for', 'with',
  'and', 'or', 'but', 'at', 'by', 'from', 'as', 'was', 'were', 'be',
  'been', 'has', 'had', 'do', 'did', 'will', 'can', 'may', 'not', 'no',
  'all', 'each', 'if', 'so', 'this', 'that', 'my', 'your', 'its', 'our',
]);

/**
 * Normalize a string into a URL-safe slug: lowercase, alphanumeric + hyphens,
 * no leading/trailing hyphens, collapsed runs.
 * @param {string} raw
 * @returns {string}
 */
export function slugify(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Extract a lightweight topic slug from a memory event using heuristic rules.
 *
 * Strategy (first match wins):
 * 1. data.topic — explicit topic override
 * 2. data.path / data.paths[0] — derive from the first directory component
 * 3. data.query — pick the most significant keyword(s)
 * 4. data.source / data.source_type — use as topic
 * 5. data.key — use as topic (for user-defined entries)
 * 6. Fall back to the event type itself
 *
 * @param {object} event — a memory event (needs .type and .data)
 * @returns {string} topic slug (lowercase, hyphenated, max 64 chars)
 */
export function extractTopicFromEvent(event) {
  if (!event || typeof event !== 'object') return 'unknown';
  const data = event.data;
  if (!data || typeof data !== 'object') return slugify(event.type || 'unknown');

  if (typeof data.topic === 'string' && data.topic.trim()) {
    return slugify(data.topic);
  }

  const refPath = typeof data.path === 'string' ? data.path
    : (Array.isArray(data.paths) && typeof data.paths[0] === 'string') ? data.paths[0]
      : null;
  if (refPath) {
    const segments = refPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.length > 1) {
      return slugify(segments[0]);
    }
    const stem = segments[0]?.replace(/\.md$/i, '');
    if (stem) return slugify(stem);
  }

  if (typeof data.query === 'string' && data.query.trim()) {
    const words = data.query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
    if (words.length > 0) {
      return slugify(words.slice(0, 3).join('-'));
    }
  }

  if (typeof data.source === 'string' && data.source.trim()) return slugify(data.source);
  if (typeof data.source_type === 'string' && data.source_type.trim()) return slugify(data.source_type);
  if (typeof data.key === 'string' && data.key.trim()) return slugify(data.key);
  if (typeof data.format === 'string' && data.format.trim()) return slugify(`export-${data.format}`);

  return slugify(event.type || 'unknown');
}

/**
 * Validate a memory event object read from storage.
 * Accepts events with or without the status field (backward compat).
 * @param {object} event
 * @returns {boolean}
 */
export function isValidMemoryEvent(event) {
  if (
    event == null ||
    typeof event !== 'object' ||
    typeof event.id !== 'string' ||
    !event.id.startsWith('mem_') ||
    typeof event.type !== 'string' ||
    typeof event.ts !== 'string' ||
    typeof event.vault_id !== 'string' ||
    event.data == null ||
    typeof event.data !== 'object'
  ) {
    return false;
  }
  if (event.status != null && !MEMORY_EVENT_STATUSES.includes(event.status)) {
    return false;
  }
  return true;
}
