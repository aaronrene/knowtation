/**
 * Tier 2 — INTEGRATION: Task loop handlers + store seed parity.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import {
  handleTaskLoopListRequest,
  handleTaskLoopGetRequest,
  handleOrchestratorGraphGetRequest,
} from '../lib/task/task-loop-handlers.mjs';
import { listTaskLoops, getTaskLoop } from '../lib/task/task-loop-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-integration');
const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');
const instancesDir = path.join(getRepoRoot(), 'task-loops/starter/instances');
const vaultId = 'vault-loop-integration';

describe('Task loop store — handler integration', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('handleTaskLoopListRequest and listTaskLoops return matching loop counts', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const handlerResult = handleTaskLoopListRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal', 'project', 'org'],
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });
    assert.equal(handlerResult.ok, true);
    if (!handlerResult.ok) return;

    const storeResult = listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal', 'project', 'org']),
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    assert.equal(handlerResult.payload.loops.length, storeResult.loops.length);
    assert.equal(storeResult.loops.length, 5);
    assert.equal(handlerResult.payload.schema, 'knowtation.task_loop_list/v0');
  });

  it('handleTaskLoopGetRequest returns loop_school_trip for authorized scope', () => {
    const dataDir = path.join(tmpRoot, 'data-get');
    fs.mkdirSync(dataDir, { recursive: true });

    const result = handleTaskLoopGetRequest({
      dataDir,
      vaultId,
      loopId: 'loop_school_trip',
      cliScopes: ['personal'],
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.loop.loop_id, 'loop_school_trip');
    assert.equal(result.payload.schema, 'knowtation.task_loop_get/v0');
  });

  it('handleOrchestratorGraphGetRequest returns graph_school_trip', () => {
    const dataDir = path.join(tmpRoot, 'data-graph');
    fs.mkdirSync(dataDir, { recursive: true });

    const result = handleOrchestratorGraphGetRequest({
      dataDir,
      vaultId,
      graphId: 'graph_school_trip',
      cliScopes: ['personal'],
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.graph.graph_id, 'graph_school_trip');
    assert.equal(result.payload.graph.edges.length, 4);
  });

  it('getTaskLoop returns null for out-of-scope loop (no existence leak)', () => {
    const dataDir = path.join(tmpRoot, 'data-deny');
    fs.mkdirSync(dataDir, { recursive: true });

    listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal', 'project', 'org']),
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    const row = getTaskLoop(dataDir, vaultId, 'loop_school_trip', {
      visibleScopes: new Set(['org']),
    });
    assert.equal(row, null);
  });
});
