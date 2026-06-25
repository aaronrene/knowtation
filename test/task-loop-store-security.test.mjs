/**
 * Tier 7 — SECURITY: scope deny, malicious titles inert, no token leakage.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { saveFlowStore } from '../lib/flow/flow-store.mjs';
import { listTaskLoops, getTaskLoop } from '../lib/task/task-loop-store.mjs';
import { handleTaskLoopListRequest } from '../lib/task/task-loop-handlers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-security');
const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');
const instancesDir = path.join(getRepoRoot(), 'task-loops/starter/instances');
const vaultId = 'vault-loop-security';

describe('Task loop store — security', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('personal scope never returns project/org loops from seeded fixtures', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks: [],
          task_loops: [
            {
              schema: 'knowtation.task_loop/v0',
              loop_id: 'loop_org_only',
              kind: 'org_work_job',
              scope: 'org',
              status: 'active',
              title: 'Org loop',
              workspace_id: 'ws-org',
              recurrence: { kind: 'manual' },
              timezone: 'UTC',
              flow_id: null,
              boundary_policy: 'observe_only',
              memory_links: [],
              created: '2026-06-01T00:00:00Z',
              updated: '2026-06-01T00:00:00Z',
              truncated: false,
            },
          ],
          orchestrator_graphs: [],
        },
      },
    });

    const result = listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
    });

    assert.ok(result.loops.every((l) => l.scope === 'personal'));
    assert.equal(result.loops.some((l) => l.loop_id === 'loop_org_only'), false);
  });

  it('getTaskLoop for out-of-scope id returns null (404 path, no existence leak)', () => {
    const dataDir = path.join(tmpRoot, 'deny');
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

  it('malicious loop title returned as inert data without scope change', () => {
    const dataDir = path.join(tmpRoot, 'inject');
    fs.mkdirSync(dataDir, { recursive: true });

    const maliciousTitle = '<script>alert("xss")</script>; DROP TABLE tasks;';
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
          tasks: [],
          task_loops: [
            {
              schema: 'knowtation.task_loop/v0',
              loop_id: 'loop_inject_test',
              kind: 'personal',
              scope: 'personal',
              status: 'active',
              title: maliciousTitle,
              workspace_id: 'ws-personal',
              recurrence: { kind: 'manual' },
              timezone: 'UTC',
              flow_id: null,
              boundary_policy: 'observe_only',
              memory_links: [],
              created: '2026-06-01T00:00:00Z',
              updated: '2026-06-01T00:00:00Z',
              truncated: false,
            },
          ],
          orchestrator_graphs: [],
        },
      },
    });

    const result = listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal']),
      filterScopes: new Set(['personal']),
      effectiveScope: 'personal',
    });

    const row = result.loops.find((l) => l.loop_id === 'loop_inject_test');
    assert.ok(row);
    assert.equal(row.title, maliciousTitle);
    assert.equal(row.scope, 'personal');
  });

  it('JSON.stringify of list response contains no token/oauth markers', () => {
    const dataDir = path.join(tmpRoot, 'leak');
    fs.mkdirSync(dataDir, { recursive: true });

    const result = handleTaskLoopListRequest({
      dataDir,
      vaultId,
      cliScopes: ['personal'],
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.payload).toLowerCase();
    assert.equal(serialized.includes('oauth'), false);
    assert.equal(serialized.includes('bearer'), false);
    assert.equal(serialized.includes('token'), false);
  });
});
