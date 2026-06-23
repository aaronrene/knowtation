/**
 * Phase 7C-L1c — hosted delegation store persistence (Netlify Blobs).
 *
 * Tiers: unit, integration, e2e, stress, data-integrity, performance, security.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DELEGATION_BLOB_FILES,
  delegationBlobKey,
  hydrateDelegationStoresFromBlob,
  persistDelegationStoresToBlob,
  withDelegationBlobSync,
} from '../hub/bridge/delegation-blob-store.mjs';
import {
  DELEGATION_CONSENTS_FILE,
  handleDelegationGrantMintRequest,
  seedDelegationFixtures,
} from '../lib/agent/delegation.mjs';
import { writeDelegationPolicy, makeAgentIdentity, makeDelegationConsent } from './fixtures/agent/delegation-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-delegation-l1c');

/** @returns {Map<string, string> & { get: (k: string, o?: { type?: string }) => Promise<string|null>, set: (k: string, v: string) => Promise<void> }} */
function makeMockBlobStore() {
  const map = new Map();
  return {
    async get(key, opts) {
      const v = map.get(key);
      if (v == null) return null;
      return opts?.type === 'text' || typeof v === 'string' ? v : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    map,
  };
}

describe('7C-L1c delegation blob store — unit', () => {
  it('delegationBlobKey namespaces filenames', () => {
    assert.equal(delegationBlobKey('hub_delegation_consents.json'), 'delegation/hub_delegation_consents.json');
  });

  it('DELEGATION_BLOB_FILES includes core index files', () => {
    assert.ok(DELEGATION_BLOB_FILES.includes(DELEGATION_CONSENTS_FILE));
  });
});

describe('7C-L1c delegation blob store — integration', () => {
  const dataDir = path.join(tmpRoot, 'integration', 'data');
  const vaultId = 'Business';

  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, 'integration'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.DELEGATION_ENABLED;
  });

  it('persist then hydrate round-trips consent index across cold start', async () => {
    const identity = makeAgentIdentity({ agentId: 'agent_l1c_smoke01' });
    const consent = makeDelegationConsent({ consentId: 'dcons_l1c_smoke01', agentId: 'agent_l1c_smoke01' });
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
    const blob = makeMockBlobStore();
    await persistDelegationStoresToBlob(blob, dataDir);
    fs.rmSync(path.join(dataDir, DELEGATION_CONSENTS_FILE));
    await hydrateDelegationStoresFromBlob(blob, dataDir);
    assert.ok(fs.existsSync(path.join(dataDir, DELEGATION_CONSENTS_FILE)));
    const mint = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: 'dcons_l1c_smoke01',
      actorAgentId: 'agent_l1c_smoke01',
      taskRef: 'task_hw_week3',
    });
    assert.equal(mint.ok, true);
  });
});

describe('7C-L1c delegation blob store — e2e', () => {
  const dataDir = path.join(tmpRoot, 'e2e', 'data');
  const vaultId = 'Business';

  beforeEach(() => {
    fs.rmSync(path.join(tmpRoot, 'e2e'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    process.env.DELEGATION_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.DELEGATION_ENABLED;
  });

  it('withDelegationBlobSync persists mint result for next lambda', async () => {
    const identity = makeAgentIdentity({ agentId: 'agent_l1c_smoke01' });
    const consent = makeDelegationConsent({ consentId: 'dcons_l1c_smoke01', agentId: 'agent_l1c_smoke01' });
    seedDelegationFixtures(dataDir, vaultId, identity, consent);
    const blob = makeMockBlobStore();
    const mint = await withDelegationBlobSync({
      blobStore: blob,
      dataDir,
      run: () =>
        handleDelegationGrantMintRequest({
          dataDir,
          vaultId,
          consentId: 'dcons_l1c_smoke01',
          actorAgentId: 'agent_l1c_smoke01',
          taskRef: 'task_hw_week3',
        }),
    });
    assert.equal(mint.ok, true);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    await hydrateDelegationStoresFromBlob(blob, dataDir);
    const list = handleDelegationGrantMintRequest({
      dataDir,
      vaultId,
      consentId: 'dcons_l1c_smoke01',
      actorAgentId: 'agent_l1c_smoke01',
      taskRef: 'task_hw_week3',
    });
    assert.equal(list.ok, true);
  });
});

describe('7C-L1c delegation blob store — stress', () => {
  it('hydrate/persist handles empty blob store', async () => {
    const dataDir = path.join(tmpRoot, 'stress', 'data');
    fs.rmSync(path.join(tmpRoot, 'stress'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    await hydrateDelegationStoresFromBlob(null, dataDir);
    await persistDelegationStoresToBlob(null, dataDir);
    assert.ok(true);
  });
});

describe('7C-L1c delegation blob store — data-integrity', () => {
  it('blob key matches persisted consent JSON', async () => {
    const dataDir = path.join(tmpRoot, 'integrity', 'data');
    fs.rmSync(path.join(tmpRoot, 'integrity'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    const identity = makeAgentIdentity({ agentId: 'agent_l1c_smoke01' });
    const consent = makeDelegationConsent({ consentId: 'dcons_l1c_smoke01', agentId: 'agent_l1c_smoke01' });
    seedDelegationFixtures(dataDir, 'Business', identity, consent);
    const blob = makeMockBlobStore();
    await persistDelegationStoresToBlob(blob, dataDir);
    const raw = blob.map.get(delegationBlobKey(DELEGATION_CONSENTS_FILE));
    assert.ok(typeof raw === 'string' && raw.includes('dcons_l1c_smoke01'));
  });
});

describe('7C-L1c delegation blob store — performance', () => {
  it('withDelegationBlobSync completes under 500ms for fixture mint', async () => {
    const dataDir = path.join(tmpRoot, 'perf', 'data');
    fs.rmSync(path.join(tmpRoot, 'perf'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeDelegationPolicy(dataDir);
    const identity = makeAgentIdentity({ agentId: 'agent_l1c_smoke01' });
    const consent = makeDelegationConsent({ consentId: 'dcons_l1c_smoke01', agentId: 'agent_l1c_smoke01' });
    seedDelegationFixtures(dataDir, 'Business', identity, consent);
    const blob = makeMockBlobStore();
    const t0 = Date.now();
    await withDelegationBlobSync({
      blobStore: blob,
      dataDir,
      run: () =>
        handleDelegationGrantMintRequest({
          dataDir,
          vaultId: 'Business',
          consentId: 'dcons_l1c_smoke01',
          actorAgentId: 'agent_l1c_smoke01',
          taskRef: 'task_hw_week3',
        }),
    });
    assert.ok(Date.now() - t0 < 500);
  });
});

describe('7C-L1c delegation blob store — security', () => {
  it('hydrate ignores malformed blob entries without throwing', async () => {
    const dataDir = path.join(tmpRoot, 'security', 'data');
    fs.rmSync(path.join(tmpRoot, 'security'), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const blob = {
      async get() {
        throw new Error('blob read denied');
      },
      async set() {},
    };
    await hydrateDelegationStoresFromBlob(blob, dataDir);
    assert.ok(true);
  });
});
