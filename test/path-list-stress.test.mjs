/**
 * Tier 4 — STRESS: 200+ truncate, concurrent last-updated, 20-step cap (KN-WORK-PATH-LIST-b).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';
import {
  listLearningPaths,
  upsertLearningPath,
  getLearningPath,
  MAX_LEARNING_PATH_SUMMARIES,
  validateSteps,
} from '../lib/path/path-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-stress');

function makePath(i, overrides = {}) {
  return {
    schema: 'knowtation.learning_path/v0',
    path_id: `path_${String(i).padStart(16, '0')}`,
    scope: 'personal',
    status: 'active',
    title: `Path ${i}`,
    summary: `Summary ${i}`,
    goal: `Goal ${i}`,
    steps: [{ title: 'S', objective: 'O', source_document_ids: [] }],
    current_step_index: 0,
    step_count: 1,
    next_step_title: 'S',
    active_decisions: '',
    workspace_id: 'ws-personal',
    note_path: null,
    created: '2026-08-18T00:00:00Z',
    updated: overrides.updated ?? `2026-08-18T00:00:${String(i % 60).padStart(2, '0')}Z`,
    ...overrides,
  };
}

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('path-list stress', () => {
  it('200+ rows truncate at MAX_LEARNING_PATH_SUMMARIES', () => {
    const dataDir = path.join(tmpRoot, 'cap');
    fs.mkdirSync(dataDir, { recursive: true });
    const rows = [];
    for (let i = 0; i < MAX_LEARNING_PATH_SUMMARIES + 40; i += 1) {
      rows.push(makePath(i));
    }
    saveFlowStore(dataDir, {
      vaults: {
        v: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks: [],
          task_loops: [],
          orchestrator_graphs: [],
          learning_paths: rows,
        },
      },
    });
    const listed = listLearningPaths(dataDir, 'v', {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
    });
    assert.equal(listed.paths.length, MAX_LEARNING_PATH_SUMMARIES);
    assert.equal(listed.truncated, true);
  });

  it('concurrent upsert same path_id last-updated wins', () => {
    const dataDir = path.join(tmpRoot, 'race');
    fs.mkdirSync(dataDir, { recursive: true });
    const id = 'path_concurrent000001';
    upsertLearningPath(dataDir, 'v', makePath(1, { path_id: id, title: 'Older', updated: '2026-08-18T01:00:00Z' }));
    upsertLearningPath(dataDir, 'v', makePath(1, { path_id: id, title: 'Newer', updated: '2026-08-18T02:00:00Z' }));
    const got = getLearningPath(dataDir, 'v', id, { visibleScopes: new Set(['personal']) });
    assert.equal(got.title, 'Newer');
    assert.equal(got.updated, '2026-08-18T02:00:00Z');
  });

  it('20-step cap', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      title: `T${i}`,
      objective: `O${i}`,
      source_document_ids: [],
    }));
    const twentyOne = [...twenty, { title: 'T20', objective: 'O20', source_document_ids: [] }];
    assert.equal(validateSteps(twenty).ok, true);
    assert.equal(validateSteps(twentyOne).ok, false);
  });
});
