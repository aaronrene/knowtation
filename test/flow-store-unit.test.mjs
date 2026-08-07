/**
 * Tier 1 — UNIT: Flow store helpers, validation, and projections.
 *
 * @see lib/flow/flow-store.mjs
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFlowStepId,
  loadFlowStore,
  saveFlowStore,
  getFlowStorePath,
  seedStarterFlows,
  validateFlowBundle,
  flowSummaryForClient,
  flowDefinitionForClient,
  listFlows,
  getFlow,
  resolveStarterFlowsDir,
  FLOW_ID_RE,
  FLOW_STEP_ID_RE,
  FLOW_RUN_ID_RE,
  SEMVER_RE,
} from '../lib/flow/flow-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-store-unit');
const starterDir = path.join(getRepoRoot(), 'flows/starter');
const maliciousBundle = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'flow', 'malicious-step-bundle.json'), 'utf8'),
);

describe('Flow store — persistence', () => {
  const dataDir = path.join(tmpRoot, 'persist');

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loadFlowStore returns empty vaults for missing and malformed files', () => {
    assert.deepEqual(loadFlowStore(dataDir), { vaults: {} });
    fs.writeFileSync(getFlowStorePath(dataDir), '{not json', 'utf8');
    assert.deepEqual(loadFlowStore(dataDir), { vaults: {} });
    fs.writeFileSync(getFlowStorePath(dataDir), '{"nope":1}', 'utf8');
    assert.deepEqual(loadFlowStore(dataDir), { vaults: {} });
  });

  it('saveFlowStore writes atomically and round-trips', () => {
    const store = {
      vaults: {
        default: {
          flows: [{ flow_id: 'flow_x', version: '1.0.0' }],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    };
    saveFlowStore(dataDir, store);
    const loaded = loadFlowStore(dataDir);
    assert.equal(loaded.vaults.default.flows[0].flow_id, 'flow_x');
    const files = fs.readdirSync(dataDir);
    assert.ok(files.some((f) => f.startsWith('hub_flow_store.json')));
    assert.ok(!files.some((f) => f.endsWith('.tmp')));
  });
});

describe('Flow store — id and semver helpers', () => {
  it('resolveStarterFlowsDir finds bundled flows/starter from bridge module URL', () => {
    const dir = resolveStarterFlowsDir(
      new URL('../hub/bridge/flow-run-routes.mjs', import.meta.url).href,
    );
    assert.ok(fs.existsSync(dir), dir);
    assert.ok(fs.existsSync(path.join(dir, 'flow_session_to_flow.json')));
  });

  it('regexes accept canonical ids and reject malformed', () => {
    assert.ok(FLOW_ID_RE.test('flow_weekly_review'));
    assert.ok(!FLOW_ID_RE.test('weekly_review'));
    assert.ok(FLOW_STEP_ID_RE.test('flow_weekly_review#1'));
    assert.ok(!FLOW_STEP_ID_RE.test('flow_weekly_review#0'));
    assert.ok(FLOW_RUN_ID_RE.test('run_2026w25'));
    assert.ok(!FLOW_RUN_ID_RE.test('run_'));
    assert.ok(SEMVER_RE.test('1.4.0'));
    assert.ok(!SEMVER_RE.test('1.4'));
  });

  it('buildFlowStepId composes flow_id#ordinal', () => {
    assert.equal(buildFlowStepId('flow_weekly_review', 3), 'flow_weekly_review#3');
  });
});

describe('Flow store — validation and seeding', () => {
  const dataDir = path.join(tmpRoot, 'seed');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('validateFlowBundle accepts a starter bundle shape', () => {
    const bundle = JSON.parse(
      fs.readFileSync(path.join(starterDir, 'flow_capture_to_note.json'), 'utf8'),
    );
    const result = validateFlowBundle(bundle);
    assert.equal(result.ok, true);
  });

  it('validateFlowBundle rejects anatomy-incomplete steps', () => {
    const bad = {
      flow: maliciousBundle.flow,
      steps: [{ ...maliciousBundle.steps[0], trigger: '' }],
    };
    const result = validateFlowBundle(bad);
    assert.equal(result.ok, false);
  });

  it('seedStarterFlows rejects invalid bundles without partial write', () => {
    const badStarter = path.join(tmpRoot, 'bad-starter');
    fs.mkdirSync(badStarter, { recursive: true });
    fs.writeFileSync(
      path.join(badStarter, 'flow_bad.json'),
      JSON.stringify({ flow: { flow_id: 'flow_bad' }, steps: [] }),
      'utf8',
    );
    const { seeded } = seedStarterFlows(dataDir, vaultId, { starterDir: badStarter });
    assert.equal(seeded, 0);
    assert.deepEqual(loadFlowStore(dataDir), { vaults: {} });
  });

  it('seedStarterFlows seeds canonical starters idempotently', () => {
    const first = seedStarterFlows(dataDir, vaultId, { starterDir });
    assert.ok(first.seeded >= 6);
    const second = seedStarterFlows(dataDir, vaultId, { starterDir });
    assert.equal(second.seeded, 0);
    assert.ok(second.skipped >= 6);
  });

  it('getFlow seeds missing starters when vault already has authored flows', () => {
    saveFlowStore(dataDir, {
      vaults: {
        [vaultId]: {
          flows: [
            {
              schema: 'knowtation.flow/v0',
              flow_id: 'flow_custom_authored',
              title: 'Custom',
              version: '0.0.1',
              scope: 'personal',
              summary: 'pre-existing',
              tags: [],
              steps: [],
              inputs: [],
              updated: '2026-01-01T00:00:00Z',
              truncated: false,
            },
          ],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    });
    const got = getFlow(dataDir, vaultId, 'flow_session_to_flow', {
      filterScopes: new Set(['personal']),
      version: '0.1.0',
      starterDir,
    });
    assert.ok(got);
    assert.equal(got.flow.flow_id, 'flow_session_to_flow');
    assert.equal(got.flow.version, '0.1.0');
  });
});

describe('Flow store — read ops and projections', () => {
  const dataDir = path.join(tmpRoot, 'read');
  const vaultId = 'default';
  const visible = new Set(['personal', 'project']);

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    seedStarterFlows(dataDir, vaultId, { starterDir });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('flowSummaryForClient drops step bodies and keeps summary fields', () => {
    const got = getFlow(dataDir, vaultId, 'flow_capture_to_note', { filterScopes: visible });
    assert.ok(got);
    const summary = flowSummaryForClient(got.flow, got.steps.length);
    assert.equal(summary.schema, 'knowtation.flow/v0');
    assert.equal(summary.step_count, got.steps.length);
    assert.ok(!('inputs' in summary));
    assert.ok(!('vault_mirror_path' in summary));
    assert.ok(!('steps' in summary));
  });

  it('flowDefinitionForClient emits spec fields only', () => {
    const got = getFlow(dataDir, vaultId, 'flow_capture_to_note', { filterScopes: visible });
    assert.ok(got);
    const def = flowDefinitionForClient(got.flow, got.steps);
    assert.equal(def.flow.schema, 'knowtation.flow/v0');
    assert.equal(def.steps[0].schema, 'knowtation.flow_step/v0');
    assert.ok(def.steps[0].verification);
  });

  it('listFlows stamps flow_list schema discriminator', () => {
    const list = listFlows(dataDir, vaultId, {
      filterScopes: visible,
      effectiveScope: 'project',
    });
    assert.equal(list.schema, 'knowtation.flow_list/v0');
    assert.ok(list.flows.length >= 6);
  });

  it('getFlow orders steps by ascending ordinal', () => {
    const got = getFlow(dataDir, vaultId, 'flow_overseer_handover', { filterScopes: visible });
    assert.ok(got);
    assert.equal(got.schema, 'knowtation.flow_get/v0');
    const ordinals = got.steps.map((s) => s.ordinal);
    assert.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b));
    assert.equal(got.steps.length, 6);
  });
});
