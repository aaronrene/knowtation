/**
 * SEC-KN-3 — seven-tier coverage for mcp_access role cap + no agent self-apply.
 *
 * Frozen requirement: Pass 2 P6
 * (`~/scooling/docs/PRE-BUILD-SECURITY-AUDIT-FINDINGS-PASS2.md`) —
 * agent tokens must not inherit admin via HUB_ADMIN_USER_IDS allowlist;
 * agent tokens must never satisfy personal self-apply (human review only).
 *
 * Tiers: unit · integration · e2e · stress · data-integrity · performance · security
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  isMcpAccessPayload,
  roleFromMcpAccessScopes,
  roleFromVerifiedAccessPayload,
  mayApplyAdminAllowlistOverride,
  applyAdminAllowlistOverrideLegacy,
  subFromVerifiedPayload,
} from '../hub/gateway/access-token-authz.mjs';
import {
  roleEligibleForPersonalSelfApply,
  isPersonalSelfApplyClass,
  personalSelfApplyAllowsApprove,
  SCOOLING_REVIEW_TRAY_INTENT,
} from '../lib/hub-proposal-personal-self-apply.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'hub/gateway/server.mjs');
const AUTHZ_SRC = path.join(ROOT, 'hub/gateway/access-token-authz.mjs');
const SELF_APPLY_SRC = path.join(ROOT, 'lib/hub-proposal-personal-self-apply.mjs');

const ADMIN_SUB = 'google:admin-owner';
const MEMBER_SUB = 'google:learner';

/** Allowlist roleForSub: admin sub → admin, everyone else → member. */
function roleForSubAllowlist(sub) {
  return sub === ADMIN_SUB ? 'admin' : 'member';
}

/**
 * Pre-fix resolveHostedActorRole JWT path (Pass 2 P6) — elevates via roleForSub
 * and then applies the admin allowlist even for mcp_access.
 *
 * @param {object} payload
 * @param {(sub: string|null|undefined) => string} roleForSub
 * @returns {{ role: string, mayApproveProposals: boolean }}
 */
function resolveHostedActorRoleLegacy(payload, roleForSub) {
  let role = payload.role || roleForSub(payload.sub);
  role = applyAdminAllowlistOverrideLegacy(role, payload.sub, roleForSub);
  const mayApproveProposals = role === 'admin';
  return { role, mayApproveProposals };
}

/**
 * Fixed resolve path used by gateway for mcp_access / web JWTs.
 * @param {object} payload
 * @param {(sub: string|null|undefined) => string} roleForSub
 * @returns {{ role: string, mayApproveProposals: boolean, isMcpAccess: boolean }}
 */
function resolveHostedActorRoleFixed(payload, roleForSub) {
  const capped = roleFromVerifiedAccessPayload(payload, roleForSub);
  let role = capped.role;
  let mayApproveProposals =
    role === 'admin' || (role === 'evaluator' && false);
  if (
    mayApplyAdminAllowlistOverride(payload) &&
    payload.sub &&
    role !== 'admin' &&
    roleForSub(payload.sub) === 'admin'
  ) {
    role = 'admin';
    mayApproveProposals = true;
  }
  return { role, mayApproveProposals, isMcpAccess: capped.isMcpAccess };
}

function matchingProposal(overrides = {}) {
  return {
    status: 'proposed',
    intent: SCOOLING_REVIEW_TRAY_INTENT,
    external_ref: 'scooling.review:sec-kn-3',
    path: 'reviewed/sec-kn-3.md',
    review_severity: 'standard',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tier 1 — unit
// ---------------------------------------------------------------------------
describe('SEC-KN-3 unit — mcp_access role cap + human-actor gate', () => {
  test('roleFromMcpAccessScopes: vault:write alone is member; admin scopes elevate', () => {
    assert.equal(roleFromMcpAccessScopes(['vault:write']), 'member');
    assert.equal(roleFromMcpAccessScopes(['vault:read', 'vault:write']), 'member');
    assert.equal(roleFromMcpAccessScopes(['vault:read']), 'member');
    assert.equal(roleFromMcpAccessScopes(['admin']), 'admin');
    assert.equal(roleFromMcpAccessScopes(['vault:admin']), 'admin');
    assert.equal(roleFromMcpAccessScopes(undefined), 'member');
  });

  test('mcp_access admin-sub with vault:write does not inherit admin via roleForSub', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:write'],
    };
    const fixed = roleFromVerifiedAccessPayload(payload, roleForSubAllowlist);
    assert.equal(fixed.isMcpAccess, true);
    assert.equal(fixed.role, 'member');
    assert.equal(mayApplyAdminAllowlistOverride(payload), false);
  });

  test('web-session JWT still uses role claim / roleForSub', () => {
    const adminSession = { sub: ADMIN_SUB, role: 'admin' };
    assert.equal(roleFromVerifiedAccessPayload(adminSession, roleForSubAllowlist).role, 'admin');
    assert.equal(mayApplyAdminAllowlistOverride(adminSession), true);

    const memberNoRole = { sub: MEMBER_SUB };
    assert.equal(roleFromVerifiedAccessPayload(memberNoRole, roleForSubAllowlist).role, 'member');
  });

  test('roleEligibleForPersonalSelfApply rejects agent / mcp_access / humanActor:false', () => {
    assert.equal(roleEligibleForPersonalSelfApply('member'), true);
    assert.equal(roleEligibleForPersonalSelfApply('admin'), true);
    assert.equal(roleEligibleForPersonalSelfApply('member', { humanActor: false }), false);
    assert.equal(roleEligibleForPersonalSelfApply('member', { tokenType: 'mcp_access' }), false);
    assert.equal(roleEligibleForPersonalSelfApply('admin', { actorKind: 'agent' }), false);
    assert.equal(roleEligibleForPersonalSelfApply('member', { actorKind: 'human' }), true);
  });

  test('isMcpAccessPayload is strict on type claim', () => {
    assert.equal(isMcpAccessPayload({ type: 'mcp_access' }), true);
    assert.equal(isMcpAccessPayload({ type: 'web' }), false);
    assert.equal(isMcpAccessPayload(null), false);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — integration (gateway wiring + self-apply class)
// ---------------------------------------------------------------------------
describe('SEC-KN-3 integration — gateway wiring + self-apply class', () => {
  test('server.mjs imports roleFromVerifiedAccessPayload and skips allowlist for mcp_access', () => {
    const src = fs.readFileSync(SERVER_SRC, 'utf8');
    assert.ok(src.includes('roleFromVerifiedAccessPayload'));
    assert.ok(src.includes('mayApplyAdminAllowlistOverride'));
    assert.ok(src.includes('isMcpAccessPayload'));
    assert.ok(src.includes("tokenType: isMcpAccess ? 'mcp_access' : null"));
    assert.ok(src.includes('humanActor: !isMcpAccess'));
  });

  test('access-token-authz documents SEC-KN-3 / Pass 2 P6', () => {
    const src = fs.readFileSync(AUTHZ_SRC, 'utf8');
    assert.ok(src.includes('SEC-KN-3'));
    assert.ok(src.includes('Pass 2 P6'));
  });

  test('self-apply class false for mcp_access member with vault:write fingerprint', () => {
    assert.equal(
      isPersonalSelfApplyClass({
        proposal: matchingProposal(),
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
        tokenType: 'mcp_access',
        humanActor: false,
        actorKind: 'agent',
      }),
      false,
    );
    assert.equal(
      isPersonalSelfApplyClass({
        proposal: matchingProposal(),
        hasVaultWrite: true,
        partitionOwned: true,
        role: 'member',
        actorKind: 'human',
      }),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — e2e (full resolve + approve eligibility matrix)
// ---------------------------------------------------------------------------
describe('SEC-KN-3 e2e — resolve + approve eligibility matrix', () => {
  test('admin-sub mcp_access vault:write → member, no approve via admin, no self-apply', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:read', 'vault:write'],
    };
    const resolved = resolveHostedActorRoleFixed(payload, roleForSubAllowlist);
    assert.equal(resolved.role, 'member');
    assert.equal(resolved.mayApproveProposals, false);
    assert.equal(resolved.isMcpAccess, true);

    const canAdminApprove = resolved.role === 'admin' || resolved.mayApproveProposals;
    assert.equal(canAdminApprove, false);

    assert.equal(
      personalSelfApplyAllowsApprove({
        proposal: matchingProposal(),
        hasVaultWrite: true,
        partitionOwned: true,
        role: resolved.role,
        humanActor: !resolved.isMcpAccess,
        tokenType: resolved.isMcpAccess ? 'mcp_access' : null,
        actorKind: resolved.isMcpAccess ? 'agent' : 'human',
      }),
      false,
    );
  });

  test('web-session admin-sub still gets allowlist admin + mayApprove', () => {
    const payload = { sub: ADMIN_SUB };
    const resolved = resolveHostedActorRoleFixed(payload, roleForSubAllowlist);
    assert.equal(resolved.role, 'admin');
    assert.equal(resolved.mayApproveProposals, true);
    assert.equal(resolved.isMcpAccess, false);
  });

  test('mcp_access with explicit admin scope remains admin (scope-granted, not allowlist)', () => {
    const payload = {
      sub: MEMBER_SUB,
      type: 'mcp_access',
      scopes: ['vault:read', 'vault:write', 'admin'],
    };
    const resolved = resolveHostedActorRoleFixed(payload, roleForSubAllowlist);
    assert.equal(resolved.role, 'admin');
    assert.equal(resolved.mayApproveProposals, true);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — stress
// ---------------------------------------------------------------------------
describe('SEC-KN-3 stress — many mcp_access payloads stay non-admin', () => {
  test('1000 admin-sub vault:write tokens never inherit admin', () => {
    for (let i = 0; i < 1000; i++) {
      const payload = {
        sub: ADMIN_SUB,
        type: 'mcp_access',
        scopes: i % 2 === 0 ? ['vault:write'] : ['vault:read', 'vault:write'],
        jti: `stress-${i}`,
      };
      const resolved = resolveHostedActorRoleFixed(payload, roleForSubAllowlist);
      assert.equal(resolved.role, 'member');
      assert.equal(mayApplyAdminAllowlistOverride(payload), false);
      assert.equal(
        roleEligibleForPersonalSelfApply(resolved.role, {
          tokenType: 'mcp_access',
          humanActor: false,
        }),
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — data-integrity
// ---------------------------------------------------------------------------
describe('SEC-KN-3 data-integrity — no elevation side effects', () => {
  test('roleFromVerifiedAccessPayload does not mutate payload', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:write'],
    };
    const before = JSON.stringify(payload);
    roleFromVerifiedAccessPayload(payload, roleForSubAllowlist);
    assert.equal(JSON.stringify(payload), before);
  });

  test('REST identity for mcp_access vault:write still resolves sub (role is separate)', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:write'],
    };
    assert.equal(subFromVerifiedPayload(payload, { method: 'POST' }), ADMIN_SUB);
    assert.equal(roleFromVerifiedAccessPayload(payload, roleForSubAllowlist).role, 'member');
  });

  test('self-apply source documents human-actor / agent exclusion', () => {
    const src = fs.readFileSync(SELF_APPLY_SRC, 'utf8');
    assert.ok(src.includes('SEC-KN-3'));
    assert.ok(src.includes('mcp_access'));
    assert.ok(src.includes('humanActor'));
  });
});

// ---------------------------------------------------------------------------
// Tier 6 — performance
// ---------------------------------------------------------------------------
describe('SEC-KN-3 performance — bounded role resolve time', () => {
  test('10k roleFromVerifiedAccessPayload calls under 200ms', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:read', 'vault:write'],
    };
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      roleFromVerifiedAccessPayload(payload, roleForSubAllowlist);
      mayApplyAdminAllowlistOverride(payload);
      roleEligibleForPersonalSelfApply('member', { tokenType: 'mcp_access' });
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 200, `expected <200ms, got ${elapsed.toFixed(2)}ms`);
  });
});

// ---------------------------------------------------------------------------
// Tier 7 — security (regression must FAIL against pre-fix allowlist inheritance)
// ---------------------------------------------------------------------------
describe('SEC-KN-3 security — regression vs allowlist inheritance', () => {
  test('security regression: legacy elevates mcp_access admin-sub; fixed does not', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:write'],
    };
    const legacy = resolveHostedActorRoleLegacy(payload, roleForSubAllowlist);
    assert.equal(
      legacy.role,
      'admin',
      'sanity: pre-fix path still models allowlist inheritance for mcp_access',
    );
    assert.equal(legacy.mayApproveProposals, true);

    const fixed = resolveHostedActorRoleFixed(payload, roleForSubAllowlist);
    assert.equal(fixed.role, 'member');
    assert.notEqual(
      fixed.role,
      legacy.role,
      'fixed behavior must diverge from pre-fix allowlist inheritance',
    );
    assert.equal(fixed.mayApproveProposals, false);
  });

  test('security regression: legacy self-apply eligible for agent member; fixed rejects', () => {
    // Pre-fix: roleEligibleForPersonalSelfApply(role) with no human-actor test.
    function roleEligibleLegacy(role) {
      const r = String(role || '').trim();
      return r === 'member' || r === 'editor' || r === 'admin';
    }
    assert.equal(roleEligibleLegacy('member'), true, 'sanity: legacy allows member agents');

    assert.equal(
      roleEligibleForPersonalSelfApply('member', {
        tokenType: 'mcp_access',
        humanActor: false,
        actorKind: 'agent',
      }),
      false,
    );
    assert.notEqual(
      roleEligibleForPersonalSelfApply('member', {
        tokenType: 'mcp_access',
        humanActor: false,
      }),
      roleEligibleLegacy('member'),
      'fixed human-actor gate must diverge from pre-fix role-only check',
    );
  });

  test('discard / approve admin path: vault:write mcp_access on admin sub cannot discard', () => {
    const payload = {
      sub: ADMIN_SUB,
      type: 'mcp_access',
      scopes: ['vault:write'],
    };
    const fixed = resolveHostedActorRoleFixed(payload, roleForSubAllowlist);
    assert.notEqual(fixed.role, 'admin');
    // Discard requires role === 'admin' in assertHostedProposalApproveDiscard.
    assert.equal(fixed.role === 'admin', false);
  });
});
