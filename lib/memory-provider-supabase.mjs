/**
 * Supabase-backed memory provider: stores events in PostgreSQL (via @supabase/supabase-js)
 * with optional pgvector for semantic search.
 *
 * Table: knowtation_memory_events (see scripts/supabase-memory-migration.sql)
 *
 * Dual-write: stores to file provider (local JSONL) for offline fallback,
 * and to Supabase asynchronously for cloud persistence and pgvector search.
 */

import { FileMemoryProvider } from './memory-provider-file.mjs';

let _supabase = null;

async function getClient(url, key) {
  if (_supabase) return _supabase;
  const { createClient } = await import('@supabase/supabase-js');
  _supabase = createClient(url, key);
  return _supabase;
}

const TABLE = 'knowtation_memory_events';

export class SupabaseMemoryProvider {
  #fileProvider;
  #url;
  #key;
  #vaultId;
  #embedFn;

  /**
   * @param {string} baseDir — local memory directory for file fallback
   * @param {{ url: string, key: string, vaultId?: string, embedFn?: (text: string) => Promise<number[]|null> }} opts
   */
  constructor(baseDir, opts) {
    this.#fileProvider = new FileMemoryProvider(baseDir);
    this.#url = opts.url;
    this.#key = opts.key;
    this.#vaultId = opts.vaultId || 'default';
    this.#embedFn = opts.embedFn || null;
  }

  get baseDir() {
    return this.#fileProvider.baseDir;
  }

  async #client() {
    return getClient(this.#url, this.#key);
  }

  #eventToText(event) {
    const parts = [event.type];
    const d = event.data;
    if (d.query) parts.push(d.query);
    if (d.key) parts.push(d.key);
    if (d.text) parts.push(d.text);
    if (d.path) parts.push(d.path);
    if (d.source_type) parts.push(d.source_type);
    if (d.summary_text) parts.push(d.summary_text);
    const extra = JSON.stringify(d);
    if (extra.length < 500) parts.push(extra);
    return parts.join(' ').slice(0, 2000);
  }

  storeEvent(event) {
    const result = this.#fileProvider.storeEvent(event);
    this.#storeToSupabaseAsync(event).catch(() => {});
    return result;
  }

  async #storeToSupabaseAsync(event) {
    if (!this.#url || !this.#key) return;
    try {
      const client = await this.#client();
      const row = {
        id: event.id,
        type: event.type,
        ts: event.ts,
        vault_id: event.vault_id || this.#vaultId,
        data: event.data,
        ttl: event.ttl || null,
        air_id: event.air_id || null,
      };

      if (this.#embedFn) {
        try {
          const text = this.#eventToText(event);
          const embedding = await this.#embedFn(text);
          if (embedding) row.embedding = embedding;
        } catch (_) {}
      }

      await client.from(TABLE).insert(row);
    } catch (_) {}
  }

  getLatest(type) {
    return this.#fileProvider.getLatest(type);
  }

  listEvents(opts) {
    return this.#fileProvider.listEvents(opts);
  }

  /**
   * Semantic search via pgvector (if embeddings are stored) or text match.
   * Falls back to empty if Supabase is unreachable.
   * @param {string} query
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<object[]>}
   */
  async searchEvents(query, opts = {}) {
    const limit = opts.limit ?? 10;
    if (!this.#url || !this.#key) return [];

    try {
      const client = await this.#client();

      if (this.#embedFn) {
        const embedding = await this.#embedFn(query);
        if (embedding) {
          const { data, error } = await client.rpc('match_memory_events', {
            query_embedding: embedding,
            match_count: limit,
            filter_vault_id: this.#vaultId,
          });
          if (!error && data && data.length > 0) {
            return data.map((row) => ({
              id: row.id,
              type: row.type,
              ts: row.ts,
              data: row.data,
              vault_id: row.vault_id,
              score: row.similarity,
            }));
          }
        }
      }

      const { data, error } = await client
        .from(TABLE)
        .select('*')
        .eq('vault_id', this.#vaultId)
        .textSearch('data', query, { type: 'plain' })
        .order('ts', { ascending: false })
        .limit(limit);

      if (error || !data) return [];
      return data.map((row) => ({
        id: row.id,
        type: row.type,
        ts: row.ts,
        data: row.data,
        vault_id: row.vault_id,
        score: null,
      }));
    } catch (_) {
      return [];
    }
  }

  supportsSearch() {
    return Boolean(this.#url && this.#key);
  }

  clearEvents(opts) {
    const result = this.#fileProvider.clearEvents(opts);
    this.#clearFromSupabaseAsync(opts).catch(() => {});
    return result;
  }

  async #clearFromSupabaseAsync(opts = {}) {
    if (!this.#url || !this.#key) return;
    try {
      const client = await this.#client();
      let query = client.from(TABLE).delete().eq('vault_id', this.#vaultId);
      if (opts.type) query = query.eq('type', opts.type);
      if (opts.before) query = query.lt('ts', opts.before);
      await query;
    } catch (_) {}
  }

  pruneExpired(retentionDays) {
    const result = this.#fileProvider.pruneExpired(retentionDays);
    if (retentionDays && retentionDays > 0) {
      this.#pruneFromSupabaseAsync(retentionDays).catch(() => {});
    }
    return result;
  }

  async #pruneFromSupabaseAsync(retentionDays) {
    if (!this.#url || !this.#key) return;
    try {
      const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
      const client = await this.#client();
      await client.from(TABLE).delete().eq('vault_id', this.#vaultId).lt('ts', cutoff);
    } catch (_) {}
  }

  getStats() {
    return this.#fileProvider.getStats();
  }
}
