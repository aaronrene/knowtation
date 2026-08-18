/**
 * Tier 3 — E2E: Hub/bridge/gateway walkthrough with fakes (KN-WORK-PATH-LIST-b).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFlowStoreJson } from '../hub/bridge/external-agent-blob-store.mjs';
import { handlePathListRequest, handlePathGetRequest } from '../lib/path/path-handlers.mjs';
import { handlePathProposeRequest, applyApprovedPathProposal } from '../lib/path/path-write.mjs';
import { maybeApplyHostedPathAfterApprove } from '../hub/gateway/path-approve-hosted.mjs';
import { isPathProposalForHostedApply } from '../lib/path/path-hosted-proposal.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-e2e');

function sampleSteps() {
  return [{ title: 'One', objective: 'Do one', source_document_ids: [] }];
}

function fakeCreateProposal(dataDir, input) {
  const proposal_id = `prop_e2e_${Date.now()}`;
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

describe('path-list e2e', () => {
  it('GET list/get, POST propose, approve apply writes one path; blob hydrate then get', async () => {
    process.env.PATH_WRITES_ENABLED = 'true';
    const dataDir = path.join(tmpRoot, 'hub');
    fs.mkdirSync(dataDir, { recursive: true });

    const emptyList = handlePathListRequest({ dataDir, vaultId: 'v', cliScopes: ['personal'] });
    assert.deepEqual(emptyList.payload.paths, []);

    const proposed = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: { title: 'E2E path', summary: 'Walkthrough', goal: 'Prove list/get', steps: sampleSteps() },
      createProposal: (dir, input) => fakeCreateProposal(dir, input),
    });
    assert.equal(proposed.ok, true);

    const proposals = JSON.parse(fs.readFileSync(path.join(dataDir, 'hub_proposals.json'), 'utf8'));
    const row = proposals.find((p) => p.proposal_id === proposed.payload.proposal_id);
    row.status = 'approved';
    const applied = applyApprovedPathProposal(dataDir, row);
    assert.equal(applied.ok, true);

    const got = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: proposed.payload.path_id,
      cliScopes: ['personal'],
    });
    assert.equal(got.ok, true);
    assert.equal(got.payload.path.title, 'E2E path');

    const storePath = path.join(dataDir, 'hub_flow_store.json');
    const localRaw = fs.readFileSync(storePath, 'utf8');
    const blob = {
      vaults: {
        v: {
          learning_paths: [
            JSON.parse(localRaw).vaults.v.learning_paths[0],
            {
              ...JSON.parse(localRaw).vaults.v.learning_paths[0],
              path_id: 'path_fromblob00000001',
              title: 'From blob',
              updated: '2026-08-19T00:00:00Z',
            },
          ],
        },
      },
    };
    const merged = mergeFlowStoreJson(localRaw, JSON.stringify(blob));
    fs.writeFileSync(storePath, merged, 'utf8');
    const afterHydrate = handlePathGetRequest({
      dataDir,
      vaultId: 'v',
      pathId: 'path_fromblob00000001',
      cliScopes: ['personal'],
    });
    assert.equal(afterHydrate.ok, true);
    assert.equal(afterHydrate.payload.path.title, 'From blob');
  });

  it('hosted hook returns null for task/capture/media proposals', async () => {
    const nullOutcome = await maybeApplyHostedPathAfterApprove({
      method: 'GET',
      pathOnly: '/api/v1/proposals/x/approve',
      upstreamStatus: 200,
      canisterUrl: 'http://canister.test',
      bridgeUrl: 'http://bridge.test',
      authorization: undefined,
      vaultId: 'v',
      effectiveUserId: 'u',
      actorUserId: 'u',
      canisterAuthHeaders: () => ({}),
    });
    assert.equal(nullOutcome, null);

    assert.equal(
      isPathProposalForHostedApply({
        source: 'task',
        review_queue: 'task-writes',
        body: JSON.stringify({ proposal_kind: 'task_create' }),
      }),
      false,
    );
    assert.equal(
      isPathProposalForHostedApply({
        source: 'flow_capture',
        review_queue: 'flow-capture',
        body: JSON.stringify({ proposal_kind: 'promote' }),
      }),
      false,
    );
    assert.equal(
      isPathProposalForHostedApply({
        source: 'media',
        review_queue: 'media',
        body: JSON.stringify({ proposal_kind: 'media_attach' }),
      }),
      false,
    );
    assert.equal(
      isPathProposalForHostedApply({
        source: 'learning_path',
        review_queue: 'learning-path',
        body: JSON.stringify({ proposal_kind: 'path_create' }),
      }),
      true,
    );
  });

  it('no Scooling file import from path modules', () => {
    const root = getRepoRoot();
    const libPath = path.join(root, 'lib/path');
    for (const name of fs.readdirSync(libPath)) {
      const src = fs.readFileSync(path.join(libPath, name), 'utf8');
      assert.equal(src.includes('scooling/'), false, `${name} must not import Scooling`);
      assert.equal(src.includes('writeNote'), false, `${name} must not call writeNote`);
    }
  });
});
