/**
 * Indexer: vault → list notes → chunk → embed → upsert. Idempotent; stable chunk ids. SPEC §5.
 */

import { loadConfig } from './config.mjs';
import { listMarkdownFiles, readNote } from './vault.mjs';
import { chunkNote } from './chunk.mjs';
import { embed, embeddingDimension } from './embedding.mjs';
import { createVectorStore } from './vector-store.mjs';

const BATCH_EMBED = 10;
const BATCH_UPSERT = 50;

const PROGRESS_ITEM_STEP = 10;
const PROGRESS_MS = 5000;

/**
 * @param {(p: { progress: number, total?: number, message?: string }) => void | Promise<void>} onProgress
 * @param {number} minStep
 * @param {number} minMs
 */
function createThrottledProgress(onProgress, minStep, minMs) {
  let lastT = 0;
  let lastV = -1e9;
  return async (v, total, message, force = false) => {
    const now = Date.now();
    if (!force && v - lastV < minStep && now - lastT < minMs) return;
    lastT = now;
    lastV = v;
    await onProgress({ progress: v, total, message });
  };
}

/**
 * Run full index: load config, list vault md files, chunk each note, embed, upsert to vector store.
 * Logs progress to stderr. Respects config ignore patterns.
 * @param {{
 *   log?: (msg: string) => void,
 *   vaultId?: string,
 *   vaultPath?: string,
 *   onProgress?: (p: { progress: number, total?: number, message?: string }) => void | Promise<void>
 * }} options - log defaults to console.error; vaultId/vaultPath for multi-vault (hub); onProgress for MCP Phase H (throttled: every 10 items or 5s)
 * @returns {{ notesProcessed: number, chunksIndexed: number }}
 * @throws on config/embed/store failure
 */
export async function runIndex(options = {}) {
  const log = options.log || ((msg) => console.error(msg));
  const emit = options.onProgress;
  const notesProgress = emit ? createThrottledProgress(emit, PROGRESS_ITEM_STEP, PROGRESS_MS) : null;
  const embedProgress = emit ? createThrottledProgress(emit, PROGRESS_ITEM_STEP, PROGRESS_MS) : null;
  const upsertProgress = emit ? createThrottledProgress(emit, PROGRESS_ITEM_STEP, PROGRESS_MS) : null;

  const config = loadConfig();
  const vaultPath = options.vaultPath ?? config.vault_path;
  const vaultId = options.vaultId ?? 'default';
  const storeType = config.vector_store || 'qdrant';
  if (storeType === 'qdrant' && !config.qdrant_url) {
    throw new Error('qdrant_url is required for indexing when using Qdrant. Set in config/local.yaml or QDRANT_URL.');
  }
  if (storeType !== 'qdrant' && storeType !== 'sqlite-vec') {
    throw new Error(`Vector store "${storeType}" is not implemented. Use vector_store: qdrant or sqlite-vec.`);
  }

  const paths = listMarkdownFiles(vaultPath, { ignore: config.ignore });
  log(`Vault: ${vaultPath} (${vaultId}); ${paths.length} note(s) to index.`);

  const allChunks = [];
  let noteIndex = 0;
  for (const relPath of paths) {
    try {
      const note = readNote(vaultPath, relPath);
      const opts = {
        chunkSize: config.indexer?.chunk_size ?? 2048,
        chunkOverlap: config.indexer?.chunk_overlap ?? 256,
      };
      const chunks = chunkNote(note, opts);
      for (const c of chunks) {
        allChunks.push(c);
      }
    } catch (e) {
      log(`Skip ${relPath}: ${e.message}`);
    }
    noteIndex += 1;
    await notesProgress?.(
      noteIndex,
      paths.length,
      `Chunking notes ${noteIndex}/${paths.length}`,
      noteIndex === 1 || noteIndex === paths.length
    );
  }

  if (allChunks.length === 0) {
    log('No chunks to index.');
    const store = await createVectorStore(config);
    const dim = embeddingDimension(config.embedding);
    await store.ensureCollection(dim);
    await embedProgress?.(0, 0, 'No chunks to embed', true);
    await upsertProgress?.(0, 0, 'Nothing to upsert', true);
    return { notesProcessed: paths.length, chunksIndexed: 0 };
  }

  log(`Embedding ${allChunks.length} chunk(s) with ${config.embedding?.provider || 'ollama'}/${config.embedding?.model || 'nomic-embed-text'}...`);
  const vectors = [];
  for (let i = 0; i < allChunks.length; i += BATCH_EMBED) {
    const batch = allChunks.slice(i, i + BATCH_EMBED);
    const texts = batch.map((c) => c.text);
    const batchVectors = await embed(texts, config.embedding);
    for (let j = 0; j < batch.length; j++) {
      vectors.push(batchVectors[j] || []);
    }
    const done = Math.min(i + BATCH_EMBED, allChunks.length);
    await embedProgress?.(
      done,
      allChunks.length,
      `Embedding chunks ${done}/${allChunks.length}`,
      done === allChunks.length || i === 0
    );
    if (i + BATCH_EMBED < allChunks.length) {
      log(`  embedded ${done}/${allChunks.length}`);
    }
  }

  const dim = embeddingDimension(config.embedding);
  const store = await createVectorStore(config);
  await store.ensureCollection(dim);

  for (let i = 0; i < allChunks.length; i += BATCH_UPSERT) {
    const batch = allChunks.slice(i, i + BATCH_UPSERT);
    const points = batch.map((chunk, j) => ({
      id: chunk.id,
      vector: vectors[i + j] || [],
      text: chunk.text,
      path: chunk.path,
      vault_id: vaultId,
      project: chunk.project,
      tags: chunk.tags,
      date: chunk.date,
      causal_chain_id: chunk.causal_chain_id,
      entity: chunk.entity,
      episode_id: chunk.episode_id,
    }));
    await store.upsert(points);
    const done = Math.min(i + BATCH_UPSERT, allChunks.length);
    await upsertProgress?.(
      done,
      allChunks.length,
      `Upserting chunks ${done}/${allChunks.length}`,
      done === allChunks.length || i === 0
    );
    log(`  upserted ${done}/${allChunks.length}`);
  }

  log(`Done. ${paths.length} note(s), ${allChunks.length} chunk(s) indexed.`);
  return { notesProcessed: paths.length, chunksIndexed: allChunks.length };
}
