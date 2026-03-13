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

/**
 * Run full index: load config, list vault md files, chunk each note, embed, upsert to vector store.
 * Logs progress to stderr. Respects config ignore patterns.
 * @param {{ log?: (msg: string) => void }} options - log defaults to console.error
 * @returns {{ notesProcessed: number, chunksIndexed: number }}
 * @throws on config/embed/store failure
 */
export async function runIndex(options = {}) {
  const log = options.log || ((msg) => console.error(msg));

  const config = loadConfig();
  const storeType = config.vector_store || 'qdrant';
  if (storeType !== 'qdrant') {
    throw new Error(`Vector store "${storeType}" is not implemented. Use qdrant_url and vector_store: qdrant.`);
  }
  if (!config.qdrant_url) {
    throw new Error('qdrant_url is required for indexing. Set in config/local.yaml or QDRANT_URL.');
  }

  const paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
  log(`Vault: ${config.vault_path}; ${paths.length} note(s) to index.`);

  const allChunks = [];
  for (const relPath of paths) {
    try {
      const note = readNote(config.vault_path, relPath);
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
  }

  if (allChunks.length === 0) {
    log('No chunks to index.');
    const store = createVectorStore(config);
    const dim = embeddingDimension(config.embedding);
    await store.ensureCollection(dim);
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
    if (i + BATCH_EMBED < allChunks.length) {
      log(`  embedded ${Math.min(i + BATCH_EMBED, allChunks.length)}/${allChunks.length}`);
    }
  }

  const dim = embeddingDimension(config.embedding);
  const store = createVectorStore(config);
  await store.ensureCollection(dim);

  for (let i = 0; i < allChunks.length; i += BATCH_UPSERT) {
    const batch = allChunks.slice(i, i + BATCH_UPSERT);
    const points = batch.map((chunk, j) => ({
      id: chunk.id,
      vector: vectors[i + j] || [],
      text: chunk.text,
      path: chunk.path,
      project: chunk.project,
      tags: chunk.tags,
      date: chunk.date,
      causal_chain_id: chunk.causal_chain_id,
      entity: chunk.entity,
      episode_id: chunk.episode_id,
    }));
    await store.upsert(points);
    log(`  upserted ${Math.min(i + BATCH_UPSERT, allChunks.length)}/${allChunks.length}`);
  }

  log(`Done. ${paths.length} note(s), ${allChunks.length} chunk(s) indexed.`);
  return { notesProcessed: paths.length, chunksIndexed: allChunks.length };
}
