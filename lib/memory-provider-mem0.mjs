/**
 * Mem0 API-backed memory provider.
 * Delegates storage and search to an external Mem0 instance at config.memory.url.
 * Falls back to file provider for listEvents/getStats when the API is unavailable.
 * Phase 8 Memory Augmentation.
 *
 * Mem0 API assumed endpoints (https://docs.mem0.ai/):
 *   POST /v1/memories/       — add memory
 *   GET  /v1/memories/       — list memories
 *   POST /v1/memories/search — search memories
 *   DELETE /v1/memories/:id  — delete memory
 */

import { FileMemoryProvider } from './memory-provider-file.mjs';

export class Mem0MemoryProvider {
  #fileProvider;
  #baseUrl;
  #apiKey;

  /**
   * @param {string} baseDir — local memory directory (for file fallback)
   * @param {{ url: string, apiKey?: string }} opts
   */
  constructor(baseDir, opts) {
    this.#fileProvider = new FileMemoryProvider(baseDir);
    this.#baseUrl = (opts.url || '').replace(/\/$/, '');
    this.#apiKey = opts.apiKey || process.env.MEM0_API_KEY || '';
  }

  get baseDir() {
    return this.#fileProvider.baseDir;
  }

  #headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.#apiKey) h['Authorization'] = `Bearer ${this.#apiKey}`;
    return h;
  }

  /**
   * Store event in both file log and Mem0 API.
   * @param {object} event
   * @returns {{ id: string, ts: string }}
   */
  storeEvent(event) {
    const result = this.#fileProvider.storeEvent(event);
    this.#storeToMem0Async(event).catch(() => {});
    return result;
  }

  async #storeToMem0Async(event) {
    if (!this.#baseUrl) return;
    try {
      const text = `[${event.type}] ${JSON.stringify(event.data)}`;
      await fetch(`${this.#baseUrl}/v1/memories/`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          metadata: { knowtation_id: event.id, type: event.type, ts: event.ts, vault_id: event.vault_id },
        }),
      });
    } catch (_) {}
  }

  getLatest(type) {
    return this.#fileProvider.getLatest(type);
  }

  listEvents(opts) {
    return this.#fileProvider.listEvents(opts);
  }

  /**
   * Semantic search via Mem0 API.
   * @param {string} query
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<object[]>}
   */
  async searchEvents(query, opts = {}) {
    if (!this.#baseUrl) return [];
    try {
      const res = await fetch(`${this.#baseUrl}/v1/memories/search`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify({ query, limit: opts.limit ?? 10 }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const memories = data.results || data.memories || data || [];
      if (!Array.isArray(memories)) return [];
      return memories.map((m) => ({
        id: m.metadata?.knowtation_id || m.id,
        type: m.metadata?.type || 'unknown',
        ts: m.metadata?.ts || m.created_at || '',
        data: { text: m.memory || m.content || '' },
        score: m.score ?? null,
      }));
    } catch (_) {
      return [];
    }
  }

  supportsSearch() {
    return Boolean(this.#baseUrl);
  }

  clearEvents(opts) {
    return this.#fileProvider.clearEvents(opts);
  }

  pruneExpired(retentionDays) {
    return this.#fileProvider.pruneExpired(retentionDays);
  }

  getStats() {
    return this.#fileProvider.getStats();
  }
}
