/**
 * Tier 2 — INTEGRATION: upsert → list → get, scope, write gate, propose/apply (KN-WORK-PATH-LIST-b).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertLearningPath, getLearningPath, loadLearningPaths } from '../lib/path/path-store.mjs';
import { handlePathListRequest, handlePathGetRequest } from '../lib/path/path-handlers.mjs';
import {
  handlePathProposeRequest,
  applyApprovedPathProposal,
  getPathWritesEnabled,
} from '../lib/path/path-write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-integration');

function sampleSteps() {
  return [
    { title: 'Step 1', objective: 'Start', source_document_ids: [] },
    { title: 'Step 2', objective: 'Finish', source_document_ids: [] },
  ];
}

function samplePath(overrides = {}) {
  const steps = sampleSteps();
  return {
    schema: 'knowtation.learning_path/v0',
    path_id: 'path_aabbccddeeff0011',
    scope: 'personal',
    status: 'active',
    title: 'Path A',
    summary: 'Summary A',
    goal: 'Goal A',
    steps,
    current_step_index: 0,
    step_count: 2,
    next_step_title: 'Step 1',
    active_decisions: '',
    workspace_id: 'ws-personal',
    note_path: null,
    created: '2026-08-18T00:00:00Z',
    updated: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

function fakeCreateProposal(dataDir, input) {
  const proposal_id = `prop_${Math.random().toString(16).slice(2, 10)}`;
  const row = { proposal_id, status: 'proposed', ...input };
  const fp = path.join(dataDir, 'hub_proposals.json');
  const all = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : [];
  all.push(row);
  fs.writeFileSync(fp, JSON.stringify(all, null, 2), 'utf8');
  return row;
}

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  delete process.env.PATH_WRITES_ENABLED;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.PATH_WRITES_ENABLED;
});

describe('path-list integration', () => {
  it('upsert → list → get', () => {
    const dataDir = path.join(tmpRoot, 'ulg');
    fs.mkdirSync(dataDir, { recursive: true });
    const row = samplePath();
    upsertLearningPath(dataDir, 'v', row);
    const listed = handlePathListRequest({ dataDir, vaultId: 'v', cliScopes: ['personal'] });
    assert.equal(listed.ok, true);
    assert.equal(listed.payload.paths.length, 1);
    assert.equal(listed.payload.paths[0].path_id, row.path_id);
    const got = handlePathGetRequest({ dataDir, vaultId: 'v', pathId: row.path_id, cliScopes: ['personal'] });
    assert.equal(got.ok, true);
    assert.equal(got.payload.path.title, 'Path A');
    assert.equal(got.payload.path.steps.length, 2);
  });

  it('scope deny: personal cannot get org path (404 not leak)', () => {
    const dataDir = path.join(tmpRoot, 'scope');
    fs.mkdirSync(dataDir, { recursive: true });
    upsertLearningPath(dataDir, 'v', samplePath({ path_id: 'path_orgonly000000001', scope: 'org' }));
    const listed = handlePathListRequest({ dataDir, vaultId: 'v', cliScopes: ['personal'] });
    assert.equal(listed.payload.paths.length, 0);
    const denied = handlePathListRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      scope: 'org',
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.equal(denied.code, 'PATH_SCOPE_DENIED');
    const got = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: 'path_orgonly000000001',
      cliScopes: ['personal'],
    });
    assert.equal(got.status, 404);
    assert.equal(got.code, 'PATH_NOT_FOUND');
  });

  it('workspace filter', () => {
    const dataDir = path.join(tmpRoot, 'ws');
    fs.mkdirSync(dataDir, { recursive: true });
    upsertLearningPath(dataDir, 'v', samplePath({ path_id: 'path_wsone00000000001', workspace_id: 'ws-personal' }));
    upsertLearningPath(dataDir, 'v', samplePath({ path_id: 'path_wstwo00000000002', workspace_id: 'ws-other' }));
    const listed = handlePathListRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      workspace_id: 'ws-personal',
    });
    assert.equal(listed.payload.paths.length, 1);
    assert.equal(listed.payload.paths[0].path_id, 'path_wsone00000000001');
  });

  it('gate off propose 403 and store unchanged', async () => {
    const dataDir = path.join(tmpRoot, 'gateoff');
    fs.mkdirSync(dataDir, { recursive: true });
    assert.equal(getPathWritesEnabled(), false);
    const before = loadLearningPaths(dataDir, 'v');
    const result = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: {
        title: 'T',
        summary: 'S',
        goal: 'G',
        steps: sampleSteps(),
      },
      createProposal: async () => {
        throw new Error('must not create proposal');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, 'PATH_WRITES_DISABLED');
    assert.equal(loadLearningPaths(dataDir, 'v').length, before.length);
    assert.equal(fs.existsSync(path.join(dataDir, 'hub_proposals.json')), false);
  });

  it('gate on create propose then apply → get', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'apply');
    fs.mkdirSync(dataDir, { recursive: true });
    const proposed = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: {
        title: 'Created',
        summary: 'Created summary',
        goal: 'Created goal',
        steps: sampleSteps(),
      },
      createProposal: (dir, input) => fakeCreateProposal(dir, input),
    });
    assert.equal(proposed.ok, true);
    const proposals = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub_proposals.json'), 'utf8'));
    const row = proposals.find((p) => p.proposal_id === proposed.payload.proposal_id);
    const applied = applyApprovedPathProposal(dataDir, row);
    assert.equal(applied.ok, true);
    const got = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: proposed.payload.path_id,
      cliScopes: ['personal'],
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.path.title, 'Created');
  });

  it('update then archive', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'upd');
    fs.mkdirSync(dataDir, { recursive: true });
    const seed = samplePath();
    upsertLearningPath(dataDir, 'v', seed);
    const upd = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: { proposal_kind: 'path_update', path_id: seed.path_id, title: 'Updated title' },
      createProposal: (dir, input) => fakeCreateProposal(dir, input),
    });
    assert.equal(upd.ok, true);
    const proposals = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub_proposals.json'), 'utf8'));
    applyApprovedPathProposal(dataDir, proposals.find((p) => p.proposal_id === upd.payload.proposal_id));
    assert.equal(getLearningPath(dataDir, 'v', seed.path_id, { visibleScopes: new Set(['personal']) }).title, 'Updated title');

    const arch = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: { proposal_kind: 'path_archive', path_id: seed.path_id },
      createProposal: (dir, input) => fakeCreateProposal(dir, input),
    });
    const all = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub_proposals.json'), 'utf8'));
    applyApprovedPathProposal(dataDir, all.find((p) => p.proposal_id === arch.payload.proposal_id));
    const listed = handlePathListRequest({ dataDir, vaultId: 'v', cliScopes: ['personal'] });
    assert.equal(listed.payload.paths.length, 0);
    const got = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: seed.path_id,
      cliScopes: ['personal'],
    });
    assert.equal(got.payload.path.status, 'archived');
  });

  it('empty vault lists []', () => {
    const dataDir = path.join(tmpRoot, 'empty');
    fs.mkdirSync(dataDir, { recursive: true });
    const listed = handlePathListRequest({ dataDir, vaultId: 'none', cliScopes: ['personal'] });
    assert.deepEqual(listed.payload.paths, []);
    assert.equal(listed.payload.truncated, false);
  });
});
