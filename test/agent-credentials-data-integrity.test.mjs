/**
 * Phase C — data-integrity: secret never persisted; list omits credential; namespace separate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentCredentialStore } from '../hub/gateway/agent-credential-store.mjs';
import { mintCredential, listCredentialsForSub } from '../hub/lib/agent-credential-core.mjs';

describe('Phase C data-integrity — agent credentials', () => {
  it('persisted JSON never contains raw secret; list has no credential field', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-di-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
    try {
      const store = createAgentCredentialStore();
      const minted = await store.mint({
        sub: 'google:1',
        name: 'di',
        vault_ids: ['default'],
        scopes: ['propose', 'vault:read'],
      });
      const file = path.join(dir, 'hosted_agent_credentials.json');
      const raw = await fs.readFile(file, 'utf8');
      assert.ok(!raw.includes(minted.credential));
      const secretPart = minted.credential.split('.')[1];
      assert.ok(secretPart);
      assert.ok(!raw.includes(secretPart));
      assert.ok(raw.includes('token_hash'));
      assert.ok(raw.includes('"credentials"'));
      assert.ok(!raw.includes('refresh-tokens'));

      const list = await store.list('google:1');
      assert.equal(list[0].credential, undefined);
      assert.equal(list[0].token_hash, undefined);
    } finally {
      delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('listCredentialsForSub never exposes hashes', () => {
    const { records, id } = mintCredential({}, {
      sub: 'google:1',
      name: 'x',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
    });
    const list = listCredentialsForSub(records, 'google:1');
    assert.equal(list[0].id, id);
    assert.equal(list[0].token_hash, undefined);
    assert.equal(list[0].lookup_id, undefined);
  });
});
