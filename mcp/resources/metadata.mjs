/**
 * Structured metadata MCP resources (Issue #1 Phase A3).
 */

import fs from 'fs';
import path from 'path';
import { createVectorStore } from '../../lib/vector-store.mjs';
import { listMarkdownFiles, readNote, normalizeTags, normalizeSlug } from '../../lib/vault.mjs';
import { getMemory } from '../../lib/memory.mjs';

const SENSITIVE_KEY = /(api[_-]?key|secret|password|token|credential|authorization|bearer)/i;

function redactWalk(obj, depth = 0) {
  if (depth > 8 || obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((x) => redactWalk(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY.test(k)) out[k] = '[redacted]';
    else if (typeof v === 'object' && v !== null) out[k] = redactWalk(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 */
export function redactConfig(config) {
  return redactWalk({
    vault_path: config.vault_path,
    data_dir: config.data_dir,
    vector_store: config.vector_store,
    embedding: config.embedding,
    memory: config.memory ? { enabled: config.memory.enabled, provider: config.memory.provider } : undefined,
    air: config.air ? { enabled: config.air.enabled } : undefined,
    indexer: config.indexer,
    ignore: config.ignore,
    qdrant_configured: Boolean(config.qdrant_url),
  });
}

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 */
export async function buildIndexStats(config) {
  const mdPaths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
  let chunksIndexed = 0;
  let lastIndexed = null;
  try {
    const store = await createVectorStore(config);
    if (typeof store.count === 'function') {
      chunksIndexed = await store.count();
    }
  } catch (_) {
    chunksIndexed = 0;
  }
  const dbPath = path.join(config.data_dir, 'knowtation_vectors.db');
  try {
    if (fs.existsSync(dbPath)) {
      lastIndexed = fs.statSync(dbPath).mtime.toISOString();
    }
  } catch (_) {}

  return {
    notes_indexed: mdPaths.length,
    chunks_indexed: chunksIndexed,
    last_indexed: lastIndexed,
    vector_store: config.vector_store || 'qdrant',
    embedding_provider: config.embedding?.provider ?? null,
    embedding_model: config.embedding?.model ?? null,
  };
}

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 */
export function buildTagsResource(config) {
  const paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
  const tagMap = new Map();
  for (const p of paths) {
    try {
      const note = readNote(config.vault_path, p);
      const tags = note.tags?.length ? note.tags : normalizeTags(note.frontmatter?.tags);
      const proj = note.project || null;
      for (const t of tags) {
        const name = normalizeSlug(String(t));
        if (!name) continue;
        if (!tagMap.has(name)) tagMap.set(name, { name, count: 0, projects: new Set() });
        const entry = tagMap.get(name);
        entry.count += 1;
        if (proj) entry.projects.add(proj);
      }
    } catch (_) {}
  }
  return {
    tags: [...tagMap.values()]
      .map((x) => ({ name: x.name, count: x.count, projects: [...x.projects].sort() }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * @param {import('../../lib/config.mjs').loadConfig extends () => infer R ? R : never} config
 */
export function buildProjectsResource(config) {
  const paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
  const byProject = new Map();
  for (const p of paths) {
    try {
      const note = readNote(config.vault_path, p);
      const slug = note.project || '_unscoped';
      if (!byProject.has(slug)) {
        byProject.set(slug, { slug, note_count: 0, last_updated: null });
      }
      const row = byProject.get(slug);
      row.note_count += 1;
      const d = note.date || note.updated || '';
      if (d && (!row.last_updated || d > row.last_updated)) row.last_updated = d;
    } catch (_) {}
  }
  return {
    projects: [...byProject.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

export function buildMemoryResource(config, key) {
  const v = getMemory(config.data_dir, key);
  if (!v) return { key, value: null, updated_at: null };
  const { _at, ...rest } = v;
  return { key, value: rest, updated_at: _at ?? null };
}

export function buildAirLogResource() {
  return {
    entries: [],
    status: 'no_persisted_log',
    note: 'AIR attestation ids are not written to a log file yet; future phase may add persistence (see docs/MCP-RESOURCES-PHASE-A.md).',
  };
}
