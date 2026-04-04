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
