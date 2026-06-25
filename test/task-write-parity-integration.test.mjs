/**
 * Tier 2 — INTEGRATION: CLI = MCP = Hub parity + disabled gate.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleTaskProposeRequest } from '../lib/task/task-write.mjs';
import { createProposal, listProposals } from '../hub/proposals-store.mjs';
import { sampleTaskCreatePayload } from './fixtures/task/write-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-write-parity');

function stripVolatile(payload) {
  const copy = structuredClone(payload);
  delete copy.proposal_id;
  return copy;
}

describe('task write — triple-surface parity', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.TASK_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.TASK_WRITES_ENABLED;
  });

  it('Hub, CLI, MCP produce deep-equal envelope', () => {
    const body = sampleTaskCreatePayload();
    const hub = handleTaskProposeRequest({
      dataDir: path.join(tmpRoot, 'hub'),
      vaultId: 'default',
      role: 'admin',
      proposalKind: 'task_create',
      body,
      intent: 'add it',
      createProposal,
    });
    const cli = handleTaskProposeRequest({
      dataDir: path.join(tmpRoot, 'cli'),
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      proposalKind: 'task_create',
      body,
      intent: 'add it',
      createProposal,
    });
    const mcp = handleTaskProposeRequest({
      dataDir: path.join(tmpRoot, 'mcp'),
      vaultId: 'default',
      cliScopes: ['personal', 'project', 'org'],
      proposalKind: 'task_create',
      body,
      intent: 'add it',
      createProposal,
    });
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(stripVolatile(hub.payload), stripVolatile(cli.payload));
    assert.deepEqual(stripVolatile(cli.payload), stripVolatile(mcp.payload));
  });

  it('creates exactly one proposal with source task', () => {
    const dir = path.join(tmpRoot, 'one');
    fs.mkdirSync(dir, { recursive: true });
    handleTaskProposeRequest({
      dataDir: dir,
      vaultId: 'default',
      role: 'admin',
      proposalKind: 'task_create',
      body: sampleTaskCreatePayload(),
      intent: 'add',
      createProposal,
    });
    const { total, proposals } = listProposals(dir, { source: 'task' });
    assert.equal(total, 1);
    assert.equal(proposals[0].source, 'task');
    assert.equal(proposals[0].task_meta.proposal_kind, 'task_create');
  });

  it('TASK_WRITES_ENABLED=off refuses all surfaces', () => {
    delete process.env.TASK_WRITES_ENABLED;
    const dir = path.join(tmpRoot, 'off');
    fs.mkdirSync(dir, { recursive: true });
    for (const ctx of [{ role: 'admin' }, { cliScopes: ['personal'] }]) {
      const result = handleTaskProposeRequest({
        dataDir: dir,
        vaultId: 'default',
        proposalKind: 'task_create',
        body: sampleTaskCreatePayload(),
        intent: 'add',
        createProposal,
        ...ctx,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'TASK_WRITES_DISABLED');
    }
  });
});
