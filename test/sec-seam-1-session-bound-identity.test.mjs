/**
 * SEC-SEAM-1 — seven-tier coverage for session-bound learner identity on seam writes.
 *
 * Frozen: docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md (S1–S10, §7).
 * Tiers: unit · integration · 2b · e2e · 3b · stress · data-integrity · performance · security · 7b
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  resolveActorTokenClass,
  isSessionBoundActor,
  isMcpAccessPayload,
} from '../hub/gateway/access-token-authz.mjs';
import { parseSelfApplyIneligibleSubs, SELF_APPLY_INELIGIBLE_SUBS } from '../lib/hub-self-apply-ineligible.mjs';
import {
  isSeamSurfaceProposal,
  isDelegationSurfaceProposal,
  personalSelfApplyRefusalReason,
  isPersonalSelfApplyClass,
  personalSelfApplyAllowsApprove,
  isHttpVisibleSelfApplySeamCode,
  matchesScoolingReviewTrayFingerprint,
  SCOOLING_REVIEW_TRAY_INTENT,
  SELF_APPLY_HTTP_VISIBLE_SEAM_CODES,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import {
  normalizeCanisterProposalForTaskPrecheck,
  FM_PROPOSAL_SOURCE,
  FM_TASK_PROPOSAL_KIND,
} from '../lib/task/task-hosted-proposal.mjs';
import {
  normalizeCanisterProposalForDelegationPrecheck,
  isDelegationProposalIntent,
} from '../lib/agent/delegation-hosted-proposal.mjs';
import { TASK_PROPOSAL_SOURCE } from '../lib/task/task-write.mjs';
import { DELEGATION_PROPOSAL_SOURCE } from '../lib/agent/delegation.mjs';
import { MEDIA_PROPOSAL_SOURCE } from '../lib/attachments/attachment-write.mjs';
import { FLOW_PROPOSAL_SOURCE } from '../lib/flow/flow-authoring.mjs';
import { FLOW_CAPTURE_PROPOSAL_SOURCE } from '../lib/flow/flow-capture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SELF_APPLY_SRC = path.join(ROOT, 'lib/hub-proposal-personal-self-apply.mjs');
const GATEWAY_SRC = path.join(ROOT, 'hub/gateway/server.mjs');
const HUB_SRC = path.join(ROOT, 'hub/server.mjs');
const LOCAL_AUTH_SRC = path.join(ROOT, 'hub/lib/local-auth.mjs');
const CORS_GW = path.join(ROOT, 'hub/gateway/cors-middleware.mjs');
const CORS_BRIDGE = path.join(ROOT, 'hub/bridge/server.mjs');
const BRIDGE_DIR = path.join(ROOT, 'hub/bridge');
const TASK_ROUTES = path.join(ROOT, 'hub/bridge/task-routes.mjs');

const ACTOR_A = 'google:learner-a';
const ACTOR_B = 'google:learner-b';

function notesTray(overrides = {}) {
  return {
    status: 'proposed',
    intent: SCOOLING_REVIEW_TRAY_INTENT,
    external_ref: 'scooling.review:sec-seam-1',
    path: 'reviewed/sec-seam-1.md',
    review_severity: 'standard',
    ...overrides,
  };
}

function hostedTaskProposal(overrides = {}) {
  return {
    status: 'proposed',
    frontmatter: {
      [FM_PROPOSAL_SOURCE]: TASK_PROPOSAL_SOURCE,
      [FM_TASK_PROPOSAL_KIND]: 'task_create',
    },
    ...overrides,
  };
}

function baseEligibleOpts(extra = {}) {
  return {
    proposal: notesTray(),
    hasVaultWrite: true,
    partitionOwned: true,
    role: 'member',
    humanActor: true,
    tokenType: null,
    actorKind: 'human',
    ...extra,
  };
}

/**
 * Pre-fix isPersonalSelfApplyClass — branch-for-branch copy of the function as it
 * existed before SEC-SEAM-1b (lib/hub-proposal-personal-self-apply.mjs:106-124).
 * Security-tier regression must fail if the fix is reverted.
 *
 * @param {{
 *   proposal: Record<string, unknown>|null|undefined,
 *   hasVaultWrite: boolean,
 *   partitionOwned: boolean,
 *   role?: string,
 *   humanActor?: boolean,
 *   tokenType?: string|null,
 *   actorKind?: string|null,
 * }} opts
 * @returns {boolean}
 */
function isPersonalSelfApplyClassPreFix(opts) {
  const { proposal, hasVaultWrite, partitionOwned } = opts;
  if (!hasVaultWrite || !partitionOwned) return false;
  if (
    opts.role != null &&
    !(function roleEligible(role, actor = {}) {
      if (actor.humanActor === false) return false;
      if (String(actor.tokenType || '').trim() === 'mcp_access') return false;
      if (String(actor.actorKind || '').trim() === 'agent') return false;
      const r = String(role || '').trim();
      return r === 'member' || r === 'editor' || r === 'admin';
    })(opts.role, {
      humanActor: opts.humanActor,
      tokenType: opts.tokenType,
      actorKind: opts.actorKind,
    })
  ) {
    return false;
  }
  if (!proposal || typeof proposal !== 'object') return false;
  if (String(proposal.status ?? 'proposed').trim() !== 'proposed') return false;
  if (!matchesScoolingReviewTrayFingerprint(proposal)) return false;
  if (
    String(proposal.review_severity ?? '').trim() === 'elevated' ||
    (Array.isArray(proposal.auto_flag_reasons) && proposal.auto_flag_reasons.length > 0)
  ) {
    return false;
  }
  return true;
}

/** Round-1 seam classifier (N1 defect): keys on frontmatter.proposal_kind only. */
function round1SeamByProposalKind(proposal) {
  if (!proposal || typeof proposal !== 'object') return false;
  const fm =
    proposal.frontmatter && typeof proposal.frontmatter === 'object' ? proposal.frontmatter : {};
  const kind = fm.proposal_kind;
  const LIST = new Set([
    'task_create',
    'task_update',
    'media_link',
    'media_attach',
    'delegation_consent',
  ]);
  return typeof kind === 'string' && LIST.has(kind);
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 unit — token class, seam classify, parser, totality', () => {
  test('resolveActorTokenClass returns each of the four classes', () => {
    assert.equal(resolveActorTokenClass({ sub: 'a', type: 'session' }), 'session');
    assert.equal(resolveActorTokenClass({ sub: 'a', type: 'mcp_access', scopes: [] }), 'mcp_access');
    assert.equal(resolveActorTokenClass({ sub: 'a' }), 'legacy_session');
    assert.equal(resolveActorTokenClass(null), 'unknown');
    assert.equal(resolveActorTokenClass(undefined), 'unknown');
    assert.equal(resolveActorTokenClass('x'), 'unknown');
    assert.equal(resolveActorTokenClass({ type: 'other' }), 'unknown');
    assert.equal(resolveActorTokenClass({ type: 'session' }), 'session');
  });

  test('internal-hop and signServiceJwt-shaped payloads classify legacy_session (G3, G35)', () => {
    assert.equal(resolveActorTokenClass({ sub: 'gateway:bridge-hop' }), 'legacy_session');
    assert.equal(resolveActorTokenClass({ sub: 'service:consolidator', role: 'service' }), 'legacy_session');
  });

  test('isSessionBoundActor true only for session; false for null (V11)', () => {
    assert.equal(isSessionBoundActor({ sub: 'a', type: 'session' }), true);
    assert.equal(isSessionBoundActor({ sub: 'a' }), false);
    assert.equal(isSessionBoundActor({ sub: 'a', type: 'mcp_access', scopes: [] }), false);
    assert.equal(isSessionBoundActor(null), false);
    assert.equal(isMcpAccessPayload({ type: 'mcp_access' }), true);
  });

  test('isSeamSurfaceProposal true for each of seven S3.1 conditions independently', () => {
    assert.equal(
      isSeamSurfaceProposal({
        frontmatter: { knowtation_proposal_source: 'task', task_proposal_kind: 'task_create' },
      }),
      true
    );
    assert.equal(
      isSeamSurfaceProposal({
        intent: 'delegation_consent_create',
        frontmatter: { knowtation_proposal_source: 'delegation', delegation_record_kind: 'consent' },
      }),
      true
    );
    assert.equal(isSeamSurfaceProposal({ source: TASK_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: DELEGATION_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: MEDIA_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: FLOW_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: FLOW_CAPTURE_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal(notesTray()), false);
  });

  test('isDelegationSurfaceProposal true for conditions 2 and 4 only', () => {
    assert.equal(
      isDelegationSurfaceProposal({
        intent: 'delegation_consent_create',
        frontmatter: { knowtation_proposal_source: 'delegation', delegation_record_kind: 'consent' },
      }),
      true
    );
    assert.equal(isDelegationSurfaceProposal({ source: DELEGATION_PROPOSAL_SOURCE }), true);
    assert.equal(isDelegationSurfaceProposal({ source: TASK_PROPOSAL_SOURCE }), false);
    assert.equal(isDelegationSurfaceProposal({ source: FLOW_PROPOSAL_SOURCE }), false);
    assert.equal(isDelegationSurfaceProposal(notesTray()), false);
  });

  test('predicate throw classifies seam (fail-closed S3.1)', async () => {
    const modPath = pathToFileURLSafe(SELF_APPLY_SRC);
    // Patch via a local wrapper: call with a Proxy that throws on source read after object check
    // isSeamSurfaceProposal catches throws from normalize* — inject a poison frontmatter getter.
    const poison = {
      get frontmatter() {
        throw new Error('poison');
      },
    };
    assert.equal(isSeamSurfaceProposal(poison), true);
    void modPath;
  });

  test('personalSelfApplyRefusalReason is total — no input yields undefined', () => {
    const cases = [
      {},
      { hasVaultWrite: false, partitionOwned: false },
      { hasVaultWrite: true, partitionOwned: true, proposal: null },
      { hasVaultWrite: true, partitionOwned: true, proposal: notesTray(), role: 'viewer' },
      baseEligibleOpts(),
      baseEligibleOpts({ proposal: hostedTaskProposal(), sessionBound: true, authorActorId: ACTOR_A, approverActorId: ACTOR_A }),
    ];
    for (const opts of cases) {
      const reason = personalSelfApplyRefusalReason(/** @type {any} */ (opts));
      assert.notEqual(reason, undefined);
      assert.ok(reason === null || typeof reason === 'string');
    }
  });

  test('parseSelfApplyIneligibleSubs empty for unset / empty / comma-only (V6)', () => {
    assert.equal(parseSelfApplyIneligibleSubs(undefined).size, 0);
    assert.equal(parseSelfApplyIneligibleSubs('').size, 0);
    assert.equal(parseSelfApplyIneligibleSubs(',, ').size, 0);
    assert.deepEqual([...parseSelfApplyIneligibleSubs('a, b')], ['a', 'b']);
  });
});

function pathToFileURLSafe(p) {
  return p;
}

// ---------------------------------------------------------------------------
// Tier 2 — integration
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 integration — S6 codes, HTTP visibility, call-site wiring', () => {
  test('refusal reasons cover each S6 code for its exact trigger', () => {
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ hasVaultWrite: false })),
      'NOT_VAULT_WRITE'
    );
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ partitionOwned: false })),
      'NOT_PARTITION_OWNED'
    );
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ role: 'viewer' })),
      'ROLE_NOT_ELIGIBLE'
    );
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ proposal: null })),
      'PROPOSAL_MISSING'
    );
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ proposal: notesTray({ status: 'approved' }) })),
      'STATUS_NOT_PROPOSED'
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: { status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE },
          sessionBound: true,
          authorActorId: ACTOR_A,
          approverActorId: ACTOR_A,
        })
      ),
      'SELF_APPLY_DELEGATION_REFUSED'
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal(),
          sessionBound: false,
          authorActorId: ACTOR_A,
          approverActorId: ACTOR_A,
        })
      ),
      'SELF_APPLY_SESSION_BINDING_REQUIRED'
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal(),
          sessionBound: true,
          authorActorId: '',
          approverActorId: ACTOR_A,
        })
      ),
      'SELF_APPLY_AUTHOR_UNVERIFIED'
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal(),
          sessionBound: true,
          authorActorId: ACTOR_A,
          approverActorId: ACTOR_B,
        })
      ),
      'SELF_APPLY_AUTHOR_MISMATCH'
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal(),
          sessionBound: true,
          authorActorId: ACTOR_A,
          approverActorId: ACTOR_A,
        })
      ),
      'SELF_APPLY_NOT_ADMITTED'
    );
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ proposal: { status: 'proposed', intent: 'other' } })),
      'FINGERPRINT_MISMATCH'
    );
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({ proposal: notesTray({ review_severity: 'elevated' }) })
      ),
      'ELEVATED_OR_AUTO_FLAGGED'
    );
  });

  test('S6.1 precedence: earliest refusal wins when several apply', () => {
    // vault write fails before seam codes even if seam + unbound
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          hasVaultWrite: false,
          proposal: hostedTaskProposal(),
          sessionBound: false,
        })
      ),
      'NOT_VAULT_WRITE'
    );
    // delegation before session binding
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: { status: 'proposed', source: DELEGATION_PROPOSAL_SOURCE },
          sessionBound: false,
          authorActorId: '',
        })
      ),
      'SELF_APPLY_DELEGATION_REFUSED'
    );
    // session before author empty
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal(),
          sessionBound: false,
          authorActorId: '',
          approverActorId: ACTOR_A,
        })
      ),
      'SELF_APPLY_SESSION_BINDING_REQUIRED'
    );
  });

  test('isPersonalSelfApplyClass / personalSelfApplyAllowsApprove equal reason === null (V5)', () => {
    const matrix = [
      baseEligibleOpts(),
      baseEligibleOpts({ hasVaultWrite: false }),
      baseEligibleOpts({
        proposal: hostedTaskProposal(),
        sessionBound: true,
        authorActorId: ACTOR_A,
        approverActorId: ACTOR_A,
      }),
    ];
    for (const opts of matrix) {
      const reason = personalSelfApplyRefusalReason(opts);
      assert.equal(isPersonalSelfApplyClass(opts), reason === null);
      assert.equal(personalSelfApplyAllowsApprove(opts), reason === null);
    }
  });

  test('HTTP-visible seam codes vs generic FORBIDDEN wiring (source-read V4/V5/N7)', () => {
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    const hub = fs.readFileSync(HUB_SRC, 'utf8');
    for (const src of [gw, hub]) {
      assert.match(src, /personalSelfApplyRefusalReason\s*\(/);
      assert.match(src, /isHttpVisibleSelfApplySeamCode/);
      assert.match(src, /code:\s*['"]FORBIDDEN['"]/);
      assert.match(src, /authorActorId/);
      assert.match(src, /approverActorId/);
      assert.match(src, /sessionBound/);
    }
    for (const code of SELF_APPLY_HTTP_VISIBLE_SEAM_CODES) {
      assert.equal(isHttpVisibleSelfApplySeamCode(code), true);
    }
    assert.equal(isHttpVisibleSelfApplySeamCode('SELF_APPLY_SUBJECT_INELIGIBLE'), false);
    assert.equal(isHttpVisibleSelfApplySeamCode('FINGERPRINT_MISMATCH'), false);
    assert.equal(isHttpVisibleSelfApplySeamCode('NOT_VAULT_WRITE'), false);
  });

  test('resolveHostedActorRole returns payload at both mcp_access and main returns (W1)', () => {
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    const mcpReturn = gw.match(/isMcpAccessPayload\(bearerPayload\)[\s\S]*?return \{ role, mayApproveProposals, isMcpAccess: true, payload: bearerPayload \}/);
    assert.ok(mcpReturn, 'mcp_access early return must include payload');
    assert.match(gw, /return \{ role, mayApproveProposals, isMcpAccess: false, payload: bearerPayload \}/);
  });

  test('S1 stamps issueLocalToken with type session (G36)', () => {
    const src = fs.readFileSync(LOCAL_AUTH_SRC, 'utf8');
    const fn = src.slice(src.indexOf('export function issueLocalToken'));
    const body = fn.slice(0, fn.indexOf('export async function createLocalCredential'));
    assert.match(body, /type:\s*['"]session['"]/);
  });

  test('S1 stamps all five learner mint sites; not the internal hop', () => {
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    const hub = fs.readFileSync(HUB_SRC, 'utf8');
    assert.match(gw, /function issueToken\(user\)[\s\S]*?type:\s*['"]session['"]/);
    assert.match(gw, /function issueAccessTokenForSub\(sub\)[\s\S]*?type:\s*['"]session['"]/);
    assert.match(hub, /function issueToken\(user\)[\s\S]*?type:\s*['"]session['"]/);
    assert.match(hub, /function issueAccessTokenForSub\(sub\)[\s\S]*?type:\s*['"]session['"]/);
  });
});

// ---------------------------------------------------------------------------
// Tier 2b — behavior preservation (N5)
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 2b — differential vs pre-fix for non-seam / no-S10 inputs', () => {
  test('reason === null equals pre-fix boolean when no seam/S10 input', () => {
    const proposals = [
      notesTray(),
      notesTray({ status: undefined }), // absent status → proposed
      notesTray({ intent: 'other' }),
      notesTray({ review_severity: 'elevated' }),
      null,
      { status: 'approved', intent: SCOOLING_REVIEW_TRAY_INTENT, external_ref: 'scooling.review:x', path: 'reviewed/x.md' },
    ];
    const roles = [undefined, null, 'member', 'viewer', 'admin'];
    for (const proposal of proposals) {
      for (const role of roles) {
        const opts = {
          proposal,
          hasVaultWrite: true,
          partitionOwned: true,
          ...(role === undefined ? {} : { role }),
        };
        // Strip seam/S10 extras — none supplied
        const fixedNull = personalSelfApplyRefusalReason(opts) === null;
        const pre = isPersonalSelfApplyClassPreFix(opts);
        assert.equal(
          fixedNull,
          pre,
          `mismatch for role=${String(role)} proposal=${JSON.stringify(proposal)?.slice(0, 80)}`
        );
      }
    }
  });

  test('role omitted skips check; status absent treated as proposed', () => {
    const optsNoRole = {
      proposal: notesTray(),
      hasVaultWrite: true,
      partitionOwned: true,
      // role omitted
    };
    assert.equal(personalSelfApplyRefusalReason(optsNoRole), null);
    assert.equal(isPersonalSelfApplyClassPreFix(optsNoRole), true);

    const optsNoStatus = {
      proposal: notesTray({ status: undefined }),
      hasVaultWrite: true,
      partitionOwned: true,
      role: 'member',
    };
    // notesTray spreads status:'proposed' then undefined override deletes? Use delete
    const p = notesTray();
    delete p.status;
    const opts = { proposal: p, hasVaultWrite: true, partitionOwned: true, role: 'member' };
    assert.equal(personalSelfApplyRefusalReason(opts), null);
    assert.equal(isPersonalSelfApplyClassPreFix(opts), true);
    void optsNoStatus;
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e approve-eligibility matrix
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 e2e — approve-eligibility matrix', () => {
  test('{seam,non-seam} × {session,legacy,mcp} × author relations', () => {
    const seams = [false, true];
    const binds = [
      { label: 'session', sessionBound: true, tokenType: null, actorKind: 'human', humanActor: true },
      { label: 'legacy', sessionBound: false, tokenType: null, actorKind: 'human', humanActor: true },
      {
        label: 'mcp_access',
        sessionBound: false,
        tokenType: 'mcp_access',
        actorKind: 'agent',
        humanActor: false,
      },
    ];
    const authors = [
      { label: 'eq', authorActorId: ACTOR_A, approverActorId: ACTOR_A },
      { label: 'neq', authorActorId: ACTOR_A, approverActorId: ACTOR_B },
      { label: 'empty', authorActorId: '', approverActorId: ACTOR_A },
    ];

    for (const seam of seams) {
      for (const b of binds) {
        for (const a of authors) {
          const proposal = seam ? hostedTaskProposal() : notesTray();
          const opts = baseEligibleOpts({
            proposal,
            sessionBound: b.sessionBound,
            tokenType: b.tokenType,
            actorKind: b.actorKind,
            humanActor: b.humanActor,
            authorActorId: a.authorActorId,
            approverActorId: a.approverActorId,
          });
          const reason = personalSelfApplyRefusalReason(opts);
          if (!seam) {
            if (b.label === 'mcp_access') {
              assert.equal(reason, 'ROLE_NOT_ELIGIBLE');
            } else {
              assert.equal(reason, null, `notes must stay eligible (${b.label}/${a.label})`);
            }
          } else {
            assert.notEqual(reason, null);
            assert.ok(
              String(reason).startsWith('SELF_APPLY_') || reason === 'ROLE_NOT_ELIGIBLE',
              `seam must refuse with named code, got ${reason}`
            );
          }
        }
      }
    }
  });

  test('notes tray with legacy token and empty author still eligible (S2.4)', () => {
    const reason = personalSelfApplyRefusalReason(
      baseEligibleOpts({
        sessionBound: false,
        authorActorId: '',
        approverActorId: ACTOR_A,
      })
    );
    assert.equal(reason, null);
  });
});

// ---------------------------------------------------------------------------
// Tier 3b — role floor (N13 / S5)
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 3b — learner role floor on seam propose (S5)', () => {
  test('hosted task propose maps member → editor; self-hosted task/delegation include viewer', () => {
    const taskRoutes = fs.readFileSync(TASK_ROUTES, 'utf8');
    assert.match(taskRoutes, /member.*editor|r === 'member'/);
    const hub = fs.readFileSync(HUB_SRC, 'utf8');
    assert.match(hub, /TASK_WRITE_ROLES\s*=\s*requireRole\('viewer',\s*'editor',\s*'admin',\s*'evaluator'\)/);
    assert.match(
      hub,
      /app\.post\('\/api\/v1\/delegation\/consents'[\s\S]*?requireRole\('viewer',\s*'editor',\s*'admin',\s*'evaluator'\)/
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 stress — many seam proposals never eligible', () => {
  test('distinct seam proposals sharing one author never eligible; trim/equality holds', () => {
    const author = 'x'.repeat(128);
    for (let i = 0; i < 200; i++) {
      const reason = personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal({
            intent: `adversarial/${i}/${'y'.repeat(64)}`,
            path: `meta/tasks/proposals/${i}.json`,
          }),
          sessionBound: true,
          authorActorId: `  ${author}  `,
          approverActorId: author,
        })
      );
      assert.equal(reason, 'SELF_APPLY_NOT_ADMITTED');
    }
    assert.equal(
      personalSelfApplyRefusalReason(
        baseEligibleOpts({
          proposal: hostedTaskProposal(),
          sessionBound: true,
          authorActorId: 'Ab',
          approverActorId: 'ab',
        })
      ),
      'SELF_APPLY_AUTHOR_MISMATCH'
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 data-integrity — pure decision, idempotent', () => {
  test('refusal does not mutate proposal; repeated calls identical', () => {
    const proposal = hostedTaskProposal({
      created_by: ACTOR_A,
      labels: ['a'],
    });
    const snapshot = JSON.stringify(proposal);
    const opts = baseEligibleOpts({
      proposal,
      sessionBound: true,
      authorActorId: ACTOR_A,
      approverActorId: ACTOR_A,
    });
    const r1 = personalSelfApplyRefusalReason(opts);
    const r2 = personalSelfApplyRefusalReason(opts);
    assert.equal(r1, r2);
    assert.equal(JSON.stringify(proposal), snapshot);
    assert.equal(proposal.evaluation_status, undefined);
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 performance — no extra IO in eligibility decision', () => {
  test('eligibility resolution is pure (no fs/network in refusalReason)', () => {
    const openSync = mock.method(fs, 'readFileSync', () => {
      throw new Error('unexpected fs in eligibility');
    });
    try {
      const t0 = performance.now();
      for (let i = 0; i < 500; i++) {
        personalSelfApplyRefusalReason(
          baseEligibleOpts({
            proposal: i % 2 === 0 ? notesTray() : hostedTaskProposal(),
            sessionBound: true,
            authorActorId: ACTOR_A,
            approverActorId: ACTOR_A,
          })
        );
      }
      const elapsed = performance.now() - t0;
      assert.ok(elapsed < 2000, `eligibility loop too slow: ${elapsed}ms`);
    } finally {
      openSync.mock.restore();
    }
    // Hosted approve still has exactly one fetch helper for proposal GET
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    const approveFn = gw.slice(gw.indexOf('async function assertHostedProposalApproveDiscard'));
    const body = approveFn.slice(0, approveFn.indexOf('async function getNoteCountForUser'));
    const fetches = body.match(/fetchHostedProposalForSelfApply/g) || [];
    assert.equal(fetches.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 security — regression, N1 evasion, V3 overlap, S3.0, S4, S7, S10', () => {
  test('pre-fix replica true for shared-identity task fingerprint; fixed refuses', () => {
    // Widened-class construction: fingerprint + would-be task under shared identity
    const shared = notesTray({
      intent: SCOOLING_REVIEW_TRAY_INTENT,
    });
    const preOpts = {
      proposal: shared,
      hasVaultWrite: true,
      partitionOwned: true,
      role: 'member',
    };
    assert.equal(isPersonalSelfApplyClassPreFix(preOpts), true);

    const seamShared = {
      ...notesTray(),
      frontmatter: {
        knowtation_proposal_source: 'task',
        task_proposal_kind: 'task_create',
      },
    };
    // Pre-fix ignores seam markers → still true on fingerprint
    assert.equal(
      isPersonalSelfApplyClassPreFix({
        proposal: seamShared,
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      true
    );
    const fixed = personalSelfApplyRefusalReason({
      proposal: seamShared,
      hasVaultWrite: true,
      partitionOwned: true,
      role: 'member',
      sessionBound: false,
      authorActorId: ACTOR_A,
      approverActorId: ACTOR_A,
    });
    assert.ok(
      fixed === 'SELF_APPLY_SESSION_BINDING_REQUIRED' || fixed === 'SELF_APPLY_AUTHOR_MISMATCH',
      `expected session or mismatch, got ${fixed}`
    );
  });

  test('N1 evasion: omit proposal_kind, set knowtation_proposal_source + task_proposal_kind → seam', () => {
    const crafted = {
      status: 'proposed',
      frontmatter: {
        knowtation_proposal_source: 'task',
        task_proposal_kind: 'task_create',
        // deliberately no proposal_kind
      },
    };
    assert.equal(round1SeamByProposalKind(crafted), false, 'round-1 rule must miss this');
    assert.ok(normalizeCanisterProposalForTaskPrecheck(crafted) != null);
    assert.equal(isSeamSurfaceProposal(crafted), true);

    // intent omitted / renamed must not change classification
    assert.equal(isSeamSurfaceProposal({ ...crafted, intent: undefined }), true);
    assert.equal(isSeamSurfaceProposal({ ...crafted, intent: 'totally_unlisted' }), true);
    assert.equal(isSeamSurfaceProposal({ intent: 'totally_unlisted' }), false);
  });

  test('V3 overlap: fingerprint ∧ task markers → pre true, fixed seam code (not FINGERPRINT_MISMATCH)', () => {
    const overlap = {
      ...notesTray(),
      frontmatter: {
        knowtation_proposal_source: 'task',
        task_proposal_kind: 'task_create',
      },
    };
    assert.equal(matchesScoolingReviewTrayFingerprint(overlap), true);
    assert.equal(isSeamSurfaceProposal(overlap), true);
    assert.equal(
      isPersonalSelfApplyClassPreFix({
        proposal: overlap,
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
      }),
      true
    );
    const reason = personalSelfApplyRefusalReason({
      proposal: overlap,
      hasVaultWrite: true,
      partitionOwned: true,
      role: 'member',
      sessionBound: true,
      authorActorId: ACTOR_A,
      approverActorId: ACTOR_A,
    });
    assert.notEqual(reason, 'FINGERPRINT_MISMATCH');
    assert.ok(String(reason).startsWith('SELF_APPLY_'));
    assert.equal(reason, 'SELF_APPLY_NOT_ADMITTED');
  });

  test('S3.1 correspondence: each of seven conditions matches apply-path predicates', () => {
    const taskHosted = {
      frontmatter: { knowtation_proposal_source: 'task', task_proposal_kind: 'task_create' },
    };
    assert.ok(normalizeCanisterProposalForTaskPrecheck(taskHosted) != null);
    assert.equal(isSeamSurfaceProposal(taskHosted), true);

    const delHosted = {
      intent: 'delegation_consent_create',
      frontmatter: { knowtation_proposal_source: 'delegation', delegation_record_kind: 'consent' },
    };
    assert.equal(isDelegationProposalIntent(delHosted.intent), true);
    assert.ok(normalizeCanisterProposalForDelegationPrecheck(delHosted) != null);
    assert.equal(isSeamSurfaceProposal(delHosted), true);

    assert.equal(isSeamSurfaceProposal({ source: TASK_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: DELEGATION_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: MEDIA_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: FLOW_PROPOSAL_SOURCE }), true);
    assert.equal(isSeamSurfaceProposal({ source: FLOW_CAPTURE_PROPOSAL_SOURCE }), true);
  });

  test('S3.0 source-read: no SEAM_SURFACE_INTENTS / task_proposal_kind; no hub/gateway import (V10)', () => {
    const src = fs.readFileSync(SELF_APPLY_SRC, 'utf8');
    assert.equal(src.includes('SEAM_SURFACE_INTENTS'), false);
    assert.equal(src.includes('task_proposal_kind'), false);
    assert.equal(/from\s+['"].*hub\/gateway\//.test(src), false);
  });

  test('S10: ineligible sub refused on notes fingerprint; HTTP stays FORBIDDEN (N7)', () => {
    const sub = 'google:operator-shared';
    SELF_APPLY_INELIGIBLE_SUBS.add(sub);
    try {
      const reason = personalSelfApplyRefusalReason(
        baseEligibleOpts({ approverActorId: sub, authorActorId: sub, sessionBound: true })
      );
      assert.equal(reason, 'SELF_APPLY_SUBJECT_INELIGIBLE');
      assert.equal(isHttpVisibleSelfApplySeamCode(reason), false);
      const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
      const hub = fs.readFileSync(HUB_SRC, 'utf8');
      for (const s of [gw, hub]) {
        assert.match(s, /isHttpVisibleSelfApplySeamCode/);
        assert.match(s, /code:\s*['"]FORBIDDEN['"]/);
      }
    } finally {
      SELF_APPLY_INELIGIBLE_SUBS.delete(sub);
    }
  });

  test('S4: no client X-User-Id/X-Actor-Id as identity source; CORS advertisement removed', () => {
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    // Must not read req headers as actor identity for approve
    assert.equal(/req\.headers\[['\"]x-user-id['\"]\]/.test(gw), false);
    assert.equal(/req\.headers\[['\"]x-actor-id['\"]\]/.test(gw), false);
    const bridgeFiles = fs
      .readdirSync(BRIDGE_DIR)
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => fs.readFileSync(path.join(BRIDGE_DIR, f), 'utf8'));
    for (const src of bridgeFiles) {
      // Bridge sets X-User-Id toward canister (server-derived) — forbid reading client header as identity
      assert.equal(/req\.headers\[['\"]x-user-id['\"]\]\s*\|\|/.test(src), false);
      assert.equal(/const\s+\w+\s*=\s*req\.headers\[['\"]x-actor-id['\"]\]/.test(src), false);
    }
    const corsGw = fs.readFileSync(CORS_GW, 'utf8');
    const corsBr = fs.readFileSync(CORS_BRIDGE, 'utf8');
    assert.equal(corsGw.includes('X-User-Id'), false);
    assert.equal(corsBr.includes('Access-Control-Allow-Headers') && corsBr.includes('X-User-Id') === false || !/Access-Control-Allow-Headers',\s*'[^']*X-User-Id/.test(corsBr), true);
    assert.equal(/Access-Control-Allow-Headers',\s*'[^']*X-User-Id/.test(corsGw), false);
    assert.equal(/Access-Control-Allow-Headers',\s*'[^']*X-User-Id/.test(corsBr), false);
  });

  test('S7.3: gateway exposes no api/v1/attachments/* route', () => {
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    assert.equal(/app\.(get|post|put|patch|delete)\(['"`]\/?api\/v1\/attachments/.test(gw), false);
    assert.equal(/['"`]\/api\/v1\/attachments\//.test(gw) && /app\.(get|post)/.test(gw), false);
  });

  test('PROXY_HEADER_ALLOWLIST not widened (S4.4)', () => {
    const gw = fs.readFileSync(GATEWAY_SRC, 'utf8');
    const m = gw.match(/PROXY_HEADER_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(m, 'PROXY_HEADER_ALLOWLIST Set must exist');
    const body = m[1].toLowerCase();
    assert.equal(body.includes('x-user-id'), false);
    assert.equal(body.includes('x-actor-id'), false);
    assert.equal(body.includes('x-scooling-uid'), false);
  });
});

// ---------------------------------------------------------------------------
// Tier 7b — S10 empty-env (N13, V6)
// ---------------------------------------------------------------------------
describe('SEC-SEAM-1 7b — S10 empty-env keeps notes tray eligible', () => {
  test('pure parser empty shapes + notes eligible when ineligible set empty', () => {
    assert.equal(parseSelfApplyIneligibleSubs(undefined).size, 0);
    assert.equal(parseSelfApplyIneligibleSubs('').size, 0);
    assert.equal(parseSelfApplyIneligibleSubs(',, ').size, 0);
    // Module-load set ships empty under D3 (unless operator env set); ensure notes eligible
    // when approver is not on the set
    assert.equal(SELF_APPLY_INELIGIBLE_SUBS.has(ACTOR_A), false);
    assert.equal(
      personalSelfApplyRefusalReason(baseEligibleOpts({ approverActorId: ACTOR_A })),
      null
    );
  });
});
