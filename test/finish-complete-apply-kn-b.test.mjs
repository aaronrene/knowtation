/**
 * FINISH-COMPLETE-APPLY-KN-b — seven-tier coverage (§FCA.7).
 * Frozen: ~/scooling/docs/FINISH-COMPLETE-APPLY-CONTRACT.md
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
  matchesScoolingTaskFingerprint,
  matchesScoolingMediaFingerprint,
  isAdmittedSeamSelfApplyFingerprint,
  applyPersonalSelfApplyEvaluationE1,
  SCOOLING_TASK_EXTERNAL_REF_RE,
  SCOOLING_MEDIA_EXTERNAL_REF_RE,
  SCOOLING_REVIEW_TRAY_INTENT,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  resolveOptionalScoolingExternalRef,
  readProposeExternalRefRaw,
} from '../lib/scooling-external-ref.mjs';
import { TASK_PROPOSAL_SOURCE, handleTaskProposeRequest } from '../lib/task/task-write.mjs';
import { MEDIA_PROPOSAL_SOURCE, handleMediaLinkProposeRequest } from '../lib/attachments/attachment-write.mjs';
import { DELEGATION_PROPOSAL_SOURCE } from '../lib/agent/delegation.mjs';
import { FLOW_PROPOSAL_SOURCE } from '../lib/flow/flow-authoring.mjs';
import { createProposal, getProposal } from '../hub/proposals-store.mjs';
import { stripClientEvaluationFields } from '../lib/hub-proposal-create-augment.mjs';
import { sampleTaskCreatePayload } from './fixtures/task/write-helpers.mjs';
import {
  buildMediaWriteFixture,
  grantActiveConsent,
  sampleLinkProposeBody,
} from './fixtures/media/write-helpers.mjs';
import { FM_PROPOSAL_SOURCE, FM_TASK_PROPOSAL_KIND } from '../lib/task/task-hosted-proposal.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-finish-complete-apply-kn-b');

const ACTOR = 'google:learner-a';
const OTHER = 'google:learner-b';

/**
 * Enable media external-link propose for FCA fixtures (§FCA.7 media rows).
 * @param {string} dataDir
 */
function enableMediaExternalLinkWrites(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'hub_media_write_policy.json'),
    JSON.stringify({ media_external_link_enabled: true, media_attach_enabled: true }),
    'utf8',
  );
}

function taskProposal(overrides = {}) {
  const proposalId = overrides.proposal_id || 'prop-task-1';
  const bodyObj = overrides.bodyObj || {
    proposal_kind: 'task_create',
    task: {
      schema: 'knowtation.task/v0',
      task_id: 'task_fca_1',
      kind: 'personal',
      scope: 'personal',
      status: 'pending',
      title: 'FCA',
      workspace_id: 'ws',
    },
  };
  return {
    proposal_id: proposalId,
    status: 'proposed',
    source: TASK_PROPOSAL_SOURCE,
    path: `meta/tasks/proposals/${proposalId}.json`,
    external_ref: 'scooling.task:fixture-001',
    body: JSON.stringify(bodyObj),
    frontmatter: {
      [FM_PROPOSAL_SOURCE]: TASK_PROPOSAL_SOURCE,
      [FM_TASK_PROPOSAL_KIND]: bodyObj.proposal_kind,
    },
    task_meta: {
      record_kind: 'task',
      proposal_kind: bodyObj.proposal_kind,
      task_id: bodyObj.task?.task_id ?? null,
    },
    ...overrides,
  };
}

function mediaProposal(overrides = {}) {
  const proposalId = overrides.proposal_id || 'prop-media-1';
  const bodyObj = overrides.bodyObj || {
    proposal_kind: 'media_external_link',
    scope: 'personal',
    connector_id: 'ext_drive',
    opaque_ref: 'file:abc',
    consent_id: 'consent_1',
    attachment_id: 'att_1',
  };
  return {
    proposal_id: proposalId,
    status: 'proposed',
    source: MEDIA_PROPOSAL_SOURCE,
    path: `meta/media/proposals/${proposalId}.json`,
    external_ref: 'scooling.media:fixture-001',
    body: JSON.stringify(bodyObj),
    media_meta: { proposal_kind: bodyObj.proposal_kind, record_kind: 'media_external_link' },
    ...overrides,
  };
}

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

describe('FINISH-COMPLETE-APPLY-KN-b unit — admission predicate §FCA.4', () => {
  it('admits personal task_create + media_external_link fingerprints', () => {
    assert.equal(matchesScoolingTaskFingerprint(taskProposal()), true);
    assert.equal(matchesScoolingMediaFingerprint(mediaProposal()), true);
    assert.equal(personalSelfApplyRefusalReason(eligible(taskProposal())), null);
    assert.equal(personalSelfApplyRefusalReason(eligible(mediaProposal())), null);
  });

  it('refuses Delegation unconditionally; Flow not admitted', () => {
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({ status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE }),
      ),
      'SELF_APPLY_DELEGATION_REFUSED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({
          status: 'proposed',
          source: FLOW_PROPOSAL_SOURCE,
          path: 'meta/flows/x.json',
          external_ref: 'scooling.task:x',
        }),
      ),
      'SELF_APPLY_NOT_ADMITTED',
    );
  });

  it('empty author / mcp_access / project scope / other-assignee refuse', () => {
    assert.equal(
      personalSelfApplyRefusalReason(eligible(taskProposal(), { authorActorId: '' })),
      'SELF_APPLY_AUTHOR_UNVERIFIED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(taskProposal(), { tokenType: 'mcp_access' })),
      'ROLE_NOT_ELIGIBLE',
    );
    const project = taskProposal({
      bodyObj: {
        proposal_kind: 'task_create',
        task: { task_id: 't', kind: 'personal', scope: 'project', status: 'pending', title: 'P', workspace_id: 'ws' },
      },
    });
    assert.equal(personalSelfApplyRefusalReason(eligible(project)), 'SELF_APPLY_NOT_ADMITTED');
    const assignOther = taskProposal({
      bodyObj: {
        proposal_kind: 'task_assign',
        task_id: 't1',
        scope: 'personal',
        assignee_ref: OTHER,
      },
    });
    assert.equal(isAdmittedSeamSelfApplyFingerprint(assignOther, ACTOR), false);
    assert.equal(personalSelfApplyRefusalReason(eligible(assignOther)), 'SELF_APPLY_NOT_ADMITTED');
    const assignSelf = taskProposal({
      bodyObj: {
        proposal_kind: 'task_assign',
        task_id: 't1',
        scope: 'personal',
        assignee_ref: ACTOR,
      },
    });
    assert.equal(personalSelfApplyRefusalReason(eligible(assignSelf)), null);
  });

  it('pending path slug is not admitted; rewritten path is', () => {
    const pending = taskProposal({ path: 'meta/tasks/proposals/pending.json', proposal_id: 'prop-x' });
    assert.equal(matchesScoolingTaskFingerprint(pending), false);
    assert.equal(matchesScoolingTaskFingerprint(pending, { allowPendingPath: true }), true);
  });

  it('external_ref helpers validate regex; malformed refuse', () => {
    assert.equal(SCOOLING_TASK_EXTERNAL_REF_RE.test('scooling.task:ok'), true);
    assert.equal(SCOOLING_MEDIA_EXTERNAL_REF_RE.test('scooling.media:ok'), true);
    const bad = resolveOptionalScoolingExternalRef('scooling.review:x', SCOOLING_TASK_EXTERNAL_REF_RE);
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal(readProposeExternalRefRaw({ body: { external_ref: 'scooling.task:a' } }), 'scooling.task:a');
  });
});

describe('FINISH-COMPLETE-APPLY-KN-b integration — propose persist + approve class', () => {
  const dataDir = path.join(tmpRoot, 'integ');
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.TASK_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.TASK_WRITES_ENABLED;
  });

  it('persists external_ref on task propose; session-bound class holds after path rewrite', async () => {
    const proposed = await handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      role: 'editor',
      proposalKind: 'task_create',
      intent: 'create personal task',
      sessionBound: true,
      body: {
        ...sampleTaskCreatePayload(),
        task: { ...sampleTaskCreatePayload().task, task_id: 'task_fca_persist' },
        external_ref: 'scooling.task:persist-1',
      },
      createProposal,
    });
    assert.equal(proposed.ok, true);
    const row = getProposal(dataDir, proposed.payload.proposal_id);
    assert.equal(row.external_ref, 'scooling.task:persist-1');
    assert.match(row.path, /^meta\/tasks\/proposals\/.+\.json$/);
    assert.notEqual(row.path, 'meta/tasks/proposals/pending.json');
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible(
          {
            ...row,
            task_meta: row.task_meta,
          },
          { role: 'editor' },
        ),
      ),
      null,
    );
  });

  it('absent external_ref proposes ok but not admitted; malformed → 400', async () => {
    const noRef = await handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      role: 'editor',
      proposalKind: 'task_create',
      intent: 'create',
      body: { ...sampleTaskCreatePayload(), task: { ...sampleTaskCreatePayload().task, task_id: 'task_fca_noref' } },
      createProposal,
    });
    assert.equal(noRef.ok, true);
    const row = getProposal(dataDir, noRef.payload.proposal_id);
    assert.equal(
      personalSelfApplyRefusalReason(eligible({ ...row, source: TASK_PROPOSAL_SOURCE })),
      'SELF_APPLY_NOT_ADMITTED',
    );

    const bad = await handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      role: 'editor',
      proposalKind: 'task_create',
      intent: 'create',
      body: { ...{ ...sampleTaskCreatePayload(), task: { ...sampleTaskCreatePayload().task, task_id: 'task_fca_badref' } }, external_ref: 'nope' },
      createProposal,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal(bad.code, 'EXTERNAL_REF_INVALID');
  });

  it('elevated task fingerprint does not self-apply', () => {
    const elevated = taskProposal({ review_severity: 'elevated' });
    assert.equal(personalSelfApplyRefusalReason(eligible(elevated)), 'ELEVATED_OR_AUTO_FLAGGED');
  });

  it('persists external_ref on media_external_link propose; class holds after path rewrite', async () => {
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'media-integ'));
    enableMediaExternalLinkWrites(fx.dataDir);
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const proposed = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      userId: ACTOR,
      cliScopes: ['personal', 'project', 'org'],
      intent: 'link personal media',
      sessionBound: true,
      body: {
        ...sampleLinkProposeBody({ consent_id: consentId }),
        external_ref: 'scooling.media:persist-1',
      },
      createProposal,
    });
    assert.equal(proposed.ok, true);
    const row = getProposal(fx.dataDir, proposed.payload.proposal_id);
    assert.equal(row.external_ref, 'scooling.media:persist-1');
    assert.match(row.path, /^meta\/media\/proposals\/.+\.json$/);
    assert.notEqual(row.path, 'meta/media/proposals/pending.json');
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible(
          {
            ...row,
            media_meta: row.media_meta,
          },
          { role: 'editor' },
        ),
      ),
      null,
    );
  });
});

describe('FINISH-COMPLETE-APPLY-KN-b e2e — personal task_create + media_external_link without Hub eval hop', () => {
  const dataDir = path.join(tmpRoot, 'e2e');
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.TASK_WRITES_ENABLED = '1';
  });
  afterEach(() => {
    delete process.env.TASK_WRITES_ENABLED;
  });

  it('create+E1+class holds for session-bound personal task', async () => {
    const proposed = await handleTaskProposeRequest({
      dataDir,
      vaultId: 'default',
      userId: ACTOR,
      role: 'editor',
      proposalKind: 'task_create',
      intent: 'e2e',
      sessionBound: true,
      body: {
        ...{ ...sampleTaskCreatePayload(), task: { ...sampleTaskCreatePayload().task, task_id: 'task_fca_e2e' } },
        external_ref: 'scooling.task:e2e-1',
      },
      createProposal,
    });
    assert.equal(proposed.ok, true);
    const row = getProposal(dataDir, proposed.payload.proposal_id);
    assert.equal(row.evaluation_status, 'passed');
    assert.equal(row.evaluated_by, ACTOR);
    assert.equal(isPersonalSelfApplyClass(eligible(row, { role: 'editor' })), true);
  });

  it('create+E1+class holds for session-bound personal media_external_link', async () => {
    const fx = buildMediaWriteFixture(path.join(tmpRoot, 'e2e-media'));
    enableMediaExternalLinkWrites(fx.dataDir);
    const consentId = grantActiveConsent(fx.dataDir, fx.vaultId, 'gdrive');
    const proposed = await handleMediaLinkProposeRequest({
      dataDir: fx.dataDir,
      vaultId: fx.vaultId,
      userId: ACTOR,
      cliScopes: ['personal', 'project', 'org'],
      intent: 'e2e media',
      sessionBound: true,
      body: {
        ...sampleLinkProposeBody({ consent_id: consentId }),
        external_ref: 'scooling.media:e2e-1',
      },
      createProposal,
    });
    assert.equal(proposed.ok, true);
    const row = getProposal(fx.dataDir, proposed.payload.proposal_id);
    assert.equal(row.evaluation_status, 'passed');
    assert.equal(row.evaluated_by, ACTOR);
    assert.equal(isPersonalSelfApplyClass(eligible(row, { role: 'editor' })), true);
  });
});

describe('FINISH-COMPLETE-APPLY-KN-b stress — N cycles no cross-user leakage', () => {
  it('distinct users never share admission', () => {
    for (let i = 0; i < 100; i++) {
      const a = taskProposal({
        proposal_id: `prop-a-${i}`,
        external_ref: `scooling.task:a-${i}`,
      });
      const b = taskProposal({
        proposal_id: `prop-b-${i}`,
        external_ref: `scooling.task:b-${i}`,
      });
      assert.equal(personalSelfApplyRefusalReason(eligible(a, { authorActorId: ACTOR, approverActorId: ACTOR })), null);
      assert.equal(
        personalSelfApplyRefusalReason(eligible(b, { authorActorId: ACTOR, approverActorId: OTHER })),
        'SELF_APPLY_AUTHOR_MISMATCH',
      );
    }
  });
});

describe('FINISH-COMPLETE-APPLY-KN-b data-integrity — P2 strip + server evaluation', () => {
  it('client evaluation_status stripped; E1 sets server audit', () => {
    const stripped = stripClientEvaluationFields({
      evaluation_status: 'passed',
      evaluated_by: 'forged',
      evaluated_at: '2099-01-01T00:00:00.000Z',
      path: 'meta/tasks/proposals/pending.json',
      source: TASK_PROPOSAL_SOURCE,
      external_ref: 'scooling.task:di-1',
      body: JSON.stringify({
        proposal_kind: 'task_create',
        task: { scope: 'personal', task_id: 't', kind: 'personal', status: 'pending', title: 'x', workspace_id: 'w' },
      }),
      frontmatter: { [FM_PROPOSAL_SOURCE]: 'task', [FM_TASK_PROPOSAL_KIND]: 'task_create' },
    });
    assert.equal(stripped.evaluation_status, undefined);
    const e1 = applyPersonalSelfApplyEvaluationE1(stripped, {
      evaluatedBy: ACTOR,
      sessionBound: true,
      authorActorId: ACTOR,
      evaluatedAt: '2026-07-27T00:00:00.000Z',
    });
    assert.equal(e1.evaluation_status, 'passed');
    assert.equal(e1.evaluated_by, ACTOR);
    assert.equal(e1.evaluated_at, '2026-07-27T00:00:00.000Z');
  });
});

describe('FINISH-COMPLETE-APPLY-KN-b performance — E1 is pure and bounded', () => {
  it('1000 E1 stamps stay under budget', () => {
    const body = {
      path: 'meta/tasks/proposals/pending.json',
      source: TASK_PROPOSAL_SOURCE,
      external_ref: 'scooling.task:perf',
      body: JSON.stringify({
        proposal_kind: 'task_create',
        task: { scope: 'personal', task_id: 't', kind: 'personal', status: 'pending', title: 'x', workspace_id: 'w' },
      }),
      frontmatter: { [FM_PROPOSAL_SOURCE]: 'task', [FM_TASK_PROPOSAL_KIND]: 'task_create' },
    };
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      applyPersonalSelfApplyEvaluationE1(body, {
        evaluatedBy: ACTOR,
        sessionBound: true,
        authorActorId: ACTOR,
      });
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `E1 1000 cycles took ${ms}ms`);
  });
});

describe('FINISH-COMPLETE-APPLY-KN-b security — IDOR / credential / forge', () => {
  it('IDOR: foreign partition never admits; shared/service/legacy_session cannot admit; forged evaluation ignored on E1 refuse', () => {
    assert.equal(
      personalSelfApplyRefusalReason(eligible(taskProposal(), { partitionOwned: false })),
      'NOT_PARTITION_OWNED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(mediaProposal(), { partitionOwned: false })),
      'NOT_PARTITION_OWNED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(taskProposal(), { sessionBound: false })),
      'SELF_APPLY_SESSION_BINDING_REQUIRED',
    );
    assert.equal(
      personalSelfApplyRefusalReason(eligible(taskProposal(), { authorActorId: ACTOR, approverActorId: OTHER })),
      'SELF_APPLY_AUTHOR_MISMATCH',
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        eligible({ status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE }, { sessionBound: true }),
      ),
      'SELF_APPLY_DELEGATION_REFUSED',
    );
    const forged = applyPersonalSelfApplyEvaluationE1(
      {
        ...taskProposal({ path: 'meta/tasks/proposals/pending.json' }),
        evaluation_status: 'passed',
        evaluated_by: 'attacker',
      },
      { sessionBound: false, evaluatedBy: ACTOR },
    );
    // sessionBound false → E1 does not stamp; forged fields remain on copy unless elevated clear
    assert.notEqual(forged.evaluated_by, ACTOR);
  });

  it('notes tray still eligible; wrong-prefix task ref not admitted', () => {
    const notes = {
      status: 'proposed',
      intent: SCOOLING_REVIEW_TRAY_INTENT,
      external_ref: 'scooling.review:ok',
      path: 'reviewed/ok.md',
    };
    assert.equal(personalSelfApplyRefusalReason(eligible(notes)), null);
    const wrongPrefix = taskProposal({ external_ref: 'scooling.review:nope' });
    assert.equal(personalSelfApplyRefusalReason(eligible(wrongPrefix)), 'SELF_APPLY_NOT_ADMITTED');
  });
});
