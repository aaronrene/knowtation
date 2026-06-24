/**
 * Tier 1 — UNIT: Task store helpers, validation, and projections.
 *
 * @see lib/task/task-store.mjs
 * @see docs/TASK-STORE-CONTRACT-2G.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TASK_ID_RE,
  UID_HASH_REF_RE,
  SAFE_ARTIFACT_REF_RE,
  validateTaskRecord,
  taskSummaryForClient,
  taskForClient,
  seedStarterTasks,
  MAX_ARTIFACT_LINKS,
} from '../lib/task/task-store.mjs';
import { loadFlowStore, getVaultFlowStore, saveFlowStore } from '../lib/flow/flow-store.mjs';
import { getRepoRoot } from '../lib/repo-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-store-unit');
const starterDir = path.join(getRepoRoot(), 'tasks/starter');

const VALID_TASK = JSON.parse(
  fs.readFileSync(path.join(starterDir, 'task_2g_handover_001.json'), 'utf8'),
);

describe('Task store — id regexes', () => {
  it('TASK_ID_RE accepts canonical ids and rejects malformed', () => {
    assert.ok(TASK_ID_RE.test('task_2g_handover_001'));
    assert.ok(TASK_ID_RE.test('task_a'));
    assert.ok(!TASK_ID_RE.test('task'));
    assert.ok(!TASK_ID_RE.test('not_task_x'));
    assert.ok(!TASK_ID_RE.test('task_UPPER'));
  });

  it('UID_HASH_REF_RE and SAFE_ARTIFACT_REF_RE enforce hygiene', () => {
    assert.ok(UID_HASH_REF_RE.test(`uid_hash:${'a'.repeat(64)}`));
    assert.ok(!UID_HASH_REF_RE.test('uid_hash:short'));
    assert.ok(SAFE_ARTIFACT_REF_RE.test('note:handover-summary'));
    assert.ok(!SAFE_ARTIFACT_REF_RE.test('note with spaces'));
  });
});

describe('Task store — client projections', () => {
  it('taskSummaryForClient drops assignee and artifact_links', () => {
    const validated = validateTaskRecord(VALID_TASK);
    assert.equal(validated.ok, true);
    const summary = taskSummaryForClient(validated.task);
    assert.equal(summary.task_id, 'task_2g_handover_001');
    assert.equal('assignee_ref' in summary, false);
    assert.equal('artifact_links' in summary, false);
    assert.equal('created' in summary, false);
  });

  it('taskForClient caps artifact_links and sets truncated', () => {
    const links = Array.from({ length: MAX_ARTIFACT_LINKS + 5 }, (_, i) => ({
      kind: 'note',
      ref: `note:ref_${i}`,
    }));
    const validated = validateTaskRecord({ ...VALID_TASK, artifact_links: links });
    assert.equal(validated.ok, true);
    const client = taskForClient(validated.task);
    assert.equal(client.artifact_links.length, MAX_ARTIFACT_LINKS);
    assert.equal(client.truncated, true);
  });
});

describe('Task store — seeding and vault compat', () => {
  const dataDir = path.join(tmpRoot, 'seed');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('seedStarterTasks validates good bundle from tasks/starter', () => {
    const result = seedStarterTasks(dataDir, vaultId, { starterDir });
    assert.ok(result.seeded >= 1);
    const vault = getVaultFlowStore(dataDir, vaultId);
    assert.ok(vault.tasks.some((t) => t.task_id === 'task_2g_handover_001'));
  });

  it('rejects schema-invalid bundle without partial write', () => {
    const badDir = path.join(tmpRoot, 'bad-starter');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'task_bad.json'), JSON.stringify({ schema: 'nope' }), 'utf8');
    fs.writeFileSync(
      path.join(badDir, 'task_good_copy.json'),
      JSON.stringify({ ...VALID_TASK, task_id: 'task_good_copy' }),
      'utf8',
    );

    seedStarterTasks(dataDir, vaultId, { starterDir: badDir });
    const vault = getVaultFlowStore(dataDir, vaultId);
    assert.equal(vault.tasks.some((t) => t.task_id === 'task_good_copy'), true);
    assert.equal(vault.tasks.some((t) => t.task_id === 'task_bad'), false);
  });

  it('vault load defaults tasks: [] when key absent (backward compat)', () => {
    saveFlowStore(dataDir, {
      vaults: {
        legacy: {
          flows: [],
          steps: [],
          runs: [],
          candidates: [],
          projections: [],
        },
      },
    });
    const vault = getVaultFlowStore(dataDir, 'legacy');
    assert.deepEqual(vault.tasks, []);
  });
});

describe('Task store — validateTaskRecord', () => {
  it('accepts canonical starter and rejects pointer body fields', () => {
    const ok = validateTaskRecord(VALID_TASK);
    assert.equal(ok.ok, true);

    const bad = validateTaskRecord({
      ...VALID_TASK,
      artifact_links: [{ kind: 'note', ref: 'note:x', body: 'secret' }],
    });
    assert.equal(bad.ok, false);
  });
});
