/**
 * Tier 1 — UNIT: Task loop store validation, regexes, projections.
 *
 * @see docs/TASK-LOOP-STORE-CONTRACT-2G-c.md §6
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRepoRoot } from '../lib/repo-root.mjs';
import {
  LOOP_ID_RE,
  OCCURRENCE_KEY_RE,
  GRAPH_ID_RE,
  validateRecurrence,
  validateTaskLoopRecord,
  validateOrchestratorGraphRecord,
  taskLoopSummaryForClient,
} from '../lib/task/task-loop-store.mjs';

const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
const graphStarterDir = path.join(getRepoRoot(), 'orchestrator-graphs/starter');

const VALID_LOOP = JSON.parse(
  fs.readFileSync(path.join(loopStarterDir, 'loop_school_trip.json'), 'utf8'),
);
const VALID_GRAPH = JSON.parse(
  fs.readFileSync(path.join(graphStarterDir, 'graph_school_trip.json'), 'utf8'),
);

describe('Task loop store — id regexes', () => {
  it('LOOP_ID_RE, OCCURRENCE_KEY_RE, GRAPH_ID_RE accept canonical ids', () => {
    assert.ok(LOOP_ID_RE.test('loop_school_trip'));
    assert.ok(OCCURRENCE_KEY_RE.test('2026-W25'));
    assert.ok(GRAPH_ID_RE.test('graph_school_trip'));
    assert.ok(!LOOP_ID_RE.test('loop'));
    assert.ok(!GRAPH_ID_RE.test('not_graph_x'));
  });
});

describe('Task loop store — recurrence validation', () => {
  it('accepts cron, interval, manual, on_wake v0 subset', () => {
    assert.equal(
      validateRecurrence({ kind: 'manual' }).ok,
      true,
    );
    assert.equal(
      validateRecurrence({ kind: 'on_wake', source_loop_ref: 'loop_school_trip' }).ok,
      true,
    );
    assert.equal(
      validateRecurrence({
        kind: 'cron',
        expression: '0 9 * * 1',
        anchor_tz: 'America/Los_Angeles',
      }).ok,
      true,
    );
    assert.equal(
      validateRecurrence({
        kind: 'interval',
        every: 2,
        unit: 'week',
        anchor_at: '2026-06-01T09:00:00Z',
      }).ok,
      true,
    );
  });

  it('rejects invalid recurrence shapes', () => {
    assert.equal(validateRecurrence({ kind: 'rrule' }).ok, false);
    assert.equal(validateRecurrence({ kind: 'on_wake' }).ok, false);
  });
});

describe('Task loop store — record validation', () => {
  it('validateTaskLoopRecord accepts school-trip starter bundle', () => {
    const result = validateTaskLoopRecord(VALID_LOOP);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.loop.loop_id, 'loop_school_trip');
      assert.equal(result.loop.boundary_policy, 'observe_only');
    }
  });

  it('validateOrchestratorGraphRecord accepts graph_school_trip', () => {
    const result = validateOrchestratorGraphRecord(VALID_GRAPH);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.graph.nodes.length, 5);
      assert.equal(result.graph.composition_tier, 'personal_safe');
    }
  });

  it('taskLoopSummaryForClient keeps summary fields only', () => {
    const validated = validateTaskLoopRecord(VALID_LOOP);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const summary = taskLoopSummaryForClient(validated.loop);
    assert.equal(summary.loop_id, 'loop_school_trip');
    assert.equal(summary.recurrence_kind, 'manual');
    assert.equal('memory_links' in summary, false);
  });
});
