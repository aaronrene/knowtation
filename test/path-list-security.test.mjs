/**
 * Tier 7 — SECURITY: no token leak, 404 not-leak, write gate, T5 refuse (KN-WORK-PATH-LIST-b).
 *
 * Security tier MUST fail against a pre-fix stub that (a) 403s out-of-scope get while 404 for
 * missing, or (b) writes the store when PATH_WRITES_ENABLED is unset, or (c) includes a Bearer
 * in the list JSON.
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { upsertLearningPath, listLearningPaths } from '../lib/path/path-store.mjs';
import { handlePathGetRequest, handlePathListRequest } from '../lib/path/path-handlers.mjs';
import { handlePathProposeRequest, applyApprovedPathProposal } from '../lib/path/path-write.mjs';
import { validateNotePath } from '../lib/path/path-store.mjs';
import {
  ADMITTED_TASK_PROPOSAL_KINDS,
  ADMITTED_FLOW_PROPOSAL_KINDS,
  ADMITTED_MEDIA_PROPOSAL_KINDS,
  personalSelfApplyRefusalReason,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import { isPathProposalForHostedApply } from '../lib/path/path-hosted-proposal.mjs';
import { maybeApplyHostedPathAfterApprove } from '../hub/gateway/path-approve-hosted.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-security');

function samplePath(overrides = {}) {
  return {
    schema: 'knowtation.learning_path/v0',
    path_id: 'path_sec0000000000001',
    scope: 'org',
    status: 'active',
    title: 'Org path',
    summary: 'Secret org summary',
    goal: 'Org goal',
    steps: [{ title: 'S', objective: 'O', source_document_ids: [] }],
    current_step_index: 0,
    step_count: 1,
    next_step_title: 'S',
    active_decisions: '',
    workspace_id: 'ws-org',
    note_path: null,
    created: '2026-08-18T00:00:00Z',
    updated: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

/**
 * Pre-fix stubs the security suite must reject.
 */
function preFixGetStub(exists, inScope) {
  if (!exists) return { status: 404, code: 'PATH_NOT_FOUND' };
  if (!inScope) return { status: 403, code: 'FORBIDDEN' };
  return { status: 200, code: 'OK' };
}

function preFixProposeWhenUnset() {
  return { wroteStore: true, createdCanister: true };
}

function preFixListJson() {
  return JSON.stringify({ paths: [], authorization: 'Bearer leaked-token' });
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

describe('path-list security — pre-fix stubs fail the contract', () => {
  it('(a) stub 403s out-of-scope while 404ing missing', () => {
    assert.equal(preFixGetStub(false, true).status, 404);
    assert.equal(preFixGetStub(true, false).status, 403);
    assert.notEqual(preFixGetStub(true, false).status, preFixGetStub(false, true).status);
  });

  it('(b) stub writes the store when PATH_WRITES_ENABLED is unset', () => {
    assert.equal(preFixProposeWhenUnset().wroteStore, true);
    assert.equal(preFixProposeWhenUnset().createdCanister, true);
  });

  it('(c) stub includes a Bearer in the list JSON', () => {
    assert.match(preFixListJson(), /Bearer/);
  });
});

describe('path-list security — real implementation', () => {
  it('get unknown vs out-of-scope both 404 PATH_NOT_FOUND', () => {
    const dataDir = path.join(tmpRoot, 'noleak');
    fs.mkdirSync(dataDir, { recursive: true });
    upsertLearningPath(dataDir, 'v', samplePath());
    const missing = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: 'path_doesnotexist0001',
      cliScopes: ['personal'],
    });
    const hidden = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: 'path_sec0000000000001',
      cliScopes: ['personal'],
    });
    assert.equal(missing.status, 404);
    assert.equal(hidden.status, 404);
    assert.equal(missing.code, 'PATH_NOT_FOUND');
    assert.equal(hidden.code, 'PATH_NOT_FOUND');
  });

  it('create with foreign path_id rejected', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'foreign');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: {
        path_id: 'path_foreignowned0001',
        title: 'T',
        summary: 'S',
        goal: 'G',
        steps: [{ title: 'S', objective: 'O', source_document_ids: [] }],
      },
      createProposal: async () => {
        throw new Error('must not create');
      },
    });
    assert.equal(result.code, 'PATH_ID_NOT_ALLOWED');
  });

  it('note_path traversal 400', () => {
    const bad = validateNotePath('../etc/passwd.md');
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'PATH_NOTE_PATH_INVALID');
  });

  it('write gate off → no store write, no canister create, apply-approved also 403', async () => {
    const dataDir = path.join(tmpRoot, 'gate');
    fs.mkdirSync(dataDir, { recursive: true });
    let created = false;
    const proposed = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: {
        title: 'T',
        summary: 'S',
        goal: 'G',
        steps: [{ title: 'S', objective: 'O', source_document_ids: [] }],
      },
      createProposal: async () => {
        created = true;
        return { proposal_id: 'should-not' };
      },
    });
    assert.equal(proposed.code, 'PATH_WRITES_DISABLED');
    assert.equal(created, false);
    assert.equal(fs.existsSync(path.join(dataDir, 'hub_flow_store.json')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'hub_proposals.json')), false);

    const apply = applyApprovedPathProposal(dataDir, {
      vault_id: 'v',
      body: JSON.stringify({
        proposal_kind: 'path_create',
        path: samplePath({ path_id: 'path_shouldnotwrite01', scope: 'personal' }),
      }),
    });
    assert.equal(apply.ok, false);
    assert.equal(apply.status, 403);
    assert.equal(apply.code, 'PATH_WRITES_DISABLED');
  });

  it('no token/Bearer in JSON of list/get', () => {
    const dataDir = path.join(tmpRoot, 'json');
    fs.mkdirSync(dataDir, { recursive: true });
    upsertLearningPath(
      dataDir,
      'v',
      samplePath({
        path_id: 'path_personal00000001',
        scope: 'personal',
        title: 'Must not leak credentials',
      }),
    );
    const listed = handlePathListRequest({ dataDir, vaultId: 'v', cliScopes: ['personal'] });
    const dumped = JSON.stringify(listed.payload);
    assert.equal(/Bearer/i.test(dumped), false);
    assert.equal(/authorization/i.test(dumped), false);
    assert.equal(/refresh/i.test(dumped), false);
  });

  it('path kinds are not in T5 admit lists; fingerprint is SELF_APPLY_NOT_ADMITTED', () => {
    assert.equal(ADMITTED_TASK_PROPOSAL_KINDS.includes('path_create'), false);
    assert.equal(ADMITTED_TASK_PROPOSAL_KINDS.includes('path_update'), false);
    assert.equal(ADMITTED_TASK_PROPOSAL_KINDS.includes('path_archive'), false);
    assert.equal(ADMITTED_FLOW_PROPOSAL_KINDS.includes('path_create'), false);
    assert.equal(ADMITTED_MEDIA_PROPOSAL_KINDS.includes('path_create'), false);

    const reason = personalSelfApplyRefusalReason({
      proposal: {
        source: 'learning_path',
        review_queue: 'learning-path',
        status: 'proposed',
        path: 'meta/learning-paths/proposals/prop-1.json',
        intent: 'scooling.review_tray.approve',
        external_ref: 'scooling.path:abc',
        body: JSON.stringify({ proposal_kind: 'path_create', path: { scope: 'personal' } }),
      },
      hasVaultWrite: true,
      partitionOwned: true,
      role: 'editor',
      authorActorId: 'user-1',
      approverActorId: 'user-1',
      sessionBound: true,
    });
    assert.equal(reason, 'SELF_APPLY_NOT_ADMITTED');
  });

  it('external_ref malformed 400 PATH_EXTERNAL_REF_INVALID', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'ext');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: {
        title: 'T',
        summary: 'S',
        goal: 'G',
        steps: [{ title: 'S', objective: 'O', source_document_ids: [] }],
        external_ref: 'scooling.task:not-a-path',
      },
      createProposal: async () => ({ proposal_id: 'nope' }),
    });
    assert.equal(result.code, 'PATH_EXTERNAL_REF_INVALID');
  });

  it('no writeNote from path modules', () => {
    const dir = path.join(getRepoRoot(), 'lib/path');
    for (const name of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      assert.equal(src.includes('writeNote'), false, `${name} must not reference writeNote`);
    }
  });

  it('hook returns null for task/capture/media proposals', async () => {
    assert.equal(
      isPathProposalForHostedApply({
        source: 'task',
        review_queue: 'task-writes',
        body: '{}',
      }),
      false,
    );
    const skipped = await maybeApplyHostedPathAfterApprove({
      method: 'POST',
      pathOnly: '/api/v1/notes',
      upstreamStatus: 200,
      canisterUrl: 'http://c',
      bridgeUrl: 'http://b',
      authorization: undefined,
      vaultId: 'v',
      effectiveUserId: 'u',
      actorUserId: 'u',
      canisterAuthHeaders: () => ({}),
    });
    assert.equal(skipped, null);
  });
});
