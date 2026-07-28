/**
 * Phase C — unit tier: parse, hash, scopes, propose paths, aud checks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgentCredential,
  hashSecret,
  mintCredential,
  verifyCredential,
  agentScopesPermitMethod,
  assertAgentVaultAllowed,
  normalizeAgentRequestPath,
  AGENT_ACCESS_TTL_SECONDS,
  DEFAULT_AGENT_SCOPES,
  applyScopeCeiling,
} from '../hub/lib/agent-credential-core.mjs';
import {
  subFromVerifiedPayload,
  isAgentAccessPayload,
  resolveActorTokenClass,
  mayApplyAdminAllowlistOverride,
} from '../hub/gateway/access-token-authz.mjs';

describe('Phase C unit — agent credentials', () => {
  it('parses kt_agent_ wire format and rejects browser-style refresh', () => {
    const ok = parseAgentCredential('kt_agent_abc.def');
    assert.equal(ok.id, 'abc');
    assert.equal(ok.secret, 'def');
    assert.equal(parseAgentCredential('abc.def'), null);
    assert.equal(parseAgentCredential('kt_agent_'), null);
  });

  it('hashSecret is stable and non-reversible shape', () => {
    const h = hashSecret('secret');
    assert.equal(h, hashSecret('secret'));
    assert.notEqual(h, 'secret');
  });

  it('access TTL is 900s', () => {
    assert.equal(AGENT_ACCESS_TTL_SECONDS, 900);
  });

  it('default scopes are propose + vault:read', () => {
    assert.deepEqual([...DEFAULT_AGENT_SCOPES], ['propose', 'vault:read']);
  });

  it('mint + verify round-trip without consume-on-use', () => {
    const { records, credential, id } = mintCredential({}, {
      sub: 'google:1',
      name: 'trend',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
      now: 1_000_000,
    });
    const v1 = verifyCredential(records, credential, { now: 1_000_001 });
    assert.equal(v1.ok, true);
    assert.equal(v1.id, id);
    const v2 = verifyCredential(v1.records, credential, { now: 1_000_002 });
    assert.equal(v2.ok, true);
  });

  it('applyScopeCeiling keeps propose and drops write without role write', () => {
    const withWrite = applyScopeCeiling(['propose', 'vault:write'], ['vault:read', 'vault:write']);
    assert.ok(withWrite.includes('propose'));
    assert.ok(withWrite.includes('vault:write'));
    const capped = applyScopeCeiling(['propose', 'vault:write'], ['vault:read']);
    assert.deepEqual(capped, ['propose']);
    assert.throws(
      () => applyScopeCeiling(['vault:write'], ['vault:read']),
      (e) => e && e.code === 'AGENT_SCOPE_CEILING'
    );
  });

  it('agentScopesPermitMethod allows propose create paths only', () => {
    const scopes = ['propose', 'vault:read'];
    assert.equal(agentScopesPermitMethod(scopes, 'GET', '/api/v1/notes'), true);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', '/api/v1/proposals'), true);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', 'api/v1/proposals'), true);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', '/api/v1/notes'), false);
    assert.equal(agentScopesPermitMethod(scopes, 'POST', '/api/v1/proposals/x/approve'), false);
  });

  it('normalizeAgentRequestPath strips query and leading slash', () => {
    assert.equal(normalizeAgentRequestPath('/api/v1/proposals?x=1'), 'api/v1/proposals');
  });

  it('assertAgentVaultAllowed enforces vault_ids', () => {
    const payload = { type: 'agent_access', vault_ids: ['v1'] };
    assert.equal(assertAgentVaultAllowed(payload, 'v1'), true);
    assert.equal(assertAgentVaultAllowed(payload, 'default'), false);
    assert.equal(assertAgentVaultAllowed({ type: 'session' }, 'default'), true);
  });

  it('subFromVerifiedPayload requires aud+typ for agent_access', () => {
    const good = {
      sub: 'google:1',
      type: 'agent_access',
      typ: 'kt_agent_access',
      aud: 'knowtation-hub-rest',
      scopes: ['propose', 'vault:read'],
    };
    assert.equal(subFromVerifiedPayload(good, { method: 'POST', path: '/api/v1/proposals' }), 'google:1');
    assert.equal(
      subFromVerifiedPayload({ ...good, aud: 'wrong' }, { method: 'POST', path: '/api/v1/proposals' }),
      null
    );
    assert.equal(isAgentAccessPayload(good), true);
    assert.equal(resolveActorTokenClass(good), 'agent_access');
    assert.equal(mayApplyAdminAllowlistOverride(good), false);
  });
});
