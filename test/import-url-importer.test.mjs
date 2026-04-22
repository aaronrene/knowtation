/**
 * URL importer integration (network: example.com).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importUrl } from '../lib/importers/url.mjs';

describe('importUrl', () => {
  it('dryRun fetches https://example.com with auto mode', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-url-dry-'));
    try {
      const result = await importUrl('https://example.com/', {
        vaultPath: dir,
        outputBase: 'inbox',
        project: null,
        tags: [],
        dryRun: true,
        urlMode: 'auto',
      });
      assert.equal(result.count, 1);
      assert.ok(result.imported[0].path.includes('imports/url/'));
      assert.ok(result.imported[0].source_id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
