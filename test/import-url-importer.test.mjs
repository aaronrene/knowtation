/**
 * URL importer integration (network: example.com).
 * Skips when example.com is not resolvable (offline/sandbox) so `npm test` is reliable without network.
 * CI and normal dev (with DNS) run the test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dns from 'node:dns/promises';
import { importUrl } from '../lib/importers/url.mjs';

let importUrlNetworkSkipReason;
try {
  await dns.lookup('example.com');
  importUrlNetworkSkipReason = false;
} catch (e) {
  const msg = e && e.message ? String(e.message) : String(e);
  importUrlNetworkSkipReason =
    'example.com DNS not available (' + msg + '); set network access or use CI to run this integration test.';
}

describe('importUrl', () => {
  it('dryRun fetches https://example.com with auto mode', { skip: importUrlNetworkSkipReason }, async () => {
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
