/**
 * Tier 2 — INTEGRATION: CLI = MCP = Hub handler parity (deep-equality gate).
 *
 * @see lib/task/task-handlers.mjs
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleTaskListRequest,
  handleTaskGetRequest,
  serializeTaskPayload,
} from '../lib/task/task-handlers.mjs';
import { seedStarterTasks } from '../lib/task/task-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-parity-integration');
const starterDir = path.join(getRepoRoot(), 'tasks/starter');

function hubList(input) {
  return handleTaskListRequest({ ...input, role: 'admin' });
}

function cliList(input) {
  return handleTaskListRequest({
    ...input,
    cliScopes: ['personal', 'project', 'org'],
  });
}

function mcpList(input) {
  return handleTaskListRequest({
    ...input,
    cliScopes: ['personal', 'project', 'org'],
  });
}

function hubGet(input) {
  return handleTaskGetRequest({ ...input, role: 'admin' });
}

function cliGet(input) {
  return handleTaskGetRequest({
    ...input,
    cliScopes: ['personal', 'project', 'org'],
  });
}

function mcpGet(input) {
  return handleTaskGetRequest({
    ...input,
    cliScopes: ['personal', 'project', 'org'],
  });
}

describe('Task list/get — triple-surface parity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    seedStarterTasks(dataDir, vaultId, { starterDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('list: Hub, CLI, and MCP payloads are deep-equal for the same authorized request', () => {
    const base = { dataDir, vaultId, starterDir };
    const hub = hubList(base);
    const cli = cliList(base);
    const mcp = mcpList(base);
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(hub.payload, cli.payload);
    assert.deepEqual(cli.payload, mcp.payload);
    assert.equal(serializeTaskPayload(hub.payload), serializeTaskPayload(mcp.payload));
  });

  it('get: Hub, CLI, and MCP payloads are deep-equal for the same authorized request', () => {
    const base = { dataDir, vaultId, taskId: 'task_2g_handover_001', starterDir };
    const hub = hubGet(base);
    const cli = cliGet(base);
    const mcp = mcpGet(base);
    assert.equal(hub.ok, true);
    assert.deepEqual(hub.payload, cli.payload);
    assert.deepEqual(cli.payload, mcp.payload);
  });

  it('scope filter is identical across surfaces for list and get', () => {
    const listPersonal = hubList({ dataDir, vaultId, scope: 'personal', starterDir });
    assert.equal(listPersonal.ok, true);
    assert.ok(listPersonal.payload.tasks.every((t) => t.scope === 'personal'));
    assert.equal(listPersonal.payload.tasks.length, 1);
    assert.equal(listPersonal.payload.tasks[0].task_id, 'task_personal_practice');

    const getOrgDenied = handleTaskGetRequest({
      dataDir,
      vaultId,
      taskId: 'task_org_compliance_q2',
      visibleScopes: new Set(['personal']),
      starterDir,
    });
    assert.equal(getOrgDenied.ok, false);
    assert.equal(getOrgDenied.code, 'unknown_task');
  });

  it('seeding is idempotent across repeated listTasks calls', () => {
    const first = hubList({ dataDir, vaultId, starterDir });
    const second = hubList({ dataDir, vaultId, starterDir });
    assert.deepEqual(first.payload.tasks, second.payload.tasks);
    const ids = second.payload.tasks.map((t) => t.task_id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('Task routes — hub wiring contract', () => {
  it('registers GET /api/v1/tasks list and get with auth middleware', () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /app\.use\('\/api\/v1\/tasks', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /app\.get\('\/api\/v1\/tasks', requireRole\('viewer'/);
    assert.match(src, /app\.get\('\/api\/v1\/tasks\/:id', requireRole\('viewer'/);
    assert.match(src, /handleTaskListRequest/);
    assert.match(src, /handleTaskGetRequest/);
  });
});
