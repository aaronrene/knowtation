/**
 * Tier 5 — DATA-INTEGRITY: blob merge by path_id, apply twice, archive keeps row (KN-WORK-PATH-LIST-b).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFlowStoreJson } from '../hub/bridge/external-agent-blob-store.mjs';
import { loadFlowStore } from '../lib/flow/flow-store.mjs';
import { upsertLearningPath, getLearningPath, loadLearningPaths } from '../lib/path/path-store.mjs';
import { applyApprovedPathProposal } from '../lib/path/path-write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-integrity');

function sampleRecord(overrides = {}) {
  return {
    schema: 'knowtation.learning_path/v0',
    path_id: 'path_aabbccddeeff0011',
    scope: 'personal',
    status: 'active',
    title: 'Keep me',
    summary: 'Summary',
    goal: 'Goal',
    steps: [{ title: 'S1', objective: 'O1', source_document_ids: [] }],
    current_step_index: 0,
    step_count: 1,
    next_step_title: 'S1',
    active_decisions: '',
    workspace_id: 'ws-personal',
    note_path: 'notes/keep.md',
    created: '2026-08-18T00:00:00Z',
    updated: '2026-08-18T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.PATH_WRITES_ENABLED = '1';
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.PATH_WRITES_ENABLED;
});

describe('path-list data-integrity', () => {
  it('mergeFlowStoreJson unions by path_id (stale local must not mask blob)', () => {
    const local = {
      vaults: {
        v: {
          learning_paths: [sampleRecord({ path_id: 'path_localonly0000001', title: 'Local only' })],
        },
      },
    };
    const blob = {
      vaults: {
        v: {
          learning_paths: [
            sampleRecord({
              path_id: 'path_blobonly00000001',
              title: 'Blob only',
              updated: '2026-08-19T00:00:00Z',
            }),
            sampleRecord({
              path_id: 'path_localonly0000001',
              title: 'Fresher blob title',
              updated: '2026-08-20T00:00:00Z',
            }),
          ],
        },
      },
    };
    const merged = JSON.parse(mergeFlowStoreJson(JSON.stringify(local), JSON.stringify(blob)));
    const ids = merged.vaults.v.learning_paths.map((p) => p.path_id).sort();
    assert.deepEqual(ids, ['path_blobonly00000001', 'path_localonly0000001']);
    const shared = merged.vaults.v.learning_paths.find((p) => p.path_id === 'path_localonly0000001');
    assert.equal(shared.title, 'Fresher blob title');
  });

  it('apply twice is idempotent', () => {
    const dataDir = path.join(tmpRoot, 'twice');
    fs.mkdirSync(dataDir, { recursive: true });
    const record = sampleRecord();
    const proposal = {
      proposal_id: 'prop_twice',
      vault_id: 'v',
      source: 'learning_path',
      review_queue: 'learning-path',
      body: JSON.stringify({ proposal_kind: 'path_create', path: record }),
      frontmatter: { proposal_kind: 'path_create', path_id: record.path_id },
    };
    const first = applyApprovedPathProposal(dataDir, proposal);
    const second = applyApprovedPathProposal(dataDir, proposal);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(loadLearningPaths(dataDir, 'v').length, 1);
  });

  it('archive keeps the row and does not delete note_path', () => {
    const dataDir = path.join(tmpRoot, 'arch');
    fs.mkdirSync(dataDir, { recursive: true });
    const record = sampleRecord();
    upsertLearningPath(dataDir, 'v', record);
    const proposal = {
      proposal_id: 'prop_arch',
      vault_id: 'v',
      source: 'learning_path',
      body: JSON.stringify({ proposal_kind: 'path_archive', path_id: record.path_id }),
      frontmatter: { proposal_kind: 'path_archive' },
    };
    const applied = applyApprovedPathProposal(dataDir, proposal);
    assert.equal(applied.ok, true);
    const got = getLearningPath(dataDir, 'v', record.path_id, { visibleScopes: new Set(['personal']) });
    assert.equal(got.status, 'archived');
    assert.equal(got.note_path, 'notes/keep.md');
  });

  it('restart load reads the same store file', () => {
    const dataDir = path.join(tmpRoot, 'restart');
    fs.mkdirSync(dataDir, { recursive: true });
    upsertLearningPath(dataDir, 'v', sampleRecord());
    const first = loadFlowStore(dataDir);
    const second = loadFlowStore(dataDir);
    assert.equal(first.vaults.v.learning_paths[0].path_id, second.vaults.v.learning_paths[0].path_id);
    assert.equal(second.vaults.v.learning_paths[0].title, 'Keep me');
  });
});
