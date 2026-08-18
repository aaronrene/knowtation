/**
 * Tier 6 — PERFORMANCE: list 200 + get 1 within local budget; no unbounded note scan.
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md §7
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';
import { listLearningPaths, getLearningPath } from '../lib/path/path-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-path-list-perf');
const P95_BUDGET_MS = 80;

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('path-list performance', () => {
  it('list 200 + get 1 stay within p95 budget and do not scan notes', () => {
    const dataDir = path.join(tmpRoot, 'perf');
    fs.mkdirSync(dataDir, { recursive: true });
    const rows = [];
    for (let i = 0; i < 200; i += 1) {
      rows.push({
        schema: 'knowtation.learning_path/v0',
        path_id: `path_${String(i).padStart(16, '0')}`,
        scope: 'personal',
        status: 'active',
        title: `P${i}`,
        summary: `S${i}`,
        goal: `G${i}`,
        steps: [{ title: 'S', objective: 'O', source_document_ids: [] }],
        current_step_index: 0,
        step_count: 1,
        next_step_title: 'S',
        active_decisions: '',
        workspace_id: 'ws-personal',
        note_path: null,
        created: '2026-08-18T00:00:00Z',
        updated: '2026-08-18T00:00:00Z',
      });
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

    const listSamples = [];
    const getSamples = [];
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now();
      const listed = listLearningPaths(dataDir, 'v', {
        visibleScopes: new Set(['personal']),
        filterScopes: new Set(['personal']),
        effectiveScope: 'personal',
      });
      listSamples.push(performance.now() - t0);
      assert.equal(listed.paths.length, 200);
      const t1 = performance.now();
      const got = getLearningPath(dataDir, 'v', 'path_0000000000000000', {
        visibleScopes: new Set(['personal']),
      });
      getSamples.push(performance.now() - t1);
      assert.ok(got);
    }

    assert.ok(p95(listSamples) < P95_BUDGET_MS, `list p95 ${p95(listSamples)} >= ${P95_BUDGET_MS}`);
    assert.ok(p95(getSamples) < P95_BUDGET_MS, `get p95 ${p95(getSamples)} >= ${P95_BUDGET_MS}`);

    const storeSrc = fs.readFileSync(
      path.join(__dirname, '..', 'lib/path/path-store.mjs'),
      'utf8',
    );
    assert.equal(storeSrc.includes('readdirSync'), false);
    assert.equal(storeSrc.includes('listNotes'), false);
  });
});
