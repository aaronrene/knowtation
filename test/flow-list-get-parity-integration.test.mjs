/**
 * Tier 2 — INTEGRATION: CLI = MCP = Hub handler parity (deep-equality gate).
 *
 * @see lib/flow/flow-handlers.mjs
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §7–§8
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowListRequest,
  handleFlowGetRequest,
  serializeFlowPayload,
} from '../lib/flow/flow-handlers.mjs';
import { seedStarterFlows } from '../lib/flow/flow-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-parity-integration');
const starterDir = path.join(getRepoRoot(), 'flows/starter');

function hubList(input) {
  return handleFlowListRequest({ ...input, role: 'admin' });
}

function cliList(input) {
  return handleFlowListRequest({
    ...input,
    cliScopes: ['personal', 'project'],
  });
}

function mcpList(input) {
  return handleFlowListRequest({
    ...input,
    cliScopes: ['personal', 'project'],
  });
}

function hubGet(input) {
  return handleFlowGetRequest({ ...input, role: 'admin' });
}

function cliGet(input) {
  return handleFlowGetRequest({
    ...input,
    cliScopes: ['personal', 'project'],
  });
}

function mcpGet(input) {
  return handleFlowGetRequest({
    ...input,
    cliScopes: ['personal', 'project'],
  });
}

describe('Flow list/get — triple-surface parity', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    seedStarterFlows(dataDir, vaultId, { starterDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('list: Hub, CLI, and MCP payloads are deep-equal for the same authorized request', () => {
    const base = { dataDir, vaultId, scope: 'personal' };
    const hub = hubList(base);
    const cli = cliList(base);
    const mcp = mcpList(base);
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(hub.payload, cli.payload);
    assert.deepEqual(cli.payload, mcp.payload);
    assert.equal(serializeFlowPayload(hub.payload), serializeFlowPayload(mcp.payload));
  });

  it('get: Hub, CLI, and MCP payloads are deep-equal for the same authorized request', () => {
    const base = { dataDir, vaultId, flowId: 'flow_overseer_handover' };
    const hub = hubGet(base);
    const cli = cliGet(base);
    const mcp = mcpGet(base);
    assert.equal(hub.ok, true);
    assert.deepEqual(hub.payload, cli.payload);
    assert.deepEqual(cli.payload, mcp.payload);
  });

  it('scope filter is identical across surfaces for list and get', () => {
    const listPersonal = hubList({ dataDir, vaultId, scope: 'personal' });
    assert.equal(listPersonal.ok, true);
    assert.ok(listPersonal.payload.flows.every((f) => f.scope === 'personal'));
    assert.equal(listPersonal.payload.flows.length, 4);

    const getProjectDenied = handleFlowGetRequest({
      dataDir,
      vaultId,
      flowId: 'flow_overseer_handover',
      visibleScopes: new Set(['personal']),
    });
    assert.equal(getProjectDenied.ok, false);
    assert.equal(getProjectDenied.code, 'unknown_flow');
  });

  it('getFlow step ids match flow.steps order and step_count equals steps.length', () => {
    const got = hubGet({ dataDir, vaultId, flowId: 'flow_overseer_handover' });
    assert.equal(got.ok, true);
    const list = hubList({ dataDir, vaultId });
    assert.equal(list.ok, true);
    const summary = list.payload.flows.find((f) => f.flow_id === 'flow_overseer_handover');
    assert.ok(summary);
    assert.equal(summary.step_count, got.payload.steps.length);
    assert.deepEqual(
      got.payload.flow.steps,
      got.payload.steps.map((s) => s.step_id),
    );
  });

  it('seeding is idempotent across repeated listFlows calls', () => {
    const first = hubList({ dataDir, vaultId });
    const second = hubList({ dataDir, vaultId });
    assert.deepEqual(first.payload.flows, second.payload.flows);
    const ids = second.payload.flows.map((f) => `${f.flow_id}@${f.version}`);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('Flow routes — hub wiring contract', () => {
  it('registers GET /api/v1/flows list and get with auth middleware', () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /app\.use\('\/api\/v1\/flows', jwtAuth, apiLimiter, requireVaultAccess\)/);
    assert.match(src, /app\.get\('\/api\/v1\/flows', requireRole\('viewer'/);
    assert.match(src, /app\.get\('\/api\/v1\/flows\/:id', requireRole\('viewer'/);
    assert.match(src, /handleFlowListRequest/);
    assert.match(src, /handleFlowGetRequest/);
  });
});
