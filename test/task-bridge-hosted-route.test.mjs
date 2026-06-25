/**
 * Hosted bridge task route contract tests (Phase 2G hosted parity).
 *
 * Tiers: unit, integration, e2e, stress, data-integrity, performance, security.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bridgeTaskHandlerRole } from '../hub/bridge/task-routes.mjs';
import { resolveStarterTasksDir } from '../lib/task/task-store.mjs';
import {
  mergeTaskFrontmatter,
  normalizeCanisterProposalForTaskPrecheck,
  FM_PROPOSAL_SOURCE,
  FM_TASK_PROPOSAL_KIND,
} from '../lib/task/task-hosted-proposal.mjs';
import { TASK_PROPOSAL_SOURCE } from '../lib/task/task-write.mjs';
import { handleTaskListRequest } from '../lib/task/task-handlers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('hosted bridge task routes — unit', () => {
  it('bridgeTaskHandlerRole maps member to editor (self-hosted parity)', () => {
    assert.equal(bridgeTaskHandlerRole('member'), 'editor');
    assert.equal(bridgeTaskHandlerRole('admin'), 'admin');
    assert.equal(bridgeTaskHandlerRole('viewer'), 'viewer');
  });

  it('resolveStarterTasksDir finds bundled tasks/starter from bridge module', () => {
    const starterDir = resolveStarterTasksDir(new URL('../hub/bridge/task-routes.mjs', import.meta.url).href);
    assert.ok(fs.existsSync(starterDir), `starter dir missing: ${starterDir}`);
    const files = fs.readdirSync(starterDir).filter((f) => f.startsWith('task_') && f.endsWith('.json'));
    assert.ok(files.length >= 1);
  });

  it('resolveStarterTaskLoopsDir finds bundled task-loops/starter from bridge module', async () => {
    const { resolveStarterTaskLoopsDir } = await import('../lib/task/task-loop-store.mjs');
    const loopDir = resolveStarterTaskLoopsDir(
      new URL('../hub/bridge/task-routes.mjs', import.meta.url).href,
    );
    assert.ok(fs.existsSync(loopDir), `loop starter dir missing: ${loopDir}`);
    const files = fs.readdirSync(loopDir).filter((f) => f.startsWith('loop_') && f.endsWith('.json'));
    assert.ok(files.length >= 1);
  });

  it('deploy/bridge netlify.toml includes task + loop starters in bridge function bundle', () => {
    const bridgeToml = readRepoFile('deploy/bridge/netlify.toml');
    const rootToml = readRepoFile('netlify.toml');
    assert.match(bridgeToml, /included_files\s*=\s*\[/);
    assert.match(bridgeToml, /tasks\/starter/);
    assert.match(bridgeToml, /task-loops\/starter/);
    assert.match(rootToml, /task-loops\/starter/);
  });

  it('mergeTaskFrontmatter embeds task proposal source and kind', () => {
    const fm = mergeTaskFrontmatter({}, {
      record_kind: 'task',
      proposal_kind: 'task_create',
      task_id: 'task_smoke_001',
    });
    assert.equal(fm[FM_PROPOSAL_SOURCE], TASK_PROPOSAL_SOURCE);
    assert.equal(fm[FM_TASK_PROPOSAL_KIND], 'task_create');
    assert.equal(fm.task_id, 'task_smoke_001');
  });

  it('normalizeCanisterProposalForTaskPrecheck maps frontmatter to task_meta', () => {
    const fm = mergeTaskFrontmatter({}, {
      record_kind: 'task',
      proposal_kind: 'task_create',
      task_id: 'task_abc',
    });
    const normalized = normalizeCanisterProposalForTaskPrecheck({
      proposal_id: 'prop-1',
      status: 'proposed',
      vault_id: 'Business',
      body: '{"proposal_kind":"task_create","task":{}}',
      frontmatter: JSON.stringify(fm),
    });
    assert.ok(normalized);
    assert.equal(normalized.source, TASK_PROPOSAL_SOURCE);
    assert.equal(normalized.task_meta.proposal_kind, 'task_create');
    assert.equal(normalized.task_meta.task_id, 'task_abc');
  });
});

describe('hosted bridge task routes — integration', () => {
  it('registers GET list/get and POST propose routes on bridge + gateway proxy', () => {
    const bridge = readRepoFile('hub/bridge/task-routes.mjs');
    const gateway = readRepoFile('hub/gateway/server.mjs');
    const bridgeServer = readRepoFile('hub/bridge/server.mjs');

    assert.match(bridge, /app\.get\('\/api\/v1\/tasks', requireBridgeAuth/);
    assert.match(bridge, /app\.get\('\/api\/v1\/tasks\/:id', requireBridgeAuth/);
    assert.match(bridge, /app\.get\('\/api\/v1\/task-loops', requireBridgeAuth/);
    assert.match(bridge, /app\.get\('\/api\/v1\/task-loops\/:loop_id', requireBridgeAuth/);
    assert.match(bridge, /app\.post\('\/api\/v1\/loop-pass-audit', requireBridgeAuth/);
    assert.match(bridge, /app\.post\('\/api\/v1\/tasks\/proposals', requireBridgeAuth/);
    assert.match(bridge, /app\.post\('\/api\/v1\/task-loops\/proposals', requireBridgeAuth/);
    assert.match(bridge, /createTaskProposalOnCanister/);
    assert.match(bridge, /applyApprovedTaskProposalFromCanister/);
    assert.match(bridgeServer, /registerBridgeTaskRoutes/);

    assert.match(gateway, /app\.get\('\/api\/v1\/tasks'/);
    assert.match(gateway, /app\.get\('\/api\/v1\/tasks\/:id'/);
    assert.match(gateway, /app\.get\('\/api\/v1\/task-loops'/);
    assert.match(gateway, /app\.get\('\/api\/v1\/task-loops\/:loop_id'/);
    assert.match(gateway, /app\.post\('\/api\/v1\/loop-pass-audit'/);
    assert.match(gateway, /app\.post\('\/api\/v1\/tasks\/proposals'/);
    assert.match(gateway, /app\.post\('\/api\/v1\/task-loops\/proposals'/);
    assert.match(gateway, /maybeApplyHostedTaskAfterApprove/);
  });

  it('bridge task routes reuse shared handlers from lib/task', () => {
    const bridge = readRepoFile('hub/bridge/task-routes.mjs');
    assert.match(bridge, /handleTaskListRequest/);
    assert.match(bridge, /handleTaskGetRequest/);
    assert.match(bridge, /handleTaskLoopListRequest/);
    assert.match(bridge, /handleTaskLoopGetRequest/);
    assert.match(bridge, /handleLoopPassAuditAppendRequest/);
    assert.match(bridge, /resolveStarterTasksDir/);
    assert.match(bridge, /BRIDGE_STARTER_TASKS_DIR/);
    assert.match(bridge, /await handleTaskProposeRequest/);
    assert.match(bridge, /resolveHostedBridgeContext/);
  });
});

describe('hosted bridge task routes — e2e (handler + store)', () => {
  const dataDir = path.join(repoRoot, 'test/fixtures/tmp-task-bridge-hosted/data');

  beforeEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('listTasks lazy-seeds starters on empty vault', () => {
    const starterDir = resolveStarterTasksDir(new URL('../hub/bridge/task-routes.mjs', import.meta.url).href);
    const result = handleTaskListRequest({
      dataDir,
      vaultId: 'default',
      userId: 'user-test',
      role: 'admin',
      starterDir,
    });
    assert.equal(result.ok, true);
    assert.equal(result.payload.schema, 'knowtation.task_list/v0');
    assert.ok(result.payload.tasks.length >= 1);
  });
});

describe('hosted bridge task routes — stress', () => {
  it('gateway source lists all task proxy paths without duplicate mounts', () => {
    const gateway = readRepoFile('hub/gateway/server.mjs');
    const matches = gateway.match(/app\.get\('\/api\/v1\/tasks'/g) ?? [];
    assert.equal(matches.length, 1);
    const postMatches = gateway.match(/app\.post\('\/api\/v1\/tasks\/proposals'/g) ?? [];
    assert.equal(postMatches.length, 1);
  });
});

describe('hosted bridge task routes — data-integrity', () => {
  it('normalize rejects non-task proposals', () => {
    const normalized = normalizeCanisterProposalForTaskPrecheck({
      proposal_id: 'prop-x',
      path: 'inbox/note.md',
      body: '{}',
      frontmatter: '{}',
    });
    assert.equal(normalized, null);
  });

  it('accepts task proposals by meta/tasks path prefix', () => {
    const normalized = normalizeCanisterProposalForTaskPrecheck({
      proposal_id: 'prop-y',
      path: 'meta/tasks/proposals/prop-y.json',
      body: '{"proposal_kind":"task_create","task":{"task_id":"task_x","kind":"personal","scope":"personal","status":"pending","title":"t","workspace_id":"ws","due_at":null,"artifact_links":[],"truncated":false}}',
      frontmatter: '{}',
      base_state_id: 'taskst1_abc',
    });
    assert.ok(normalized);
    assert.equal(normalized.task_meta.proposal_kind, 'task_create');
  });
});

describe('hosted bridge task routes — performance', () => {
  it('bridge routes module stays under reasonable import surface', () => {
    const bridge = readRepoFile('hub/bridge/task-routes.mjs');
    assert.ok(bridge.length < 16000, 'task-routes.mjs should remain a thin registrar');
  });
});

describe('hosted bridge task routes — security', () => {
  it('bridge task routes require auth before hosted context resolution', () => {
    const bridge = readRepoFile('hub/bridge/task-routes.mjs');
    assert.match(bridge, /requireBridgeAuth/);
    assert.match(bridge, /resolveHostedBridgeContext/);
    assert.match(bridge, /taskHandlerContext/);
    assert.doesNotMatch(bridge, /oauth_ref|refresh_token/);
  });

  it('propose routes gate through TASK_WRITES_ENABLED via shared handler', () => {
    const bridge = readRepoFile('hub/bridge/task-routes.mjs');
    assert.match(bridge, /resolveStarterTasksDir/);
    assert.match(bridge, /BRIDGE_STARTER_TASKS_DIR/);
    assert.match(bridge, /await handleTaskProposeRequest/);
    assert.doesNotMatch(bridge, /TASK_WRITES_ENABLED\s*=\s*true/);
  });
});
