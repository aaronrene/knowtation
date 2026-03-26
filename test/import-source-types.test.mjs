/**
 * Import source types: CLI/core reject unknown types; each known type reaches an importer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { IMPORT_SOURCE_TYPES } from '../lib/import-source-types.mjs';
import { runImport } from '../lib/import.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scratchVault = path.join(__dirname, 'fixtures', 'tmp-import-source-types-vault');

describe('import source types', () => {
  it('rejects unknown source type before loadConfig-sensitive work', async () => {
    await assert.rejects(
      () => runImport('typo-not-a-source', '/any/path', { vaultPath: scratchVault }),
      /Unknown source type: typo-not-a-source/
    );
  });

  it('each IMPORT_SOURCE_TYPES value is accepted by runImport (importer-specific error for bad input)', async () => {
    if (!fs.existsSync(scratchVault)) fs.mkdirSync(scratchVault, { recursive: true });
    const missing = path.join(scratchVault, 'definitely-missing-input-xyz');
    for (const sourceType of IMPORT_SOURCE_TYPES) {
      await assert.rejects(
        async () => {
          await runImport(sourceType, missing, { vaultPath: scratchVault, dryRun: true });
        },
        (err) => {
          assert(
            err && typeof err.message === 'string',
            `expected error for ${sourceType}`
          );
          assert.ok(
            !err.message.includes('Unknown source type'),
            `${sourceType} should not fail as unknown type: ${err.message}`
          );
          return true;
        },
        `source type ${sourceType} should reach importer`
      );
    }
  });
});
