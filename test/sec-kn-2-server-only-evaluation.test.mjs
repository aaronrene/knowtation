/**
 * SEC-KN-2 — seven-tier coverage for server-only evaluation fields on proposal create.
 *
 * Frozen requirement: Pass 2 P2
 * (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`) —
 * client-supplied evaluation_status / evaluated_by / evaluated_at must be stripped
 * from all create bodies; only server-side evaluation may set them.
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  augmentProposalCreateRequestBody,
  stripClientEvaluationFields,
  CLIENT_EVALUATION_CREATE_FIELDS,
} from '../lib/hub-proposal-create-augment.mjs';
import {
  applyPersonalSelfApplyEvaluationE1,
  SCOOLING_REVIEW_TRAY_INTENT,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import { augmentProposalCreateForHosted } from '../hub/gateway/proposal-create-hosted-body.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AUGMENT_SRC = path.join(ROOT, 'lib/hub-proposal-create-augment.mjs');
const E1_SRC = path.join(ROOT, 'lib/hub-proposal-personal-self-apply.mjs');
const MAIN_MO = path.join(ROOT, 'hub/icp/src/hub/main.mo');

/**
 * Pre-fix augment behavior (Pass 2 P2) — only fills pending when empty.
 * Security tier asserts current code diverges from this on forged `passed`.
 *
 * @param {Record<string, unknown>} body
 * @param {{ evaluationRequired?: boolean }} [opts]
 * @returns {Record<string, unknown>}
 */
function augmentProposalCreateFailOpenLegacy(body, opts = {}) {
  if (!body || typeof body !== 'object') return body;
  let next = { ...body };
  const needPending = opts.evaluationRequired === true;
  if (needPending) {
    const es = next.evaluation_status;
    if (es == null || String(es).trim() === '') next.evaluation_status = 'pending';
  }
  return next;
}

function matchingFingerprint(overrides = {}) {
  return {
    path: 'reviewed/review-sec-kn-2.md',
    body: '# Note\n',
    intent: SCOOLING_REVIEW_TRAY_INTENT,
    external_ref: 'scooling.review:sec-kn-2',
    labels: [],
    ...overrides,
  };
}

function mkDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kt-sec-kn-2-'));
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-KN-2 unit — strip client evaluation fields', () => {
  test('stripClientEvaluationFields removes all three create fields', () => {
    const stripped = stripClientEvaluationFields({
      path: 'inbox/a.md',
      evaluation_status: 'passed',
      evaluated_by: 'attacker',
      evaluated_at: '2099-01-01T00:00:00.000Z',
      body: 'x',
    });
    assert.equal(stripped.path, 'inbox/a.md');
    assert.equal(stripped.body, 'x');
    for (const key of CLIENT_EVALUATION_CREATE_FIELDS) {
      assert.equal(Object.hasOwn(stripped, key), false, `must strip ${key}`);
    }
  });

  test('strip does not mutate the input object', () => {
    const input = { evaluation_status: 'passed', path: 'n.md' };
    const out = stripClientEvaluationFields(input);
    assert.equal(input.evaluation_status, 'passed');
    assert.notEqual(out, input);
    assert.equal(Object.hasOwn(out, 'evaluation_status'), false);
  });

  test('non-fingerprint forge + gate on → pending, no attacker evaluated_by', () => {
    const dir = mkDataDir();
    try {
      const body = augmentProposalCreateRequestBody(
        {
          path: 'inbox/forged.md',
          body: 'x',
          intent: 'other',
          external_ref: 'scooling.review:x',
          evaluation_status: 'passed',
          evaluated_by: 'attacker',
          evaluated_at: '2099-01-01T00:00:00.000Z',
          labels: [],
        },
        dir,
        { evaluationRequired: true, evaluatedBy: 'server:actor' },
      );
      assert.equal(body.evaluation_status, 'pending');
      assert.equal(Object.hasOwn(body, 'evaluated_by'), false);
      assert.equal(Object.hasOwn(body, 'evaluated_at'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('E1 ignores body.evaluated_by; only audit sets auditor', () => {
    const out = applyPersonalSelfApplyEvaluationE1(
      {
        ...matchingFingerprint(),
        evaluation_status: 'pending',
        evaluated_by: 'forged-client',
      },
      { evaluatedBy: 'server:learner', evaluatedAt: '2026-07-26T12:00:00.000Z' },
    );
    assert.equal(out.evaluation_status, 'passed');
    assert.equal(out.evaluated_by, 'server:learner');
    assert.equal(out.evaluated_at, '2026-07-26T12:00:00.000Z');
  });

  test('E1 without audit does not keep client evaluated_by', () => {
    const out = applyPersonalSelfApplyEvaluationE1({
      ...matchingFingerprint(),
      evaluation_status: 'pending',
      evaluated_by: 'forged-client',
    });
    assert.equal(out.evaluation_status, 'passed');
    assert.equal(Object.hasOwn(out, 'evaluated_by'), false);
    assert.ok(out.evaluated_at);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (gateway wrapper + Motoko approve gate contract)
// ---------------------------------------------------------------------------
describe('SEC-KN-2 integration — hosted create path + Motoko gate', () => {
  test('augmentProposalCreateForHosted strips forge on POST /api/v1/proposals', () => {
    const dir = mkDataDir();
    try {
      const body = augmentProposalCreateForHosted(
        'POST',
        '/api/v1/proposals',
        {
          path: 'inbox/x.md',
          body: 'x',
          intent: 'agent.suggest',
          evaluation_status: 'passed',
          evaluated_by: 'attacker',
          evaluated_at: '2099-01-01T00:00:00.000Z',
          labels: [],
        },
        dir,
        { evaluationRequired: true },
      );
      assert.equal(body.evaluation_status, 'pending');
      assert.equal(Object.hasOwn(body, 'evaluated_by'), false);
      assert.equal(Object.hasOwn(body, 'evaluated_at'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-POST / wrong path leave body untouched (no silent strip elsewhere)', () => {
    const dir = mkDataDir();
    try {
      const raw = {
        path: 'inbox/x.md',
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
      };
      const get = augmentProposalCreateForHosted('GET', '/api/v1/proposals', raw, dir, {
        evaluationRequired: true,
      });
      assert.equal(get.evaluation_status, 'passed');
      const other = augmentProposalCreateForHosted('POST', '/api/v1/notes', raw, dir, {
        evaluationRequired: true,
      });
      assert.equal(other.evaluation_status, 'passed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Motoko evalStatusAllowsApprove still treats passed as approvable (server must not forge)', () => {
    const src = fs.readFileSync(MAIN_MO, 'utf8');
    assert.ok(src.includes('func evalStatusAllowsApprove'));
    assert.ok(src.includes('es == "passed"'));
    // Create path still reads evaluation_status from body — trusted only after gateway strip.
    assert.ok(src.includes('extractJsonString(bodyText, "evaluation_status")'));
  });

  test('fingerprint class still receives server E1 passed via hosted augment', () => {
    const dir = mkDataDir();
    try {
      const body = augmentProposalCreateForHosted(
        'POST',
        '/api/v1/proposals',
        {
          ...matchingFingerprint(),
          evaluation_status: 'failed',
          evaluated_by: 'attacker',
        },
        dir,
        { evaluationRequired: true, evaluatedBy: 'google:member1' },
      );
      assert.equal(body.evaluation_status, 'passed');
      assert.equal(body.evaluated_by, 'google:member1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (create-body matrix → approve eligibility inputs)
// ---------------------------------------------------------------------------
describe('SEC-KN-2 e2e — forge matrix through augment', () => {
  /** @returns {{ status: string, evaluation_status: string, evaluated_by?: string }} */
  function simulateCreate(clientBody, opts) {
    const dir = mkDataDir();
    try {
      const augmented = augmentProposalCreateRequestBody(clientBody, dir, opts);
      return {
        status: 'proposed',
        evaluation_status: String(augmented.evaluation_status ?? ''),
        ...(augmented.evaluated_by != null ? { evaluated_by: String(augmented.evaluated_by) } : {}),
        intent: String(augmented.intent ?? ''),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('non-class forged passed under gate → pending (approve would need real evaluation)', () => {
    const row = simulateCreate(
      {
        path: 'meta/tasks/proposals/t1.json',
        body: '{}',
        intent: 'task.create',
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
        labels: [],
      },
      { evaluationRequired: true, evaluatedBy: 'attacker' },
    );
    assert.equal(row.evaluation_status, 'pending');
    assert.equal(row.evaluated_by, undefined);
  });

  test('gate off: non-class forge still stripped (no silent passed)', () => {
    const row = simulateCreate(
      {
        path: 'inbox/x.md',
        body: 'x',
        intent: 'other',
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
        labels: [],
      },
      { evaluationRequired: false },
    );
    assert.notEqual(row.evaluation_status, 'passed');
    assert.equal(row.evaluated_by, undefined);
  });

  test('class path: client forge replaced by server actor', () => {
    const row = simulateCreate(
      {
        ...matchingFingerprint(),
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
      },
      { evaluationRequired: true, evaluatedBy: 'google:real-learner' },
    );
    assert.equal(row.evaluation_status, 'passed');
    assert.equal(row.evaluated_by, 'google:real-learner');
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-KN-2 stress — many forged create bodies', () => {
  test('5_000 forged non-class creates stay pending under gate', () => {
    const dir = mkDataDir();
    try {
      for (let i = 0; i < 5_000; i++) {
        const body = augmentProposalCreateRequestBody(
          {
            path: `inbox/f-${i}.md`,
            body: `x${i}`,
            intent: 'other',
            evaluation_status: i % 2 === 0 ? 'passed' : 'failed',
            evaluated_by: `attacker-${i}`,
            evaluated_at: '2099-01-01T00:00:00.000Z',
            labels: [],
          },
          dir,
          { evaluationRequired: true },
        );
        assert.equal(body.evaluation_status, 'pending');
        assert.equal(Object.hasOwn(body, 'evaluated_by'), false);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-KN-2 data-integrity — idempotent strip + no client audit bleed', () => {
  test('same forged inputs always yield same server evaluation_status', () => {
    const dir = mkDataDir();
    try {
      const input = {
        path: 'inbox/same.md',
        body: 'x',
        intent: 'other',
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
        labels: [],
      };
      const a = augmentProposalCreateRequestBody(input, dir, { evaluationRequired: true });
      const b = augmentProposalCreateRequestBody(input, dir, { evaluationRequired: true });
      assert.equal(a.evaluation_status, b.evaluation_status);
      assert.equal(a.evaluation_status, 'pending');
      assert.equal(Object.hasOwn(a, 'evaluated_by'), false);
      assert.equal(Object.hasOwn(b, 'evaluated_by'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('source files document strip-before-assign contract', () => {
    const augment = fs.readFileSync(AUGMENT_SRC, 'utf8');
    const e1 = fs.readFileSync(E1_SRC, 'utf8');
    assert.ok(augment.includes('stripClientEvaluationFields'));
    assert.ok(augment.includes('SEC-KN-2'));
    assert.ok(e1.includes('SEC-KN-2'));
    assert.ok(!e1.includes('typeof body.evaluated_by === \'string\''));
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-KN-2 performance — bounded augment time', () => {
  test('20k forged augments complete under 2s', () => {
    const dir = mkDataDir();
    try {
      const t0 = performance.now();
      for (let i = 0; i < 20_000; i++) {
        augmentProposalCreateRequestBody(
          {
            path: 'inbox/p.md',
            body: 'x',
            intent: 'other',
            evaluation_status: 'passed',
            evaluated_by: 'attacker',
            labels: [],
          },
          dir,
          { evaluationRequired: true },
        );
      }
      const ms = performance.now() - t0;
      assert.ok(ms < 2000, `expected <2000ms, got ${ms.toFixed(1)}ms`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (regression must FAIL against pre-fix client-forgeable behavior)
// ---------------------------------------------------------------------------
describe('SEC-KN-2 security — regression vs client-forgeable evaluation', () => {
  test('security regression: forged passed must not survive gate (legacy would keep it)', () => {
    const forged = {
      path: 'inbox/x.md',
      body: 'x',
      intent: 'task.create',
      evaluation_status: 'passed',
      evaluated_by: 'attacker',
      evaluated_at: '2099-01-01T00:00:00.000Z',
      labels: [],
    };
    const legacy = augmentProposalCreateFailOpenLegacy(forged, { evaluationRequired: true });
    assert.equal(
      legacy.evaluation_status,
      'passed',
      'sanity: legacy helper still models client-forgeable passed under gate',
    );
    assert.equal(legacy.evaluated_by, 'attacker');

    const dir = mkDataDir();
    try {
      const fixed = augmentProposalCreateRequestBody(forged, dir, {
        evaluationRequired: true,
        evaluatedBy: 'attacker',
      });
      assert.equal(fixed.evaluation_status, 'pending');
      assert.notEqual(
        fixed.evaluation_status,
        legacy.evaluation_status,
        'fixed behavior must diverge from pre-fix forge-preserving augment',
      );
      assert.equal(Object.hasOwn(fixed, 'evaluated_by'), false);
      assert.equal(Object.hasOwn(fixed, 'evaluated_at'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gate off: legacy keeps client passed; fixed strips it', () => {
    const forged = {
      path: 'inbox/x.md',
      body: 'x',
      intent: 'other',
      evaluation_status: 'passed',
      evaluated_by: 'attacker',
      labels: [],
    };
    const legacy = augmentProposalCreateFailOpenLegacy(forged, { evaluationRequired: false });
    assert.equal(legacy.evaluation_status, 'passed');

    const dir = mkDataDir();
    try {
      const fixed = augmentProposalCreateRequestBody(forged, dir, { evaluationRequired: false });
      assert.notEqual(fixed.evaluation_status, 'passed');
      assert.equal(Object.hasOwn(fixed, 'evaluated_by'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('server E1 is the only create path that may set passed for fingerprint class', () => {
    const dir = mkDataDir();
    try {
      const forgedNonClass = augmentProposalCreateRequestBody(
        {
          path: 'reviewed/looks-like.md',
          body: 'x',
          intent: 'other',
          external_ref: 'scooling.review:looks',
          evaluation_status: 'passed',
          evaluated_by: 'attacker',
          labels: [],
        },
        dir,
        { evaluationRequired: true, evaluatedBy: 'attacker' },
      );
      assert.equal(forgedNonClass.evaluation_status, 'pending');

      const classOk = augmentProposalCreateRequestBody(
        matchingFingerprint({ evaluation_status: 'passed', evaluated_by: 'attacker' }),
        dir,
        { evaluationRequired: true, evaluatedBy: 'google:learner' },
      );
      assert.equal(classOk.evaluation_status, 'passed');
      assert.equal(classOk.evaluated_by, 'google:learner');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
