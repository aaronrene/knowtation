/**
 * Phase C + Lane D — data-integrity: secret never persisted; isolation; meta sibling file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createAgentCredentialStore, BLOB_GLOBAL } from '../hub/gateway/agent-credential-store.mjs';
import { mintCredential, listCredentialsForSub } from '../hub/lib/agent-credential-core.mjs';

const agentStoreSrc = await readFile(
  new URL('../hub/gateway/agent-credential-store.mjs', import.meta.url),
  'utf8'
);

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
      assert.equal(list.credentials[0].credential, undefined);
      assert.equal(list.credentials[0].token_hash, undefined);
      assert.ok(await fs.stat(path.join(dir, 'hosted_agent_credentials.meta.json')));
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

  it('agent store source never references refresh-tokens-v1 or gateway-auth', () => {
    const code = agentStoreSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.ok(!code.includes('refresh-tokens-v1'));
    assert.ok(!code.includes('gateway-auth'));
    assert.ok(!code.includes('hosted_refresh_tokens.json'));
    assert.ok(agentStoreSrc.includes('hosted_agent_credentials.meta.json'));
  });

  it('NETLIFY set + missing agent blob global throws and does not write file fallback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-di-netlify-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
    const prevNetlify = process.env.NETLIFY;
    process.env.NETLIFY = 'true';
    delete globalThis[BLOB_GLOBAL];
    try {
      const store = createAgentCredentialStore();
      await assert.rejects(() => store.list('google:1'), (e) => e.code === 'AGENT_CREDENTIAL_STORE_UNAVAILABLE');
      await assert.rejects(
        () => fs.stat(path.join(dir, 'hosted_agent_credentials.json')),
        (e) => e && e.code === 'ENOENT'
      );
    } finally {
      if (prevNetlify === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = prevNetlify;
      delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
