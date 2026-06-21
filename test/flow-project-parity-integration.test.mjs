/**
 * Tier 2 — INTEGRATION: CLI = MCP = Hub handler parity for flow project.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleFlowProjectRequest,
  stripFlowProjectGeneratedAt,
  serializeFlowPayload,
} from '../lib/flow/flow-handlers.mjs';
import { seedStarterFlows } from '../lib/flow/flow-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-project-parity');
const starterDir = path.join(getRepoRoot(), 'flows/starter');

function hubProject(input) {
  return handleFlowProjectRequest({
    ...input,
    role: 'admin',
    generatedAt: '2026-06-20T00:00:00Z',
  });
}

function cliProject(input) {
  return handleFlowProjectRequest({
    ...input,
    cliScopes: ['personal', 'project'],
    generatedAt: '2026-06-20T00:00:00Z',
  });
}

function mcpProject(input) {
  return handleFlowProjectRequest({
    ...input,
    cliScopes: ['personal', 'project'],
    generatedAt: '2026-06-20T00:00:00Z',
  });
}

describe('Flow project — triple-surface parity', () => {
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

  it('Hub, CLI, and MCP payloads are deep-equal excluding generated_at', () => {
    const base = {
      dataDir,
      vaultId,
      flowId: 'flow_overseer_handover',
      harness: 'cli_runbook',
    };
    const hub = hubProject(base);
    const cli = cliProject(base);
    const mcp = mcpProject(base);
    assert.equal(hub.ok, true);
    assert.equal(cli.ok, true);
    assert.equal(mcp.ok, true);
    assert.deepEqual(stripFlowProjectGeneratedAt(hub.payload), stripFlowProjectGeneratedAt(cli.payload));
    assert.deepEqual(stripFlowProjectGeneratedAt(cli.payload), stripFlowProjectGeneratedAt(mcp.payload));
    assert.equal(
      serializeFlowPayload(stripFlowProjectGeneratedAt(hub.payload)),
      serializeFlowPayload(stripFlowProjectGeneratedAt(mcp.payload)),
    );
  });

  it('pinned version resolves identically across surfaces', () => {
    const base = {
      dataDir,
      vaultId,
      flowId: 'flow_capture_to_note',
      harness: 'cursor_rule',
      version: '0.1.0',
    };
    const hub = hubProject(base);
    const cli = cliProject(base);
    assert.equal(hub.ok, true);
    assert.deepEqual(stripFlowProjectGeneratedAt(hub.payload), stripFlowProjectGeneratedAt(cli.payload));
    assert.equal(hub.payload.projection.flow_version, '0.1.0');
  });

  it('FLOW_HARNESS_UNSUPPORTED is identical for agent_bundle and cursor_skill', () => {
    for (const harness of ['agent_bundle', 'cursor_skill', 'mcp_prompt']) {
      const hub = hubProject({
        dataDir,
        vaultId,
        flowId: 'flow_overseer_handover',
        harness,
      });
      const cli = cliProject({
        dataDir,
        vaultId,
        flowId: 'flow_overseer_handover',
        harness,
      });
      assert.equal(hub.ok, false);
      assert.equal(cli.ok, false);
      assert.equal(hub.code, 'FLOW_HARNESS_UNSUPPORTED');
      assert.equal(cli.code, hub.code);
      assert.equal(hub.status, 400);
    }
  });

  it('scope filter applied identically — personal caller cannot project project flow', () => {
    const denied = handleFlowProjectRequest({
      dataDir,
      vaultId,
      flowId: 'flow_overseer_handover',
      harness: 'cli_runbook',
      visibleScopes: new Set(['personal']),
      generatedAt: '2026-06-20T00:00:00Z',
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'unknown_flow');
    assert.equal(denied.status, 404);
  });
});

describe('Flow project routes — hub wiring contract', () => {
  it('registers GET /api/v1/flows/:id/projection with auth middleware', () => {
    const src = fs.readFileSync(path.join(getRepoRoot(), 'hub/server.mjs'), 'utf8');
    assert.match(src, /\/api\/v1\/flows\/:id\/projection/);
    assert.match(src, /handleFlowProjectRequest/);
  });
});
