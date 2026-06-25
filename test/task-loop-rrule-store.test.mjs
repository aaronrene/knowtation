/**
 * Tier 2 — INTEGRATION: Store read with rrule recurrence + trigger_bindings on school-trip.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { getTaskLoop, listTaskLoops } from '../lib/task/task-loop-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-task-loop-rrule-store');
const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');
const instancesDir = path.join(getRepoRoot(), 'task-loops/starter/instances');
const vaultId = 'vault-loop-rrule-store';

describe('Task loop RRULE — store integration', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('listTaskLoops seeds loop_weekly_checkin with rrule recurrence', () => {
    const dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const result = listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal', 'project', 'org']),
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    assert.equal(result.loops.length, 6);
    assert.ok(result.loops.some((row) => row.loop_id === 'loop_weekly_checkin'));
  });

  it('getTaskLoop returns rrule recurrence for loop_weekly_checkin', () => {
    const dataDir = path.join(tmpRoot, 'data-get');
    fs.mkdirSync(dataDir, { recursive: true });

    listTaskLoops(dataDir, vaultId, {
      visibleScopes: new Set(['personal', 'project', 'org']),
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
      starterDir: loopStarterDir,
      graphsDir: graphStarterDir,
      instancesDir,
    });

    const row = getTaskLoop(dataDir, vaultId, 'loop_weekly_checkin', {
      visibleScopes: new Set(['personal', 'project', 'org']),
    });
    assert.ok(row);
    if (!row) return;
    assert.equal(row.recurrence.kind, 'rrule');
    assert.equal(row.recurrence.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  });

  it('getTaskLoop returns trigger_bindings on loop_school_trip', () => {
    const dataDir = path.join(tmpRoot, 'data-bindings');
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
      visibleScopes: new Set(['personal', 'project', 'org']),
    });
    assert.ok(row);
    if (!row) return;
    assert.ok(Array.isArray(row.trigger_bindings));
    assert.equal(row.trigger_bindings.length, 1);
    assert.equal(row.trigger_bindings[0].signal_kind, 'note_edit');
  });
});
