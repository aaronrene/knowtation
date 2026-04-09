/**
 * Vector-backed memory provider: extends file provider with embedding-based semantic search.
 * Uses the existing Knowtation embedding + vector store infrastructure.
 * Phase 8 Memory Augmentation.
 *
 * Storage:
 *   - File layer (events.jsonl + state.json) via FileMemoryProvider for durability
 *   - Vector index: embeddings of event data stored in a `_memory` collection/table
 */

import { FileMemoryProvider } from './memory-provider-file.mjs';

export class VectorMemoryProvider {
  #fileProvider;
  #config;
  #vectorStore;
  #initialized;

  /**
   * @param {string} baseDir — memory directory for one vault
   * @param {object} config — full loadConfig() result (needs embedding, vector_store, data_dir)
   */
  constructor(baseDir, config) {
    this.#fileProvider = new FileMemoryProvider(baseDir);
    this.#config = config;
    this.#vectorStore = null;
    this.#initialized = false;
  }

  get baseDir() {
    return this.#fileProvider.baseDir;
  }

  async #ensureVectorStore() {
    if (this.#initialized) return this.#vectorStore;
    try {
      const { createVectorStore } = await import('./vector-store.mjs');
      const { embeddingDimension } = await import('./embedding.mjs');
      const memConfig = {
        ...this.#config,
        data_dir: this.#fileProvider.baseDir,
      };
      this.#vectorStore = await createVectorStore(memConfig);
      const dim = embeddingDimension(this.#config.embedding);
      await this.#vectorStore.ensureCollection(dim);
    } catch (e) {
      console.error('knowtation: memory vector store init failed:', e.message);
      this.#vectorStore = null;
    }
    this.#initialized = true;
    return this.#vectorStore;
  }

  async #embedText(text) {
    try {
      const { embed } = await import('./embedding.mjs');
      const [vector] = await embed([text], this.#config.embedding, { voyageInputType: 'document' });
      return vector;
    } catch (_) {
      return null;
    }
  }

  /**
   * Build a text representation of an event for embedding.
   * @param {object} event
   * @returns {string}
   */
  #eventToText(event) {
    const parts = [event.type];
    const d = event.data;
    if (d.query) parts.push(d.query);
    if (d.key) parts.push(d.key);
    if (d.text) parts.push(d.text);
    if (d.path) parts.push(d.path);
    if (d.source_type) parts.push(d.source_type);
    if (d.operation) parts.push(d.operation);
    if (d.summary_text) parts.push(d.summary_text);
    if (d.error_message) parts.push(d.error_message);
    const extra = JSON.stringify(d);
    if (extra.length < 500) parts.push(extra);
    return parts.join(' ').slice(0, 2000);
  }

  /**
   * Store event in file log (sync) and embed + index in vector store (background).
   * Returns synchronously after the file write; vector indexing is best-effort.
   * @param {object} event
   * @returns {{ id: string, ts: string }}
   */
  storeEvent(event) {
    const result = this.#fileProvider.storeEvent(event);
    this.#indexEventAsync(event).catch(() => {});
    return result;
  }

  async #indexEventAsync(event) {
    try {
      const vs = await this.#ensureVectorStore();
      if (vs) {
        const text = this.#eventToText(event);
        const vector = await this.#embedText(text);
        if (vector) {
          await vs.upsert([{
            id: event.id,
            vector,
            payload: { id: event.id, type: event.type, ts: event.ts, text },
          }]);
        }
      }
    } catch (_) {}
  }

  getLatest(type) {
    return this.#fileProvider.getLatest(type);
  }

  listEvents(opts) {
    return this.#fileProvider.listEvents(opts);
  }

  /**
   * Semantic search over memory events using vector similarity.
   * @param {string} query
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<object[]>}
   */
  async searchEvents(query, opts = {}) {
    const limit = opts.limit ?? 10;
    try {
      const vs = await this.#ensureVectorStore();
      if (!vs) return [];
      const queryVector = await this.#embedText(query);
      if (!queryVector) return [];
      const results = await vs.search(queryVector, { limit });
      const events = this.#fileProvider.listEvents({ limit: 10000 });
      const eventMap = new Map(events.map((e) => [e.id, e]));
      return results
        .map((r) => {
          const event = eventMap.get(r.id || r.path);
          if (event) return { ...event, score: r.score };
          return { id: r.id || r.path, type: r.payload?.type, ts: r.payload?.ts, data: {}, score: r.score };
        })
        .slice(0, limit);
    } catch (_) {
      return [];
    }
  }

  supportsSearch() {
    return true;
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
