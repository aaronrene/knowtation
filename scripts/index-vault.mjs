#!/usr/bin/env node
import '../lib/load-env.mjs';

/**
 * Index vault: walk Markdown under vault_path → chunk → embed → upsert to Qdrant.
 * Config: config/local.yaml or env (KNOWTATION_VAULT_PATH, QDRANT_URL).
 * Exit 0 on success, 2 on failure. SPEC §5; Phase 2.
 */

import { runIndex } from '../lib/indexer.mjs';

async function main() {
  try {
    await runIndex();
    process.exit(0);
  } catch (e) {
    console.error('Index failed:', e.message);
    process.exit(2);
  }
}

main();
