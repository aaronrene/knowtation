/**
 * Loop pass audit mirror — unit + security tiers.
 *
 * @see lib/task/loop-pass-audit.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleLoopPassAuditAppendRequest,
  checkLoopPassAuditMirrorGate,
  validateLoopPassAuditRecord,
  LOOP_PASS_AUDIT_SCHEMA,
} from '../lib/task/loop-pass-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-loop-pass-audit');
const vaultId = 'vault-loop-audit';

function sampleBody(passId) {
  return {
    pass_id: passId,
    loop_id: 'loop_school_trip',
    instance_task_id: null,
    graph_id: 'graph_school_trip',
    outcome: 'scheduled',
    boundary_policy: 'observe_only',
    context_refs: [{ kind: 'loop', ref: 'loop_school_trip' }],
    scooling_pass_audit_ref: passId,
    occurred_at: '2026-06-25T12:00:00.000Z',
    scope: 'personal',
  };
}

describe('loop pass audit — unit', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    delete process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED;
  });

  it('gate defaults off', () => {
    const gate = checkLoopPassAuditMirrorGate(dataDir);
    assert.equal(gate.ok, false);
    assert.equal(gate.code, 'LOOP_PASS_AUDIT_MIRROR_DISABLED');
  });

  it('append succeeds when gate on and is idempotent on pass_id', () => {
    process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED = '1';
    const passId = 'pass_unit_idempotent';
    const first = handleLoopPassAuditAppendRequest({
      dataDir,
      vaultId,
      body: sampleBody(passId),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.idempotent, false);
    assert.equal(first.payload.schema, LOOP_PASS_AUDIT_SCHEMA);

    const second = handleLoopPassAuditAppendRequest({
      dataDir,
      vaultId,
      body: sampleBody(passId),
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.idempotent, true);
    assert.equal(second.payload.audit_id, first.payload.audit_id);
  });

  it('validate rejects note bodies in context refs shape', () => {
    const bad = validateLoopPassAuditRecord({
      schema: LOOP_PASS_AUDIT_SCHEMA,
      audit_id: 'lpau_bad',
      pass_id: 'pass_bad',
      loop_id: 'loop_school_trip',
      instance_task_id: null,
      graph_id: null,
      outcome: 'idle',
      boundary_policy: 'observe_only',
      context_refs: [{ kind: 'note', ref: 'note:../../etc/passwd' }],
      scooling_pass_audit_ref: 'pass_bad',
      occurred_at: '2026-06-25T12:00:00.000Z',
      vault_id: vaultId,
      scope: 'personal',
    });
    assert.equal(bad.ok, false);
  });
});

describe('loop pass audit — security', () => {
  let dataDir;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    dataDir = path.join(tmpRoot, 'data-sec');
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED = '1';
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED;
  });

  it('refuses append when gate off even if env unset mid-request path', () => {
    delete process.env.LOOP_PASS_AUDIT_MIRROR_ENABLED;
    const result = handleLoopPassAuditAppendRequest({
      dataDir,
      vaultId,
      body: sampleBody('pass_sec_gate'),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'LOOP_PASS_AUDIT_MIRROR_DISABLED');
  });

  it('rejects invalid pass_id without persistence', () => {
    const result = handleLoopPassAuditAppendRequest({
      dataDir,
      vaultId,
      body: { ...sampleBody('not_a_pass'), pass_id: 'forged' },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'BAD_REQUEST');
  });
});
