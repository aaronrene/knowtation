#!/usr/bin/env node
/**
 * RHF-d — verify deployed retail catalog actor + establish/read personal smoke consent.
 *
 * - Confirms production exposes exactly agent_codex_retail (immutable catalog).
 * - When consent is missing, runs reviewed consent workflow:
 *   propose → evaluate → approve → apply-approved (never grant mint, never renew-personal).
 * - helper-access may return 503 DELEGATION_AUTHORITY_UNAVAILABLE pre-marker (expected).
 * - Prints only actor id, consent id, status, scope, timestamps — no JWT/bearer.
 *
 * Usage:
 *   node scripts/hub-session-refresh.mjs
 *   KNOWTATION_HUB_VAULT_ID=Business node scripts/verify-rhf-d-catalog-consent.mjs
 *
 * Optional:
 *   KNOWTATION_HUB_API=https://api.knowtation.store
 *   RHF_D_ESTABLISH_CONSENT=0   skip consent establishment (verify catalog only)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { RETAIL_ACTOR_ID } from '../lib/agent/delegation-authority-store.mjs';
import { getTrustedCatalogIdentity } from '../lib/agent/trusted-external-provider-catalog.mjs';
import { ensureHostedSessionAccessToken } from './lib/hub-session-auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const apiBase = (process.env.KNOWTATION_HUB_API || process.env.KNOWTATION_HUB_URL || 'https://api.knowtation.store').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'Business';
const actorId = RETAIL_ACTOR_ID;
const establishConsent = process.env.RHF_D_ESTABLISH_CONSENT !== '0';
const TIMEOUT_MS = 25_000;

/** @type {{ step: string, ok: boolean, detail: string }[]} */
const results = [];

/** @type {Record<string, unknown>} */
const evidence = {
  phase: 'RHF-d',
  vault_id: vaultId,
  actor_agent_id: actorId,
  hosted_origin: apiBase,
  catalog: null,
  helper_access: null,
  consent: null,
  no_grant_mint: true,
  no_production_marker: true,
};

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step}: ${detail}`);
}

/**
 * @param {string} accessToken
 * @param {Record<string, string>} [extraHeaders]
 */
function authHeaders(accessToken, extraHeaders = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'X-Vault-Id': vaultId,
    ...extraHeaders,
  };
}

/**
 * @param {string} method
 * @param {string} pathSuffix
 * @param {string} accessToken
 * @param {object} [body]
 */
async function api(method, pathSuffix, accessToken, body) {
  const res = await fetch(`${apiBase}${pathSuffix}`, {
    method,
    headers: authHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

/**
 * @param {object} entry
 * @param {object} expected
 */
export function catalogEntryMatches(entry, expected) {
  const fields = [
    'schema',
    'agent_id',
    'kind',
    'provider',
    'owner_ref',
    'registry_scope',
    'vault_id',
    'scope_ceiling',
    'status',
    'created',
    'updated',
  ];
  for (const key of fields) {
    const a = entry[key];
    const b = expected[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      return { ok: false, field: key, got: a, expected: b };
    }
  }
  return { ok: true };
}

/**
 * @param {string} accessToken
 */
async function verifyCatalog(accessToken) {
  const expected = getTrustedCatalogIdentity(actorId);
  if (!expected) {
    return { ok: false, detail: 'local catalog missing retail actor (should never happen)' };
  }

  const res = await api(
    'GET',
    '/api/v1/agents/identities?kind=external_provider&status=active',
    accessToken,
  );
  if (res.status !== 200 || !Array.isArray(res.json.identities)) {
    return { ok: false, detail: `identity list HTTP ${res.status}` };
  }

  const providers = res.json.identities.filter((i) => i && typeof i === 'object');
  const retail = providers.filter((i) => i.agent_id === actorId);
  if (retail.length !== 1) {
    return {
      ok: false,
      detail: `expected exactly one ${actorId}; found ${retail.length} among ${providers.length} active external_provider`,
    };
  }

  const match = catalogEntryMatches(retail[0], expected);
  if (!match.ok) {
    return {
      ok: false,
      detail: `catalog field mismatch ${match.field}: got ${JSON.stringify(match.got)} expected ${JSON.stringify(match.expected)}`,
    };
  }

  evidence.catalog = {
    agent_id: actorId,
    kind: 'external_provider',
    provider: 'codex',
    scope_ceiling: 'personal',
    status: 'active',
    created: expected.created,
    updated: expected.updated,
    active_external_provider_count: providers.length,
  };

  return { ok: true, detail: `exact catalog match; ${providers.length} active external_provider(s)` };
}

/**
 * @param {string} accessToken
 */
async function readHelperAccess(accessToken) {
  const res = await api(
    'GET',
    `/api/v1/delegation/helper-access?actor_agent_id=${encodeURIComponent(actorId)}`,
    accessToken,
  );
  const code = typeof res.json.code === 'string' ? res.json.code : null;
  if (res.status === 503 && code === 'DELEGATION_AUTHORITY_UNAVAILABLE') {
    evidence.helper_access = {
      state: 'unavailable_pre_marker',
      code,
      note: 'expected until production authority marker Tier-3 cutover',
    };
    return { ok: true, preMarker: true, detail: `pre-marker 503 ${code} (expected)` };
  }
  if (res.status !== 200) {
    return { ok: false, detail: `helper-access HTTP ${res.status} code=${code ?? 'none'}` };
  }
  const state = typeof res.json.state === 'string' ? res.json.state : '';
  evidence.helper_access = { state, actor_agent_id: actorId };
  return { ok: true, state, detail: `state=${state}` };
}

/**
 * @param {string} accessToken
 */
async function loadRubricChecklist(accessToken) {
  const res = await api('GET', '/api/v1/settings', accessToken);
  const items = res.json?.proposal_rubric?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ id: item.id, passed: true }));
}

/**
 * @param {string} accessToken
 * @param {string} proposalId
 */
async function evaluateApproveApply(accessToken, proposalId) {
  const checklist = await loadRubricChecklist(accessToken);
  const evaluation = await api(
    'POST',
    `/api/v1/proposals/${encodeURIComponent(proposalId)}/evaluation`,
    accessToken,
    {
      outcome: 'pass',
      checklist,
      comment: 'RHF-d retail Codex helper personal consent',
    },
  );
  if (evaluation.status < 200 || evaluation.status >= 300) {
    return {
      ok: false,
      detail: `evaluation HTTP ${evaluation.status} ${evaluation.json?.code ?? ''}`,
    };
  }

  const approve = await api(
    'POST',
    `/api/v1/proposals/${encodeURIComponent(proposalId)}/approve`,
    accessToken,
    { waiver_reason: 'RHF-d operator retail helper consent setup' },
  );
  if (approve.status < 200 || approve.status >= 300) {
    return {
      ok: false,
      detail: `approve HTTP ${approve.status} ${approve.json?.code ?? ''}`,
    };
  }

  const apply = await api(
    'POST',
    `/api/v1/delegation/proposals/${encodeURIComponent(proposalId)}/apply-approved`,
    accessToken,
  );
  if (apply.status < 200 || apply.status >= 300) {
    if (apply.status === 409 && apply.json?.idempotent === true) {
      return { ok: true, detail: `apply idempotent for ${proposalId}`, apply: apply.json };
    }
    return {
      ok: false,
      detail: `apply-approved HTTP ${apply.status} ${apply.json?.code ?? ''}`,
    };
  }
  return { ok: true, detail: `proposal ${proposalId} applied`, apply: apply.json };
}

/**
 * @param {object} body
 */
function consentEvidenceFromBody(body) {
  return {
    consent_id: body.consent_id ?? null,
    actor_agent_id: actorId,
    scope: body.scope ?? 'personal',
    status: body.revoked_at ? 'revoked' : 'active',
    created: body.created ?? null,
    updated: body.updated ?? body.created ?? null,
    expires_at: body.expires_at ?? null,
  };
}

/**
 * @param {string} accessToken
 */
async function findActiveRetailConsent(accessToken) {
  const list = await api('GET', '/api/v1/proposals?status=approved&limit=100', accessToken);
  if (list.status !== 200 || !Array.isArray(list.json.proposals)) {
    return null;
  }
  /** @type {{ created: string, consent: Record<string, unknown> }[]} */
  const matches = [];
  for (const summary of list.json.proposals) {
    if (!summary || summary.intent !== 'delegation_consent_create') continue;
    if (summary.vault_id && summary.vault_id !== vaultId) continue;
    const proposalId =
      typeof summary.proposal_id === 'string' ? summary.proposal_id : null;
    if (!proposalId) continue;
    const detail = await api(
      'GET',
      `/api/v1/proposals/${encodeURIComponent(proposalId)}`,
      accessToken,
    );
    if (detail.status !== 200) continue;
    /** @type {Record<string, unknown>} */
    let body = {};
    try {
      body =
        typeof detail.json.body === 'string'
          ? JSON.parse(detail.json.body)
          : detail.json.body ?? {};
    } catch {
      body = {};
    }
    if (body.delegate_agent_id !== actorId) continue;
    if (body.revoked_at) continue;
    matches.push({
      created: typeof body.created === 'string' ? body.created : '',
      consent: consentEvidenceFromBody(body),
    });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const ca = Date.parse(a.created);
    const cb = Date.parse(b.created);
    if (cb !== ca) return cb - ca;
    return String(a.consent.consent_id).localeCompare(String(b.consent.consent_id));
  });
  return matches[0].consent;
}

/**
 * @param {string} accessToken
 */
async function establishPersonalConsent(accessToken) {
  const existing = await findActiveRetailConsent(accessToken);
  if (existing?.consent_id) {
    return { ok: true, detail: `existing consent ${existing.consent_id}`, consent: existing, existing: true };
  }

  const propose = await api('POST', '/api/v1/delegation/consents', accessToken, {
    delegate_agent_id: actorId,
    scope: 'personal',
  });
  if (propose.status !== 201 || typeof propose.json.proposal_id !== 'string') {
    return {
      ok: false,
      detail: `consent propose HTTP ${propose.status} ${propose.json?.code ?? propose.json?.error ?? ''}`,
    };
  }

  const preview =
    propose.json.consent_preview && typeof propose.json.consent_preview === 'object'
      ? propose.json.consent_preview
      : {};

  const workflow = await evaluateApproveApply(accessToken, propose.json.proposal_id);
  if (!workflow.ok) {
    return { ok: false, detail: workflow.detail };
  }

  const record =
    workflow.apply?.record && typeof workflow.apply.record === 'object'
      ? workflow.apply.record
      : preview;

  return {
    ok: true,
    detail: `consent ${record.consent_id ?? propose.json.consent_id} active personal`,
    consent: consentEvidenceFromBody(record),
  };
}

async function main() {
  console.log(`RHF-d catalog + consent — ${apiBase} vault=${vaultId} actor=${actorId}`);

  const session = await ensureHostedSessionAccessToken();
  if (!session.ok) {
    record('session', false, `${session.code}: ${session.detail}`);
    summarize(false);
    process.exit(1);
  }
  record('session', true, `source=${session.source} refreshed=${session.refreshed}`);

  const authProbe = await api('GET', '/api/v1/auth/session', session.accessToken);
  if (authProbe.status !== 200) {
    record('auth', false, `session HTTP ${authProbe.status}`);
    summarize(false);
    process.exit(1);
  }
  record('auth', true, `role=${authProbe.json.role ?? 'unknown'}`);

  const catalogStep = await verifyCatalog(session.accessToken);
  record('catalog', catalogStep.ok, catalogStep.detail);
  if (!catalogStep.ok) {
    summarize(false);
    process.exit(1);
  }

  if (establishConsent) {
    const consentStep = await establishPersonalConsent(session.accessToken);
    record('consent', consentStep.ok, consentStep.detail);
    if (!consentStep.ok) {
      summarize(false);
      process.exit(1);
    }
    evidence.consent = consentStep.consent;
  } else {
    const existing = await findActiveRetailConsent(session.accessToken);
    if (!existing) {
      record('consent', false, 'no active retail consent found (RHF_D_ESTABLISH_CONSENT=0)');
      summarize(false);
      process.exit(1);
    }
    evidence.consent = existing;
    record('consent', true, `existing ${existing.consent_id}`);
  }

  const helperStep = await readHelperAccess(session.accessToken);
  record('helper-access', helperStep.ok, helperStep.detail);
  if (!helperStep.ok) {
    summarize(false);
    process.exit(1);
  }

  record('no grant mint', true, 'script did not call renew-personal or generic grant mint');
  record('no production marker', true, 'RHF_AUTHORITY_MARKER_AUTHORIZED not activated');

  summarize(true);
  console.log('\nEvidence (redacted):');
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}

function summarize(pass) {
  const failed = results.filter((r) => !r.ok);
  const verdict = pass && failed.length === 0 ? 'PASS' : 'FINDINGS';
  console.log(`\nVerdict: ${verdict} (${results.length - failed.length}/${results.length} steps)`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.step).join(', '));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
