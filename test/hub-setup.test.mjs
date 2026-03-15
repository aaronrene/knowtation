/**
 * Hub setup read/write tests.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readHubSetup, writeHubSetup } from '../lib/hub-setup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'fixtures', 'data');
const hubSetupPath = path.join(dataDir, 'hub_setup.yaml');

function cleanup() {
  try { fs.unlinkSync(hubSetupPath); } catch (_) {}
  try { fs.rmdirSync(dataDir); } catch (_) {}
}

describe('hub-setup', () => {
  after(cleanup);

  it('readHubSetup returns null when file does not exist', () => {
    cleanup();
    assert.strictEqual(readHubSetup(dataDir), null);
  });

  it('writeHubSetup creates file and readHubSetup reads it', () => {
    cleanup();
    writeHubSetup(dataDir, {
      vault: { git: { enabled: true, remote: 'https://github.com/u/r.git' } },
    });
    const read = readHubSetup(dataDir);
    assert(read !== null);
    assert.strictEqual(read.vault?.git?.enabled, true);
    assert.strictEqual(read.vault?.git?.remote, 'https://github.com/u/r.git');
  });

  it('writeHubSetup rejects empty vault_path', () => {
    assert.throws(
      () => writeHubSetup(dataDir, { vault_path: '   ' }),
      /vault_path cannot be empty/
    );
  });

  it('writeHubSetup merges with existing vault.git', () => {
    cleanup();
    writeHubSetup(dataDir, { vault_path: './vault', vault: { git: { enabled: true, remote: 'https://a.git' } } });
    writeHubSetup(dataDir, { vault: { git: { remote: 'https://b.git' } } });
    const read = readHubSetup(dataDir);
    assert.strictEqual(read?.vault_path, './vault');
    assert.strictEqual(read?.vault?.git?.enabled, true);
    assert.strictEqual(read?.vault?.git?.remote, 'https://b.git');
  });
});
