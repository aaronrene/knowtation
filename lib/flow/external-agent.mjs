/**
 * External-agent gate — scoped grants, vault tool allowlists, grant mint/revoke/list
 * (Phase 7A-L2b).
 *
 * Grants are server-minted `knowtation.flow_external_grant/v0` records. Tool
 * allowlists live in vault policy; `external_tool` skill-refs activate only when
 * grant + allowlist + approved canonical Flow version all match.
 *
 * `FLOW_EXTERNAL_AGENT_ENABLED` and `FLOW_HOSTED_PROJECTION_ENABLED` default **off**.
 *
 * @see docs/FLOW-EXTERNAL-AGENT-CONTRACT-7A-L2.md
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

import { getFlow } from './flow-store.mjs';
import { resolveFlowVisibleScopes } from './flow-scope.mjs';

export const FLOW_EXTERNAL_AGENT_POLICY_FILE = 'hub_flow_external_agent_policy.json';
export const FLOW_EXTERNAL_GRANTS_FILE = 'hub_flow_external_grants.json';
export const FLOW_EXTERNAL_GRANT_SCHEMA = 'knowtation.flow_external_grant/v0';
export const FLOW_EXTERNAL_GRANT_MINT_SCHEMA = 'knowtation.flow_external_grant_mint/v0';
export const GRANT_ID_PREFIX = 'fgrnt_';
export const GRANT_BEARER_PREFIX = 'fgrnt_bearer_';
export const DEFAULT_TTL_SECONDS = 3600;
export const MAX_TTL_SECONDS = 86400;
export const DEFAULT_MAX_INVOCATIONS = 100;

/** @typedef {import('./flow-scope.mjs').FlowScope} FlowScope */

/**
 * @param {unknown} v
 * @returns {boolean|null}
 */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * @param {string} dataDir
 * @returns {object}
 */
export function readFlowExternalAgentPolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, FLOW_EXTERNAL_AGENT_POLICY_FILE);
  try {
    if (!fs.existsSync(fp)) return {};
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowExternalAgentEnabled(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_EXTERNAL_AGENT_ENABLED);
  if (fromEnv !== null) return fromEnv;
  const policy = readFlowExternalAgentPolicyFile(dataDir);
  const ea = policy.external_agent;
  if (ea && typeof ea === 'object' && typeof ea.enabled === 'boolean') {
    return ea.enabled;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowHostedProjectionEnabled(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_HOSTED_PROJECTION_ENABLED);
  if (fromEnv !== null) return fromEnv;
  const policy = readFlowExternalAgentPolicyFile(dataDir);
  const ea = policy.external_agent;
  if (ea && typeof ea === 'object' && typeof ea.hosted_projection_enabled === 'boolean') {
    return ea.hosted_projection_enabled;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowExternalAgentPolicyForbidden(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_EXTERNAL_AGENT_FORBIDDEN);
  if (fromEnv !== null) return fromEnv;
  const policy = readFlowExternalAgentPolicyFile(dataDir);
  const ea = policy.external_agent;
  if (ea && typeof ea === 'object' && typeof ea.forbidden === 'boolean') {
    return ea.forbidden;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {{ allowedTools: Set<string>, defaultTtlSeconds: number, maxTtlSeconds: number, importPolicy: string }}
 */
export function readVaultExternalAgentPolicy(dataDir) {
  const policy = readFlowExternalAgentPolicyFile(dataDir);
  const ea = policy.external_agent && typeof policy.external_agent === 'object' ? policy.external_agent : {};
  const allowed = new Set();
  if (Array.isArray(ea.allowed_tools)) {
    for (const entry of ea.allowed_tools) {
      if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim()) {
        allowed.add(entry.id.trim());
      } else if (typeof entry === 'string' && entry.trim()) {
        allowed.add(entry.trim());
      }
    }
  }
  const defaultTtl =
    typeof ea.default_ttl_seconds === 'number' && ea.default_ttl_seconds > 0
      ? ea.default_ttl_seconds
      : DEFAULT_TTL_SECONDS;
  const maxTtl =
    typeof ea.max_ttl_seconds === 'number' && ea.max_ttl_seconds > 0
      ? ea.max_ttl_seconds
      : MAX_TTL_SECONDS;
  const importPolicy =
    typeof ea.import_policy === 'string' && ea.import_policy.trim()
      ? ea.import_policy.trim()
      : 'reject';
  return { allowedTools: allowed, defaultTtlSeconds: defaultTtl, maxTtlSeconds: maxTtl, importPolicy };
}

/**
 * @param {object[]} steps
 * @returns {Set<string>}
 */
export function collectFlowExternalToolRefs(steps) {
  const ids = new Set();
  for (const step of steps) {
    if (!Array.isArray(step?.skill_refs)) continue;
    for (const ref of step.skill_refs) {
      if (ref && ref.kind === 'external_tool' && typeof ref.id === 'string' && ref.id.trim()) {
        ids.add(ref.id.trim());
      }
    }
  }
  return ids;
}

/**
 * @param {Set<string>} flowToolRefs
 * @param {Set<string>} vaultAllowlist
 * @param {string[]} requested
 * @returns {string[]}
 */
export function intersectGrantTools(flowToolRefs, vaultAllowlist, requested) {
  const out = [];
  for (const id of requested) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed) continue;
    if (!flowToolRefs.has(trimmed)) continue;
    if (!vaultAllowlist.has(trimmed)) continue;
    out.push(trimmed);
  }
  return [...new Set(out)].sort();
}

/**
 * @param {Set<string>} flowToolRefs
 * @param {Set<string>} vaultAllowlist
 * @returns {string[]}
 */
export function computeBundleAllowedTools(flowToolRefs, vaultAllowlist) {
  const out = [];
  for (const id of flowToolRefs) {
    if (vaultAllowlist.has(id)) out.push(id);
  }
  return out.sort();
}

/**
 * @param {object[]} steps
 * @param {Set<string>} vaultAllowlist
 * @returns {{ ok: true } | { ok: false, denied: string[] }}
 */
export function validateImportExternalTools(steps, vaultAllowlist) {
  const refs = collectFlowExternalToolRefs(steps);
  const denied = [];
  for (const id of refs) {
    if (!vaultAllowlist.has(id)) denied.push(id);
  }
  if (denied.length > 0) return { ok: false, denied };
  return { ok: true };
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
function grantsFilePath(dataDir) {
  return path.join(dataDir, FLOW_EXTERNAL_GRANTS_FILE);
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { grants: object[] }> }}
 */
export function loadExternalGrantsStore(dataDir) {
  const fp = grantsFilePath(dataDir);
  if (!fs.existsSync(fp)) return { vaults: {} };
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return { vaults: {} };
    return { vaults: j.vaults && typeof j.vaults === 'object' ? j.vaults : {} };
  } catch {
    return { vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {{ vaults: Record<string, { grants: object[] }> }} store
 */
export function saveExternalGrantsStore(dataDir, store) {
  const fp = grantsFilePath(dataDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @param {string} bearer
 * @returns {string}
 */
export function hashGrantBearer(bearer) {
  return createHash('sha256').update(bearer, 'utf8').digest('hex');
}

/**
 * @param {string} actorLabel
 * @param {string} vaultId
 * @param {string} issuer
 * @returns {string}
 */
export function hashActorLabel(actorLabel, vaultId, issuer) {
  const payload = `${actorLabel}|${vaultId}|${issuer}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * @returns {string}
 */
function randomToken(prefix, byteLen = 16) {
  return prefix + randomBytes(byteLen).toString('base64url').replace(/[^a-z0-9_]/gi, '_').slice(0, 24);
}

/**
 * Strip internal fields from a stored grant for client responses.
 *
 * @param {object} stored
 * @returns {object}
 */
export function grantForClient(stored) {
  const {
    grant_bearer_hash: _b,
    ...grant
  } = stored;
  return grant;
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   flowId: string,
 *   flowVersion: string,
 *   requestedTools: string[],
 *   ttlSeconds?: number,
 *   actorLabel?: string,
 *   issuer?: string,
 * }} input
 * @returns {{ grant: object, bearer: string, expires_at: string }}
 */
export function mintExternalGrantRecord(input) {
  const vaultPolicy = readVaultExternalAgentPolicy(input.dataDir);
  const ttlRequested =
    typeof input.ttlSeconds === 'number' && input.ttlSeconds > 0
      ? Math.min(input.ttlSeconds, vaultPolicy.maxTtlSeconds)
      : vaultPolicy.defaultTtlSeconds;
  const ttl = Math.min(ttlRequested, vaultPolicy.maxTtlSeconds);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const grantId = randomToken(GRANT_ID_PREFIX);
  const bearer = randomToken(GRANT_BEARER_PREFIX, 24);
  const actorLabel = typeof input.actorLabel === 'string' ? input.actorLabel.trim() : '';
  const issuer = typeof input.issuer === 'string' ? input.issuer.trim() : '';
  const grant = {
    schema: FLOW_EXTERNAL_GRANT_SCHEMA,
    grant_id: grantId,
    vault_id: input.vaultId,
    scope: input.scope,
    flow_id: input.flowId,
    flow_version: input.flowVersion,
    allowed_tools: input.requestedTools,
    allowed_harnesses: ['agent_bundle'],
    expires_at: expiresAt,
    issued_at: now.toISOString(),
    revoked_at: null,
    actor_hash: hashActorLabel(actorLabel, input.vaultId, issuer),
    max_invocations: DEFAULT_MAX_INVOCATIONS,
    invocation_count: 0,
  };
  return {
    grant,
    bearer,
    expires_at: expiresAt,
    grant_bearer_hash: hashGrantBearer(bearer),
  };
}

/**
 * @param {object} ctx
 * @returns {{ ok: false, status: number, error: string, code: string }}
 */
function refuse(status, code, error) {
  return { ok: false, status, error, code };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   flowId: string,
 *   flowVersion: string,
 *   requestedTools: unknown,
 *   ttlSeconds?: number,
 *   actorLabel?: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   starterDir?: string,
 * }} input
 */
export function handleFlowExternalGrantMintRequest(input) {
  if (getFlowExternalAgentPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXTERNAL_AGENT_POLICY_FORBIDDEN', 'External agent forbidden by policy');
  }
  if (!getFlowExternalAgentEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_EXTERNAL_AGENT_DISABLED', 'External agent gate is disabled');
  }

  const flowId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
  const flowVersion = typeof input.flowVersion === 'string' ? input.flowVersion.trim() : '';
  if (!flowId || !flowVersion) {
    return refuse(400, 'BAD_REQUEST', 'flow_id and flow_version are required');
  }

  const requestedRaw = input.requestedTools;
  if (!Array.isArray(requestedRaw) || requestedRaw.length === 0) {
    return refuse(400, 'BAD_REQUEST', 'requested_tools must be a non-empty array');
  }
  const requestedTools = requestedRaw.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
  if (requestedTools.length === 0) {
    return refuse(400, 'BAD_REQUEST', 'requested_tools must be a non-empty array');
  }

  const resolved =
    input.visibleScopes instanceof Set
      ? { visibleScopes: input.visibleScopes, ambiguous: false }
      : input.ambiguous === true
        ? { visibleScopes: new Set(['personal']), ambiguous: true }
        : resolveFlowVisibleScopes({
            dataDir: input.dataDir,
            userId: input.userId,
            vaultId: input.vaultId,
            role: input.role,
            cliScopes: input.cliScopes,
          });
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const pinnedPayload = getFlow(input.dataDir, input.vaultId, flowId, {
    filterScopes: resolved.visibleScopes,
    version: flowVersion,
    starterDir: input.starterDir,
  });
  if (!pinnedPayload) {
    return refuse(404, 'unknown_flow', 'unknown_flow');
  }

  const flowToolRefs = collectFlowExternalToolRefs(pinnedPayload.steps);
  for (const tool of requestedTools) {
    if (!flowToolRefs.has(tool)) {
      return refuse(400, 'FLOW_EXTERNAL_TOOL_UNKNOWN', 'Tool not declared on flow steps');
    }
  }

  const vaultPolicy = readVaultExternalAgentPolicy(input.dataDir);
  for (const tool of requestedTools) {
    if (!vaultPolicy.allowedTools.has(tool)) {
      return refuse(403, 'FLOW_EXTERNAL_TOOL_DENIED', 'Tool not in vault allowlist');
    }
  }

  const allowed = intersectGrantTools(flowToolRefs, vaultPolicy.allowedTools, requestedTools);
  if (allowed.length === 0) {
    return refuse(403, 'FLOW_EXTERNAL_GRANT_DENIED', 'Grant denied');
  }

  const minted = mintExternalGrantRecord({
    dataDir: input.dataDir,
    vaultId: input.vaultId,
    flowId,
    flowVersion,
    requestedTools: allowed,
    scope: pinnedPayload.flow.scope,
    ttlSeconds: input.ttlSeconds,
    actorLabel: input.actorLabel,
    issuer: input.userId ?? '',
  });

  const store = loadExternalGrantsStore(input.dataDir);
  if (!store.vaults[input.vaultId]) store.vaults[input.vaultId] = { grants: [] };
  store.vaults[input.vaultId].grants.push({
    ...minted.grant,
    grant_bearer_hash: minted.grant_bearer_hash,
  });
  saveExternalGrantsStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: FLOW_EXTERNAL_GRANT_MINT_SCHEMA,
      grant: grantForClient(minted.grant),
      bearer: minted.bearer,
      expires_at: minted.expires_at,
    },
  };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   grantId: string,
 * }} input
 */
export function handleFlowExternalGrantRevokeRequest(input) {
  if (!getFlowExternalAgentEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_EXTERNAL_AGENT_DISABLED', 'External agent gate is disabled');
  }

  const grantId = typeof input.grantId === 'string' ? input.grantId.trim() : '';
  if (!grantId) {
    return refuse(400, 'BAD_REQUEST', 'grant_id is required');
  }

  const store = loadExternalGrantsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  if (!vault || !Array.isArray(vault.grants)) {
    return refuse(404, 'BAD_REQUEST', 'Grant not found');
  }

  const idx = vault.grants.findIndex((g) => g.grant_id === grantId);
  if (idx < 0) {
    return refuse(404, 'BAD_REQUEST', 'Grant not found');
  }

  vault.grants[idx] = {
    ...vault.grants[idx],
    revoked_at: new Date().toISOString(),
  };
  saveExternalGrantsStore(input.dataDir, store);

  return { ok: true, payload: grantForClient(vault.grants[idx]) };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   flowId?: string,
 * }} input
 */
export function handleFlowExternalGrantListRequest(input) {
  if (!getFlowExternalAgentEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_EXTERNAL_AGENT_DISABLED', 'External agent gate is disabled');
  }

  const store = loadExternalGrantsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const grants = vault && Array.isArray(vault.grants) ? vault.grants : [];
  const flowFilter = typeof input.flowId === 'string' ? input.flowId.trim() : '';

  const filtered = flowFilter
    ? grants.filter((g) => g.flow_id === flowFilter)
    : grants;

  return {
    ok: true,
    payload: {
      schema: 'knowtation.flow_external_grant_list/v0',
      vault_id: input.vaultId,
      grants: filtered.map(grantForClient),
    },
  };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   bearer: string,
 *   flowId?: string,
 *   flowVersion?: string,
 *   toolId?: string,
 * }} input
 * @returns {{ ok: true, grant: object } | { ok: false, status: number, code: string }}
 */
export function validateExternalGrantBearer(input) {
  if (!getFlowExternalAgentEnabled(input.dataDir)) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_AGENT_DISABLED' };
  }

  const bearer = typeof input.bearer === 'string' ? input.bearer.trim() : '';
  if (!bearer.startsWith(GRANT_BEARER_PREFIX)) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_DENIED' };
  }

  const hash = hashGrantBearer(bearer);
  const store = loadExternalGrantsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  if (!vault || !Array.isArray(vault.grants)) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_DENIED' };
  }

  const grant = vault.grants.find((g) => g.grant_bearer_hash === hash);
  if (!grant) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_DENIED' };
  }

  if (grant.revoked_at) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_REVOKED' };
  }

  const now = Date.now();
  const expires = Date.parse(grant.expires_at);
  if (!Number.isFinite(expires) || now > expires) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_EXPIRED' };
  }

  if (input.flowId && grant.flow_id !== input.flowId.trim()) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_FLOW_MISMATCH' };
  }

  if (input.flowVersion && grant.flow_version !== input.flowVersion.trim()) {
    return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_FLOW_MISMATCH' };
  }

  if (input.toolId) {
    const tool = input.toolId.trim();
    if (!Array.isArray(grant.allowed_tools) || !grant.allowed_tools.includes(tool)) {
      return { ok: false, status: 403, code: 'FLOW_EXTERNAL_GRANT_TOOL_DENIED' };
    }
    const vaultPolicy = readVaultExternalAgentPolicy(input.dataDir);
    if (!vaultPolicy.allowedTools.has(tool)) {
      return { ok: false, status: 403, code: 'FLOW_EXTERNAL_TOOL_DENIED' };
    }
  }

  return { ok: true, grant: grantForClient(grant) };
}

/**
 * Invoke stub — validates bearer; does not call real tool providers in v0.
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   toolId: string,
 *   bearer: string,
 *   flowId?: string,
 *   flowVersion?: string,
 * }} input
 */
export function handleFlowExternalToolInvokeRequest(input) {
  const toolId = typeof input.toolId === 'string' ? input.toolId.trim() : '';
  if (!toolId) {
    return refuse(400, 'BAD_REQUEST', 'tool_id is required');
  }

  const validation = validateExternalGrantBearer({
    dataDir: input.dataDir,
    vaultId: input.vaultId,
    bearer: input.bearer,
    flowId: input.flowId,
    flowVersion: input.flowVersion,
    toolId,
  });

  if (!validation.ok) {
    return refuse(validation.status, validation.code, validation.code);
  }

  const store = loadExternalGrantsStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const stored = vault?.grants?.find((g) => g.grant_id === validation.grant.grant_id);
  if (stored) {
    stored.invocation_count = (stored.invocation_count ?? 0) + 1;
    saveExternalGrantsStore(input.dataDir, store);
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.flow_external_tool_invoke/v0',
      tool_id: toolId,
      accepted: true,
      grant_id: validation.grant.grant_id,
    },
  };
}

/**
 * Whether `agent_bundle` harness is renderable (gate on).
 *
 * @param {string} dataDir
 * @returns {boolean}
 */
export function isAgentBundleHarnessActive(dataDir) {
  return getFlowExternalAgentEnabled(dataDir);
}
