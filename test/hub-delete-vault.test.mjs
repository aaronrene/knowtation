/**
 * Self-hosted Hub delete vault orchestration (hub/hub-delete-vault.mjs).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { writeHubVaults } from '../lib/hub-vaults.mjs';
import { writeVaultAccess } from '../hub/hub_vault_access.mjs';
import { writeScope } from '../hub/hub_scope.mjs';
import { createProposal } from '../hub/proposals-store.mjs';
import { deleteSelfHostedVault } from '../hub/hub-delete-vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, 'fixtures', 'tmp-delete-vault-root');

describe('hub-delete-vault (self-hosted)', () => {
  before(() => {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true });
    fs.mkdirSync(root, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(root)) {
      try {
        fs.rmSync(root, { recursive: true });
      } catch (_) {}
    }
  });

  it('rejects deleting default vault id', async () => {
    const dataDir = path.join(root, 'd1', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const vDefault = path.join(root, 'd1', 'vault-default');
    const vWork = path.join(root, 'd1', 'vault-work');
    fs.mkdirSync(vDefault, { recursive: true });
    fs.mkdirSync(vWork, { recursive: true });
    writeHubVaults(
      dataDir,
      [
        { id: 'default', path: vDefault },
        { id: 'work', path: vWork },
      ],
      path.join(root, 'd1'),
    );
    await assert.rejects(
      () =>
        deleteSelfHostedVault({
          dataDir,
          projectRoot: path.join(root, 'd1'),
          vaultId: 'default',
          config: { vector_store: 'sqlite-vec', data_dir: dataDir },
        }),
      /Cannot delete the default vault/,
    );
  });

  it('removes vault directory, yaml entry, access, scope, and proposals', async () => {
    const base = path.join(root, 'd2');
    const dataDir = path.join(base, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const vDefault = path.join(base, 'vault-default');
    const vWork = path.join(base, 'vault-work');
    fs.mkdirSync(vDefault, { recursive: true });
    fs.mkdirSync(vWork, { recursive: true });
    fs.writeFileSync(path.join(vWork, 'note.md'), '# hi\n', 'utf8');
    writeHubVaults(
      dataDir,
      [
        { id: 'default', path: vDefault },
        { id: 'work', path: vWork },
      ],
      base,
    );
    writeVaultAccess(dataDir, { 'github:1': ['default', 'work'] });
    writeScope(dataDir, { 'github:1': { work: { projects: ['p'], folders: [] } } });
    createProposal(dataDir, { path: 'inbox/x.md', vault_id: 'work', body: 'b' });

    const out = await deleteSelfHostedVault({
      dataDir,
      projectRoot: base,
      vaultId: 'work',
      config: { vector_store: 'sqlite-vec', data_dir: dataDir },
    });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.deleted_vault_id, 'work');

    assert.strictEqual(fs.existsSync(vWork), false);
    const { readHubVaults } = await import('../lib/hub-vaults.mjs');
    const list = readHubVaults(dataDir, base);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'default');

    const { readVaultAccess } = await import('../hub/hub_vault_access.mjs');
    const acc = readVaultAccess(dataDir);
    assert.deepStrictEqual(acc['github:1'], ['default']);

    const { readScope } = await import('../hub/hub_scope.mjs');
    const sc = readScope(dataDir);
    assert.strictEqual(Object.keys(sc).length, 0);

    const { listProposals } = await import('../hub/proposals-store.mjs');
    const props = listProposals(dataDir, { limit: 100 });
    assert.strictEqual(props.proposals.length, 0);
  });
});
