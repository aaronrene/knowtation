/**
 * FLOW-WRITE-LIVE-KN-b — seven-tier coverage (§FWL.7 Knowtation matrix).
 * Frozen: ~/scooling/docs/FLOW-WRITE-LIVE-FREEZE.md (§FWL.4 / §FWL.7)
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  personalSelfApplyRefusalReason,
  isPersonalSelfApplyClass,
  matchesScoolingFlowFingerprint,
  isAdmittedSeamSelfApplyFingerprint,
  applyPersonalSelfApplyEvaluationE1,
  SCOOLING_FLOW_EXTERNAL_REF_RE,
  SCOOLING_FLOW_MIRROR_PATH_RE,
  ADMITTED_FLOW_PROPOSAL_KINDS,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  resolveOptionalScoolingExternalRef,
  readProposeExternalRefRaw,
} from '../lib/scooling-external-ref.mjs';
import {
  FLOW_PROPOSAL_SOURCE,
  handleFlowProposeRequest,
} from '../lib/flow/flow-authoring.mjs';
import { FLOW_CAPTURE_PROPOSAL_SOURCE } from '../lib/flow/flow-capture.mjs';
import { DELEGATION_PROPOSAL_SOURCE } from '../lib/agent/delegation.mjs';
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import { stripClientEvaluationFields } from '../lib/hub-proposal-create-augment.mjs';
import { makeFlowBundle } from './fixtures/flow/authoring-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-write-live-kn-b');

const ACTOR = 'google:learner-a';
const OTHER = 'google:learner-b';

/**
 * @param {Record<string, unknown>} [overrides]
 */
function flowProposal(overrides = {}) {
  const kind = overrides.kind || 'new';
  const flowId = overrides.flowId || 'flow_fwl_1';
  const scope = overrides.scope || 'personal';
  const mirror =
    overrides.path ||
    `meta/flows/${String(flowId).replace(/^flow_/, '').replace(/_/g, '-')}.md`;
  const bodyObj = overrides.bodyObj || {
    flow: {
      schema: 'knowtation.flow/v0',
      flow_id: flowId,
      title: 'FWL',
      version: '1.0.0',
      scope,
      summary: 'fwl',
      tags: [],
      steps: [],
      inputs: [],
      vault_mirror_path: mirror,
    },
    steps: [],
  };
  const hasMeta = Object.prototype.hasOwnProperty.call(overrides, 'flow_meta');
  const flowMeta = hasMeta
    ? overrides.flow_meta
    : { kind, base_version: null, base_state_id: 'flowst1_absent' };
  return {
    proposal_id: overrides.proposal_id || 'prop-flow-1',
    status: 'proposed',
    source: FLOW_PROPOSAL_SOURCE,
    path: mirror,
    external_ref: overrides.external_ref ?? 'scooling.flow:fixture-001',
    body: JSON.stringify(bodyObj),
    frontmatter: {
      type: 'flow',
      flow_id: flowId,
      flow_version: '1.0.0',
      scope,
      ...(overrides.frontmatter || {}),
    },
    ...(flowMeta !== undefined ? { flow_meta: flowMeta } : {}),
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([k]) =>
          ![
            'kind',
            'flowId',
            'scope',
            'bodyObj',
            'path',
            'external_ref',
            'flow_meta',
            'frontmatter',
            'proposal_id',
          ].includes(k),
      ),
    ),
  };
}

/**
 * @param {Record<string, unknown>} proposal
 * @param {Record<string, unknown>} [extra]
 */
function eligible(proposal, extra = {}) {
  return {
    proposal,
    hasVaultWrite: true,
    partitionOwned: true,
    role: 'member',
    humanActor: true,
    tokenType: null,
    actorKind: 'human',
    sessionBound: true,
    authorActorId: ACTOR,
    approverActorId: ACTOR,
    ...extra,
  };
}

describe('FLOW-WRITE-LIVE-KN-b unit — §FWL.4.1 Flow fingerprint', () => {
  it('admits new/edit/import + scooling.flow: + personal meta/flows', async () => {
    for (const kind of ADMITTED_FLOW_PROPOSAL_KINDS) {
      const p = flowProposal({ kind, external_ref: `scooling.flow:${kind}-ok` });
      assert.equal(matchesScoolingFlowFingerprint(p), true, kind);
      assert.equal(personalSelfApplyRefusalReason(eligible(p)), null, kind);
    }
    assert.equal(SCOOLING_FLOW_MIRROR_PATH_RE.test('meta/flows/capture-to-note.md'), true);
    assert.equal(SCOOLING_FLOW_EXTERNAL_REF_RE.test('scooling.flow:ok'), true);
  });

  it('refuses capture / delegation / wrong ref / empty author / project scope / missing kind', async () => {
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({ status: 'proposed', source: FLOW_CAPTURE_PROPOSAL_SOURCE }),
      ),
      'SELF_APPLY_NOT_ADMITTED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({ status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE }),
      ),
      'SELF_APPLY_DELEGATION_REFUSED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible(flowProposal({ external_ref: 'scooling.task:wrong' })),
      ),
      'SELF_APPLY_NOT_ADMITTED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(flowProposal(), { authorActorId: '' })),
      'SELF_APPLY_AUTHOR_UNVERIFIED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(flowProposal({ scope: 'project' }))),
      'SELF_APPLY_NOT_ADMITTED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(flowProposal({ scope: 'org' }))),
      'SELF_APPLY_NOT_ADMITTED',
    );
    // Missing flow_meta / empty kind — never default to new at admission.
    assert.equal(matchesScoolingFlowFingerprint(flowProposal({ flow_meta: undefined })), false);
    assert.equal(
      matchesScoolingFlowFingerprint(flowProposal({ flow_meta: { kind: '', base_version: null } })),
      false,
    );
    assert.equal(
      matchesScoolingFlowFingerprint(
        flowProposal({ flow_meta: { kind: 'draft', base_version: null } }),
      ),
      false,
    );
    assert.equal(
      matchesScoolingFlowFingerprint(
        flowProposal({ path: 'notes/flows/x.md', external_ref: 'scooling.flow:ok' }),
      ),
      false,
    );
  });

  it('external_ref helpers validate Flow regex; malformed refuse', async () => {
    const bad = resolveOptionalScoolingExternalRef('muse:ref', SCOOLING_FLOW_EXTERNAL_REF_RE);
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal(bad.code, 'EXTERNAL_REF_INVALID');
    const ok = resolveOptionalScoolingExternalRef('scooling.flow:a', SCOOLING_FLOW_EXTERNAL_REF_RE);
    assert.equal(ok.ok, true);
    assert.equal(ok.externalRef, 'scooling.flow:a');
    assert.equal(
      readProposeExternalRefRaw({ body: { external_ref: 'scooling.flow:b' } }),
      'scooling.flow:b',
    );
  });
});

describe('FLOW-WRITE-LIVE-KN-b integration — propose persist + approve class', () => {
  const dataDir = path.join(tmpRoot, 'integ');
  const visible = new Set(['personal', 'project', 'org']);
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_AUTHORING_WRITES = '1';
  });
  afterEach(() => {
    delete process.env.FLOW_AUTHORING_WRITES;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('persists scooling.flow: on new propose; session-bound class holds', async () => {
    const bundle = makeFlowBundle({ flowId: 'flow_fwl_persist' });
    const proposed = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      visibleScopes: visible,
      kind: 'new',
      flow: bundle.flow,
      steps: bundle.steps,
      intent: 'draft personal flow',
      externalRef: 'scooling.flow:persist-1',
      sessionBound: true,
      createProposal,
    });
    assert.equal(proposed.ok, true);
    const row = getProposal(dataDir, proposed.payload.proposal_id);
    assert.equal(row.external_ref, 'scooling.flow:persist-1');
    assert.equal(row.source, FLOW_PROPOSAL_SOURCE);
    assert.equal(row.flow_meta.kind, 'new');
    assert.match(row.path, /^meta\/flows\/.+\.md$/);
    assert.equal(personalSelfApplyRefusalReason(eligible(row, { role: 'editor' })), null);
  });

  it('absent external_ref proposes ok but not admitted; malformed → 400', async () => {
    const bundle = makeFlowBundle({ flowId: 'flow_fwl_noref' });
    const noRef = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      visibleScopes: visible,
      kind: 'new',
      flow: bundle.flow,
      steps: bundle.steps,
      intent: 'no ref',
      sessionBound: true,
      createProposal,
    });
    assert.equal(noRef.ok, true);
    const row = getProposal(dataDir, noRef.payload.proposal_id);
    assert.equal(personalSelfApplyRefusalReason(eligible(row)), 'SELF_APPLY_NOT_ADMITTED');

    const badBundle = makeFlowBundle({ flowId: 'flow_fwl_badref' });
    const badNew = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      visibleScopes: visible,
      kind: 'new',
      flow: badBundle.flow,
      steps: badBundle.steps,
      intent: 'bad ref',
      externalRef: 'not-a-scooling-flow-ref',
      createProposal,
    });
    assert.equal(badNew.ok, false);
    assert.equal(badNew.status, 400);
    assert.equal(badNew.code, 'EXTERNAL_REF_INVALID');
  });

  it('import kind persists scooling.flow:; lineage muse ref refused', async () => {
    const bundle = makeFlowBundle({ flowId: 'flow_fwl_import' });
    const imported = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      visibleScopes: visible,
      kind: 'import',
      bundle: { flow: bundle.flow, steps: bundle.steps },
      intent: 'import',
      externalRef: 'scooling.flow:import-1',
      sourceVaultHint: 'partner',
      sessionBound: true,
      createProposal,
    });
    assert.equal(imported.ok, true);
    const row = getProposal(dataDir, imported.payload.proposal_id);
    assert.equal(row.flow_meta.kind, 'import');
    assert.equal(row.external_ref, 'scooling.flow:import-1');
    assert.equal(isAdmittedSeamSelfApplyFingerprint(row, ACTOR), true);

    const lineageBundle = makeFlowBundle({ flowId: 'flow_fwl_import_lineage' });
    const lineageOnly = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      visibleScopes: visible,
      kind: 'import',
      bundle: { flow: lineageBundle.flow, steps: lineageBundle.steps },
      intent: 'import lineage',
      externalRef: 'muse:ref-123',
      createProposal,
    });
    assert.equal(lineageOnly.ok, false);
    assert.equal(lineageOnly.code, 'EXTERNAL_REF_INVALID');
  });
});

describe('FLOW-WRITE-LIVE-KN-b e2e — personal draft without Hub eval hop', () => {
  const dataDir = path.join(tmpRoot, 'e2e');
  const visible = new Set(['personal']);
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.FLOW_AUTHORING_WRITES = '1';
  });
  afterEach(() => {
    delete process.env.FLOW_AUTHORING_WRITES;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('create+E1+class holds for session-bound personal Flow new', async () => {
    const bundle = makeFlowBundle({ flowId: 'flow_fwl_e2e' });
    const proposed = await handleFlowProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      visibleScopes: visible,
      kind: 'new',
      flow: bundle.flow,
      steps: bundle.steps,
      intent: 'e2e draft',
      externalRef: 'scooling.flow:e2e-1',
      sessionBound: true,
      createProposal,
    });
    assert.equal(proposed.ok, true);
    const row = getProposal(dataDir, proposed.payload.proposal_id);
    assert.equal(row.evaluation_status, 'passed');
    assert.equal(row.evaluated_by, ACTOR);
    assert.equal(isPersonalSelfApplyClass(eligible(row, { role: 'editor' })), true);
  });
});

describe('FLOW-WRITE-LIVE-KN-b stress — N cycles no cross-user leakage', () => {
  it('distinct users never share Flow admission', async () => {
    for (let i = 0; i < 100; i++) {
      const a = flowProposal({
        proposal_id: `prop-a-${i}`,
        external_ref: `scooling.flow:a-${i}`,
        flowId: `flow_a_${i}`,
      });
      const b = flowProposal({
        proposal_id: `prop-b-${i}`,
        external_ref: `scooling.flow:b-${i}`,
        flowId: `flow_b_${i}`,
      });
      assert.equal(
        personalSelfApplyRefusalReason(eligible(a, { authorActorId: ACTOR, approverActorId: ACTOR })),
        null,
      );
      assert.equal(
        personalSelfApplyRefusalReason(eligible(b, { authorActorId: ACTOR, approverActorId: OTHER })),
        'SELF_APPLY_AUTHOR_MISMATCH',
      );
    }
  });
});

describe('FLOW-WRITE-LIVE-KN-b data-integrity — index fields + server audit', () => {
  it('client evaluation_status stripped; E1 sets server audit on Flow fingerprint', async () => {
    const stripped = stripClientEvaluationFields({
      evaluation_status: 'passed',
      evaluated_by: 'forged',
      evaluated_at: '2099-01-01T00:00:00.000Z',
      path: 'meta/flows/fwl-di.md',
      source: FLOW_PROPOSAL_SOURCE,
      external_ref: 'scooling.flow:di-1',
      body: JSON.stringify({
        flow: { flow_id: 'flow_fwl_di', scope: 'personal', version: '1.0.0' },
        steps: [],
      }),
      frontmatter: { type: 'flow', flow_id: 'flow_fwl_di', scope: 'personal' },
      flow_meta: { kind: 'new', base_version: null, base_state_id: 'x' },
    });
    assert.equal(stripped.evaluation_status, undefined);
    const e1 = applyPersonalSelfApplyEvaluationE1(stripped, {
      evaluatedBy: ACTOR,
      sessionBound: true,
      authorActorId: ACTOR,
      evaluatedAt: '2026-07-28T00:00:00.000Z',
    });
    assert.equal(e1.evaluation_status, 'passed');
    assert.equal(e1.evaluated_by, ACTOR);
    assert.equal(e1.evaluated_at, '2026-07-28T00:00:00.000Z');
    assert.equal(e1.external_ref, 'scooling.flow:di-1');
    assert.equal(e1.flow_meta.kind, 'new');
  });
});

describe('FLOW-WRITE-LIVE-KN-b performance — Flow admission bounded like Tasks class', () => {
  it('1000 Flow fingerprint + E1 stamps stay under budget', async () => {
    const body = {
      path: 'meta/flows/perf.md',
      source: FLOW_PROPOSAL_SOURCE,
      external_ref: 'scooling.flow:perf',
      body: JSON.stringify({
        flow: { flow_id: 'flow_perf', scope: 'personal', version: '1.0.0' },
        steps: [],
      }),
      frontmatter: { type: 'flow', scope: 'personal' },
      flow_meta: { kind: 'new', base_version: null, base_state_id: 'x' },
    };
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      assert.equal(matchesScoolingFlowFingerprint(body), true);
      applyPersonalSelfApplyEvaluationE1(body, {
        evaluatedBy: ACTOR,
        sessionBound: true,
        authorActorId: ACTOR,
      });
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `Flow E1 1000 cycles took ${ms}ms`);
  });
});

describe('FLOW-WRITE-LIVE-KN-b security — scope / injection / P4 / secrets', () => {
  it('scope widen refuse; injection inert; P4 delegation refused; no secrets in fingerprint', async () => {
    assert.equal(
      personalSelfApplyRefusalReason(eligible(flowProposal(), { partitionOwned: false })),
      'NOT_PARTITION_OWNED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(flowProposal(), { sessionBound: false })),
      'SELF_APPLY_SESSION_BINDING_REQUIRED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({ status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE }),
      ),
      'SELF_APPLY_DELEGATION_REFUSED',
    );
    const injected = flowProposal({
      external_ref: 'scooling.flow:ok"; DROP TABLE--',
    });
    assert.equal(matchesScoolingFlowFingerprint(injected), false);
    assert.equal(
      personalSelfApplyRefusalReason(eligible(injected)),
      'SELF_APPLY_NOT_ADMITTED',
    );
    const withSecretAttempt = flowProposal({
      bodyObj: {
        flow: {
          flow_id: 'flow_sec',
          scope: 'personal',
          version: '1.0.0',
          api_key: 'sk-secret-should-not-affect-admission',
        },
        steps: [],
      },
    });
    assert.equal(matchesScoolingFlowFingerprint(withSecretAttempt), true);
    assert.equal(
      JSON.stringify(withSecretAttempt).includes('sk-secret'),
      true,
      'fixture may carry inert body fields',
    );
    // Admission uses path/source/kind/ref/scope only — secret body field does not elevate.
    assert.equal(personalSelfApplyRefusalReason(eligible(withSecretAttempt)), null);
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible(flowProposal({ review_severity: 'elevated' })),
      ),
      'ELEVATED_OR_AUTO_FLAGGED',
    );
  });
});
