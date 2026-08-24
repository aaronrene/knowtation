/**
 * Phase C + Lane D — unit tier: parse, hash, scopes, health fields, store envelope.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseAgentCredential,
  hashSecret,
  mintCredential,
  verifyCredential,
  recordCredentialFailure,
  listCredentialsForSub,
  agentScopesPermitMethod,
  assertAgentVaultAllowed,
  normalizeAgentRequestPath,
  AGENT_ACCESS_TTL_SECONDS,
  DEFAULT_AGENT_SCOPES,
  applyScopeCeiling,
} from '../hub/lib/agent-credential-core.mjs';
import {
  createAgentCredentialStore,
  AGENT_CREDENTIAL_STORE_INCONSISTENT,
} from '../hub/gateway/agent-credential-store.mjs';
import {
  subFromVerifiedPayload,
  isAgentAccessPayload,
  resolveActorTokenClass,
  mayApplyAdminAllowlistOverride,
} from '../hub/gateway/access-token-authz.mjs';
import { effectiveRequestPath } from '../hub/gateway/request-path.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hubJs = await readFile(path.join(__dirname, '../web/hub/hub.js'), 'utf8');
const hubHtml = await readFile(path.join(__dirname, '../web/hub/index.html'), 'utf8');

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
    // Express mount bug: suffix-only path must not authorize propose (getUserId uses effectiveRequestPath).
    assert.equal(agentScopesPermitMethod(scopes, 'POST', '/proposals'), false);
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

  it('effectiveRequestPath + subFromVerifiedPayload authorizes mounted /api/v1/proposals', () => {
    const payload = {
      sub: 'google:1',
      type: 'agent_access',
      typ: 'kt_agent_access',
      aud: 'knowtation-hub-rest',
      scopes: ['propose', 'vault:read'],
    };
    const req = { method: 'POST', baseUrl: '/api/v1', path: '/proposals', url: '/api/v1/proposals' };
    const pathOnly = effectiveRequestPath(req);
    assert.equal(pathOnly, '/api/v1/proposals');
    assert.equal(subFromVerifiedPayload(payload, { method: req.method, path: pathOnly }), 'google:1');
  });

  it('list includes revoked_at and last_failure fields', () => {
    const { records, credential, id } = mintCredential({}, {
      sub: 'google:1',
      name: 'health',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
      now: 1_000_000,
    });
    const bad = verifyCredential(records, credential.replace(/.$/, 'x'), { now: 1_000_001 });
    assert.equal(bad.ok, false);
    assert.ok(bad.records);
    const list = listCredentialsForSub(bad.records, 'google:1');
    assert.equal(list[0].id, id);
    assert.equal(list[0].revoked_at, null);
    assert.equal(list[0].last_failure_code, 'invalid');
    assert.equal(list[0].last_failure_at, 1_000_001);
  });

  it('success does not clear last_failure fields', () => {
    const { records, credential, id } = mintCredential({}, {
      sub: 'google:1',
      name: 'health2',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
      now: 1_000_000,
    });
    const failed = recordCredentialFailure(records, id, 'expired', 1_000_001);
    const ok = verifyCredential(failed, credential, { now: 1_000_002 });
    assert.equal(ok.ok, true);
    const list = listCredentialsForSub(ok.records, 'google:1');
    assert.equal(list[0].last_failure_code, 'expired');
    assert.equal(list[0].last_used_at, 1_000_002);
  });

  it('recordCredentialFailure no-ops on unknown id and bad reason', () => {
    const { records, id } = mintCredential({}, {
      sub: 'google:1',
      name: 'x',
      vault_ids: ['default'],
      scopes: ['propose', 'vault:read'],
    });
    const a = recordCredentialFailure(records, 'missing', 'invalid');
    assert.deepEqual(a, records);
    const b = recordCredentialFailure(records, id, 'bogus');
    assert.deepEqual(b, records);
  });

  it('meta nonempty_seen + empty data throws inconsistent; parse errors throw', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-agent-unit-'));
    process.env.KNOWTATION_GATEWAY_DATA_DIR = dir;
    try {
      await fs.writeFile(
        path.join(dir, 'hosted_agent_credentials.meta.json'),
        JSON.stringify({ schema_version: 1, nonempty_seen: true, count: 1, updated_at: Date.now() }),
        'utf8'
      );
      const store = createAgentCredentialStore();
      await assert.rejects(() => store.list('google:1'), (e) => e.code === AGENT_CREDENTIAL_STORE_INCONSISTENT);

      await fs.writeFile(path.join(dir, 'hosted_agent_credentials.json'), '{not json', 'utf8');
      await assert.rejects(
        () => store.list('google:1'),
        (e) => e && e.code === 'AGENT_CREDENTIAL_STORE_UNAVAILABLE'
      );
    } finally {
      delete process.env.KNOWTATION_GATEWAY_DATA_DIR;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('Hub UI source has agent-cred-store-banner and locked copy strings', () => {
    assert.ok(hubHtml.includes('id="agent-cred-store-banner"'));
    assert.ok(hubJs.includes('agent-cred-store-banner'));
    assert.ok(hubJs.includes('Agent credential store is inconsistent. Do not remint.'));
    assert.ok(hubJs.includes('Agent credential store is temporarily unavailable. Do not remint. Retry.'));
    assert.ok(hubJs.includes('Operator wipe required on the agent credential store.'));
    assert.ok(hubJs.includes('data.code'));
    assert.ok(hubJs.includes('data.store'));
  });
});
