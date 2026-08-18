/**
 * Tier 1 — UNIT: PATH_ID_RE, mint, field caps, fail-closed codes (KN-WORK-PATH-LIST-b).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PATH_ID_RE,
  mintPathId,
  mintUniquePathId,
  validateNotePath,
  validateLearningPathRecord,
  validateSteps,
  learningPathSummaryForClient,
  learningPathForClient,
  upsertLearningPath,
  listLearningPaths,
  getLearningPath,
} from '../lib/path/path-store.mjs';
import { handlePathProposeRequest } from '../lib/path/path-write.mjs';
import { handlePathListRequest, handlePathGetRequest as handleGet } from '../lib/path/path-handlers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-unit');

function sampleSteps(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Step ${i + 1}`,
    objective: `Do step ${i + 1}`,
    source_document_ids: [],
  }));
}

function samplePath(overrides = {}) {
  const steps = overrides.steps ?? sampleSteps();
  const idx = overrides.current_step_index ?? 0;
  return {
    schema: 'knowtation.learning_path/v0',
    path_id: overrides.path_id ?? 'path_aabbccddeeff0011',
    scope: overrides.scope ?? 'personal',
    status: overrides.status ?? 'active',
    title: overrides.title ?? 'Algebra through music',
    summary: overrides.summary ?? 'Learn algebra with rhythm.',
    goal: overrides.goal ?? 'Finish unit 1',
    steps,
    current_step_index: idx,
    step_count: steps.length,
    next_step_title: steps[idx]?.title ?? 'Step 1',
    active_decisions: overrides.active_decisions ?? '',
    workspace_id: overrides.workspace_id ?? 'ws-personal',
    note_path: overrides.note_path ?? null,
    created: overrides.created ?? '2026-08-18T00:00:00Z',
    updated: overrides.updated ?? '2026-08-18T00:00:00Z',
    ...overrides,
    steps,
  };
}

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.PATH_WRITES_ENABLED;
});

describe('path-list unit — ids', () => {
  it('PATH_ID_RE accepts path_ + 16 hex and rejects loop_/sample-path', () => {
    assert.ok(PATH_ID_RE.test('path_aabbccddeeff0011'));
    assert.ok(!PATH_ID_RE.test('loop_school_trip'));
    assert.ok(!PATH_ID_RE.test('sample-path'));
    assert.ok(!PATH_ID_RE.test('path_'));
    assert.ok(!PATH_ID_RE.test('PATH_AABB'));
  });

  it('mintPathId is path_ + 16 lowercase hex', () => {
    const id = mintPathId();
    assert.match(id, /^path_[a-f0-9]{16}$/);
    assert.ok(PATH_ID_RE.test(id));
  });

  it('mintUniquePathId retries when the id already exists', () => {
    const first = mintPathId();
    const seen = new Set([first]);
    const second = mintUniquePathId(seen);
    assert.ok(PATH_ID_RE.test(second));
    assert.notEqual(second, first);
  });
});

describe('path-list unit — field caps and fail-closed codes', () => {
  it('rejects client path_id on path_create', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'create-id');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: {
        proposal_kind: 'path_create',
        path_id: 'path_clientsupplied01',
        title: 'T',
        summary: 'S',
        goal: 'G',
        steps: sampleSteps(),
      },
      createProposal: async () => {
        throw new Error('must not create');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.code, 'PATH_ID_NOT_ALLOWED');
  });

  it('rejects control characters as PATH_TEXT_INVALID', () => {
    const result = validateLearningPathRecord(
      samplePath({ title: 'bad\u0000title' }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PATH_TEXT_INVALID');
  });

  it('PATH_STEP_INDEX_INVALID when index >= steps.length', () => {
    const result = validateLearningPathRecord(samplePath({ current_step_index: 9 }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PATH_STEP_INDEX_INVALID');
  });

  it('note_path rejects ../ and https://', () => {
    assert.equal(validateNotePath('../secret.md').ok, false);
    assert.equal(validateNotePath('../secret.md').code, 'PATH_NOTE_PATH_INVALID');
    assert.equal(validateNotePath('https://evil.example/x.md').ok, false);
    assert.equal(validateNotePath('notes/ok.md').ok, true);
  });

  it('field caps: title 200, summary 2000, goal 180, 20 steps', () => {
    assert.equal(validateLearningPathRecord(samplePath({ title: 'x'.repeat(201) })).ok, false);
    assert.equal(validateLearningPathRecord(samplePath({ summary: 's'.repeat(2001) })).ok, false);
    assert.equal(validateLearningPathRecord(samplePath({ goal: 'g'.repeat(181) })).ok, false);
    assert.equal(validateSteps(sampleSteps(21)).ok, false);
    assert.equal(validateSteps(sampleSteps(20)).ok, true);
  });

  it('unknown proposal_kind is 400 BAD_REQUEST', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'kind');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: { proposal_kind: 'path_delete', title: 'T', summary: 'S', goal: 'G', steps: sampleSteps() },
      createProposal: async () => ({ proposal_id: 'nope' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.code, 'BAD_REQUEST');
  });

  it('PATH_SCOPE_IMMUTABLE when update includes scope', async () => {
    process.env.PATH_WRITES_ENABLED = '1';
    const dataDir = path.join(tmpRoot, 'imm');
    fs.mkdirSync(dataDir, { recursive: true });
    const row = samplePath();
    upsertLearningPath(dataDir, 'v', row);
    const result = await handlePathProposeRequest({
      dataDir,
      vaultId: 'v',
      cliScopes: ['personal'],
      body: { proposal_kind: 'path_update', path_id: row.path_id, scope: 'org' },
      createProposal: async () => ({ proposal_id: 'nope' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PATH_SCOPE_IMMUTABLE');
  });
});

describe('path-list unit — list/get projections', () => {
  it('default list omits archived; get returns archived', () => {
    const dataDir = path.join(tmpRoot, 'arch');
    fs.mkdirSync(dataDir, { recursive: true });
    upsertLearningPath(dataDir, 'v', samplePath({ path_id: 'path_active000000001', status: 'active' }));
    upsertLearningPath(dataDir, 'v', samplePath({ path_id: 'path_archived00000001', status: 'archived' }));
    const listed = listLearningPaths(dataDir, 'v', {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
    });
    assert.equal(listed.paths.some((p) => p.path_id === 'path_archived00000001'), false);
    assert.equal(listed.paths.some((p) => p.path_id === 'path_active000000001'), true);
    const got = getLearningPath(dataDir, 'v', 'path_archived00000001', {
      visibleScopes: new Set(['personal']),
    });
    assert.ok(got);
    assert.equal(got.status, 'archived');
  });

  it('next_step_title and step_count are derived', () => {
    const steps = sampleSteps(3);
    const rec = validateLearningPathRecord(samplePath({ steps, current_step_index: 1 }));
    assert.equal(rec.ok, true);
    assert.equal(rec.path.step_count, 3);
    assert.equal(rec.path.next_step_title, 'Step 2');
    const summary = learningPathSummaryForClient(rec.path);
    assert.equal('steps' in summary, false);
    assert.equal('summary' in summary, false);
    assert.equal('note_path' in summary, false);
    const full = learningPathForClient(rec.path);
    assert.equal(full.steps.length, 3);
    assert.equal(full.note_path, null);
  });

  it('handler get of invalid id is 404 PATH_NOT_FOUND', () => {
    const dataDir = path.join(tmpRoot, 'get');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = handleGet({
      dataDir,
      vaultId: 'v',
      pathId: 'not-a-path-id',
      cliScopes: ['personal'],
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.code, 'PATH_NOT_FOUND');
  });

  it('empty vault lists [] truncated false', () => {
    const dataDir = path.join(tmpRoot, 'empty');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = handlePathListRequest({
      dataDir,
      vaultId: 'empty-vault',
      cliScopes: ['personal'],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.payload.paths, []);
    assert.equal(result.payload.truncated, false);
  });
});
