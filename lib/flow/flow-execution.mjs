/**
 * Flow execution gate — run advancement, consent ledger, automatable orchestration stubs
 * (Phase 7A-L3b).
 *
 * Run operational state mutates in the flow store `runs[]`. Durable knowledge outcomes route
 * through proposals (review-before-write). External-agent grants (SD-5) never substitute for
 * execution consent (SD-6).
 *
 * `FLOW_RUN_WRITES_ENABLED` and `FLOW_AUTOMATABLE_EXECUTION_ENABLED` default **off**.
 *
 * @see docs/FLOW-EXECUTION-GATE-CONTRACT-7A-L3.md
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

import {
  loadFlowStore,
  saveFlowStore,
  getFlow,
  stepsForFlowVersion,
  FLOW_ID_RE,
  FLOW_RUN_ID_RE,
  FLOW_RUN_REF_RE,
  SEMVER_RE,
  buildFlowStepId,
  FLOW_RUN_SCHEMA,
  FLOW_RUN_LIST_SCHEMA,
  buildDefaultRunRef,
  isValidRunLookupKey,
  findVisibleRun,
  runForClient,
  listFlowRuns,
  getFlowRun,
} from './flow-store.mjs';
import { resolveFlowVisibleScopes } from './flow-scope.mjs';
import { hashActorLabel } from './external-agent.mjs';
import { FLOW_PROPOSAL_SOURCE, FLOW_REVIEW_QUEUE } from './flow-authoring.mjs';

export const FLOW_EXECUTION_POLICY_FILE = 'hub_flow_execution_policy.json';
export const FLOW_EXECUTION_CONSENTS_FILE = 'hub_flow_execution_consents.json';
export const FLOW_IN_FLIGHT_EXECUTIONS_FILE = 'hub_flow_in_flight_executions.json';

export { FLOW_RUN_SCHEMA, FLOW_RUN_LIST_SCHEMA, runForClient, listFlowRuns, getFlowRun };
export const FLOW_RUN_START_SCHEMA = 'knowtation.flow_run_start/v0';
export const FLOW_EXECUTION_CONSENT_SCHEMA = 'knowtation.flow_execution_consent/v0';
export const FLOW_EXECUTION_CONSENT_MINT_SCHEMA = 'knowtation.flow_execution_consent_mint/v0';
export const FLOW_EXECUTE_AUTOMATABLE_SCHEMA = 'knowtation.flow_execute_automatable/v0';

export const CONSENT_ID_PREFIX = 'fcons_';
export const EXECUTION_ID_PREFIX = 'fexec_';
export const DEFAULT_CONSENT_TTL_SECONDS = 3600;
export const MAX_CONSENT_TTL_SECONDS = 86400;
export const DEFAULT_COST_CAP_UNITS = 100;

/** Bounded skip reasons for manual advance (never free-text alone). */
export const FLOW_SKIP_REASONS = ['policy', 'not_applicable', 'blocked_dependency'];

/** Internal skill-ref kinds allowed for automatable execution (never external_tool). */
export const AUTOMATABLE_SKILL_KINDS = new Set(['mcp_prompt', 'skill_pack', 'cli']);

/** @typedef {import('./flow-scope.mjs').FlowScope} FlowScope */

/** @param {unknown} v */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * @param {string} dataDir
 * @returns {object}
 */
export function readFlowExecutionPolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, FLOW_EXECUTION_POLICY_FILE);
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
export function getFlowRunWritesEnabled(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_RUN_WRITES_ENABLED);
  if (fromEnv !== null) return fromEnv;
  const policy = readFlowExecutionPolicyFile(dataDir);
  if (typeof policy.flow_run_writes_enabled === 'boolean') {
    return policy.flow_run_writes_enabled;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowAutomatableExecutionEnabled(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_AUTOMATABLE_EXECUTION_ENABLED);
  if (fromEnv !== null) return fromEnv;
  const policy = readFlowExecutionPolicyFile(dataDir);
  const exec = policy.execution;
  if (exec && typeof exec === 'object' && typeof exec.automatable_enabled === 'boolean') {
    return exec.automatable_enabled;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowExecutionPolicyForbidden(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_EXECUTION_POLICY_FORBIDDEN);
  if (fromEnv !== null) return fromEnv;
  const policy = readFlowExecutionPolicyFile(dataDir);
  const exec = policy.execution;
  if (exec && typeof exec === 'object' && typeof exec.forbidden === 'boolean') {
    return exec.forbidden;
  }
  return false;
}

/**
 * @param {string} dataDir
 * @returns {{
 *   allowedLanes: Set<string>,
 *   defaultCostCapUnits: number,
 *   defaultTtlSeconds: number,
 *   maxTtlSeconds: number,
 *   automatableForbidden: boolean,
 * }}
 */
export function readVaultExecutionPolicy(dataDir) {
  const policy = readFlowExecutionPolicyFile(dataDir);
  const exec = policy.execution && typeof policy.execution === 'object' ? policy.execution : {};
  const lanes = new Set();
  if (Array.isArray(exec.allowed_lanes)) {
    for (const lane of exec.allowed_lanes) {
      if (typeof lane === 'string' && lane.trim()) lanes.add(lane.trim());
    }
  }
  if (lanes.size === 0) lanes.add('local_default');
  const defaultCostCapUnits =
    typeof exec.default_cost_cap_units === 'number' && exec.default_cost_cap_units > 0
      ? exec.default_cost_cap_units
      : DEFAULT_COST_CAP_UNITS;
  const defaultTtlSeconds =
    typeof exec.default_ttl_seconds === 'number' && exec.default_ttl_seconds > 0
      ? exec.default_ttl_seconds
      : DEFAULT_CONSENT_TTL_SECONDS;
  const maxTtlSeconds =
    typeof exec.max_ttl_seconds === 'number' && exec.max_ttl_seconds > 0
      ? exec.max_ttl_seconds
      : MAX_CONSENT_TTL_SECONDS;
  const automatableForbidden =
    typeof exec.automatable_forbidden === 'boolean' ? exec.automatable_forbidden : false;
  return {
    allowedLanes: lanes,
    defaultCostCapUnits,
    defaultTtlSeconds,
    maxTtlSeconds,
    automatableForbidden,
  };
}

/**
 * Import sandbox: reject bundles declaring non-manual automatable when policy forbids.
 *
 * @param {object[]} steps
 * @param {string} dataDir
 * @returns {{ ok: true } | { ok: false, denied: string[] }}
 */
export function validateImportAutomatableSteps(steps, dataDir) {
  const vaultPolicy = readVaultExecutionPolicy(dataDir);
  if (!vaultPolicy.automatableForbidden) return { ok: true };
  const denied = [];
  for (const step of steps) {
    if (step && step.automatable && step.automatable !== 'manual') {
      denied.push(step.step_id ?? 'unknown');
    }
  }
  if (denied.length > 0) return { ok: false, denied };
  return { ok: true };
}

/**
 * @param {object} consent
 * @returns {object}
 */
export function consentForClient(consent) {
  return {
    schema: FLOW_EXECUTION_CONSENT_SCHEMA,
    consent_id: consent.consent_id,
    vault_id: consent.vault_id,
    scope: consent.scope,
    run_id: consent.run_id,
    flow_id: consent.flow_id,
    flow_version: consent.flow_version,
    allowed_lanes: consent.allowed_lanes,
    cost_cap_units: consent.cost_cap_units,
    cost_consumed_units: consent.cost_consumed_units,
    actor_hash: consent.actor_hash,
    expires_at: consent.expires_at,
    revoked_at: consent.revoked_at ?? null,
  };
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
function consentsFilePath(dataDir) {
  return path.join(dataDir, FLOW_EXECUTION_CONSENTS_FILE);
}

/**
 * @param {string} dataDir
 * @returns {{ vaults: Record<string, { consents: object[] }> }}
 */
export function loadExecutionConsentsStore(dataDir) {
  const fp = consentsFilePath(dataDir);
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
 * @param {{ vaults: Record<string, { consents: object[] }> }} store
 */
export function saveExecutionConsentsStore(dataDir, store) {
  const fp = consentsFilePath(dataDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
function inFlightFilePath(dataDir) {
  return path.join(dataDir, FLOW_IN_FLIGHT_EXECUTIONS_FILE);
}

/**
 * @param {string} dataDir
 * @returns {{ entries: Record<string, object> }}
 */
export function loadInFlightExecutionsStore(dataDir) {
  const fp = inFlightFilePath(dataDir);
  if (!fs.existsSync(fp)) return { entries: {} };
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return { entries: {} };
    return { entries: j.entries && typeof j.entries === 'object' ? j.entries : {} };
  } catch {
    return { entries: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {{ entries: Record<string, object> }} store
 */
export function saveInFlightExecutionsStore(dataDir, store) {
  const fp = inFlightFilePath(dataDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @param {string} runId
 * @param {string} stepId
 * @param {string} consentId
 * @returns {string}
 */
export function inFlightExecutionKey(runId, stepId, consentId) {
  return `${runId}|${stepId}|${consentId}`;
}

/**
 * ModelRuntimeAdapter orchestration stub — bounded evidence pointer, no prompts/completions.
 *
 * @param {{ lane: string, dryRun?: boolean }} input
 * @returns {{ status: string, evidence_ref: string|null, cost_units: number }}
 */
export function runModelOrchestrationStub(input) {
  if (input.dryRun === true) {
    return { status: 'completed', evidence_ref: null, cost_units: 0 };
  }
  const hash = createHash('sha256')
    .update(`stub|${input.lane}|${Date.now()}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return { status: 'completed', evidence_ref: `hash_${hash}`, cost_units: 1 };
}

/**
 * @param {object[]} steps
 * @returns {boolean}
 */
export function stepHasForbiddenExternalTool(steps) {
  for (const step of steps) {
    if (!Array.isArray(step?.skill_refs)) continue;
    for (const ref of step.skill_refs) {
      if (ref && ref.kind === 'external_tool') return true;
    }
  }
  return false;
}

/**
 * @param {object} ctx
 * @returns {{ ok: false, status: number, error: string, code: string }}
 */
function refuse(status, code, error) {
  return { ok: false, status, error, code };
}

/**
 * @param {object} input
 * @returns {{ visibleScopes: Set<FlowScope>, ambiguous: boolean }}
 */
function resolveHandlerScopes(input) {
  if (input.ambiguous === true) {
    return { visibleScopes: new Set(['personal']), ambiguous: true };
  }
  if (input.visibleScopes instanceof Set) {
    return { visibleScopes: input.visibleScopes, ambiguous: false };
  }
  return resolveFlowVisibleScopes({
    dataDir: input.dataDir,
    userId: input.userId,
    vaultId: input.vaultId,
    role: input.role,
    cliScopes: input.cliScopes,
  });
}

/**
 * @param {object} vault
 * @param {string} flowId
 * @param {string} stepId
 * @param {string} flowVersion
 * @returns {object|null}
 */
function findStepDefinition(vault, flowId, stepId, flowVersion) {
  if (!vault || !Array.isArray(vault.steps)) return null;
  return stepsForFlowVersion(vault, flowId, flowVersion).find((s) => s.step_id === stepId) ?? null;
}

/**
 * @param {object} run
 * @param {object} stepDef
 * @param {object} stepState
 * @returns {boolean}
 */
function canMarkStepDone(stepDef, stepState) {
  if (!stepDef?.verification?.evidence_required) return true;
  return stepState.verified === true;
}

/**
 * @param {object[]} stepStates
 * @param {object[]} orderedSteps
 * @returns {number}
 */
export function frontierOrdinal(stepStates, orderedSteps) {
  const stateById = new Map(stepStates.map((s) => [s.step_id, s]));
  for (const step of orderedSteps) {
    const state = stateById.get(step.step_id);
    if (!state || state.status === 'pending' || state.status === 'in_progress') {
      return step.ordinal;
    }
    if (state.status !== 'done' && state.status !== 'skipped') {
      return step.ordinal;
    }
  }
  return orderedSteps.length > 0 ? orderedSteps[orderedSteps.length - 1].ordinal + 1 : 1;
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowRunListRequest(input) {
  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const flowId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
  if (flowId && !FLOW_ID_RE.test(flowId)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid flow id');
  }

  const scopeQuery = resolved.visibleScopes;
  const effectiveScope =
    scopeQuery.has('org') ? 'org' : scopeQuery.has('project') ? 'project' : 'personal';

  const payload = listFlowRuns(input.dataDir, input.vaultId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: resolved.visibleScopes,
    effectiveScope,
    flowId: flowId || undefined,
  });

  return { ok: true, payload };
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowRunGetRequest(input) {
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  if (!runId || !isValidRunLookupKey(runId)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid run id');
  }

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const payload = getFlowRun(input.dataDir, input.vaultId, runId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: resolved.visibleScopes,
  });

  if (!payload) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }

  return { ok: true, payload };
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowRunStartRequest(input) {
  if (getFlowExecutionPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Execution forbidden by policy');
  }
  if (!getFlowRunWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_RUN_WRITES_DISABLED', 'Run writes are disabled');
  }

  const flowId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
  const flowVersion = typeof input.flowVersion === 'string' ? input.flowVersion.trim() : '';
  if (!flowId || !FLOW_ID_RE.test(flowId)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid flow id');
  }
  if (!flowVersion || !SEMVER_RE.test(flowVersion)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid flow version');
  }

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const pinned = getFlow(input.dataDir, input.vaultId, flowId, {
    filterScopes: resolved.visibleScopes,
    version: flowVersion,
    starterDir: input.starterDir,
  });
  if (!pinned) {
    return refuse(404, 'unknown_flow', 'unknown_flow');
  }

  const store = loadFlowStore(input.dataDir);
  if (!store.vaults[input.vaultId]) {
    store.vaults[input.vaultId] = { flows: [], steps: [], runs: [], candidates: [], projections: [] };
  }
  const vault = store.vaults[input.vaultId];

  const stepStates = pinned.steps.map((step) => ({
    step_id: step.step_id,
    status: 'pending',
    evidence_ref: null,
    verified: false,
  }));

  const runId = `run_${randomBytes(8).toString('hex')}`;
  const actorHash = hashActorLabel(
    typeof input.actorLabel === 'string' ? input.actorLabel : input.userId ?? 'actor',
    input.vaultId,
    input.userId ?? '',
  );

  const explicitRunRef =
    typeof input.runRef === 'string' && FLOW_RUN_REF_RE.test(input.runRef.trim())
      ? input.runRef.trim()
      : null;

  /** @type {object} */
  const run = {
    schema: FLOW_RUN_SCHEMA,
    run_id: runId,
    run_ref: explicitRunRef ?? buildDefaultRunRef(runId),
    flow_id: flowId,
    flow_version: flowVersion,
    scope: pinned.flow.scope,
    status: 'in_progress',
    step_states: stepStates,
    started: new Date().toISOString(),
    provenance: {
      actor: actorHash,
      harness: typeof input.harness === 'string' ? input.harness.trim() : 'hub',
    },
    task_ref: typeof input.taskRef === 'string' && input.taskRef.trim() ? input.taskRef.trim() : null,
    external_ref:
      typeof input.externalRef === 'string' && input.externalRef.trim() ? input.externalRef.trim() : null,
  };

  vault.runs.push(run);
  saveFlowStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: FLOW_RUN_START_SCHEMA,
      run: runForClient(run),
    },
  };
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowRunAdvanceRequest(input) {
  if (getFlowExecutionPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Execution forbidden by policy');
  }
  if (!getFlowRunWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_RUN_WRITES_DISABLED', 'Run writes are disabled');
  }

  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const stepId = typeof input.stepId === 'string' ? input.stepId.trim() : '';
  const toStatus = typeof input.toStatus === 'string' ? input.toStatus.trim() : '';
  const validStatuses = ['in_progress', 'blocked', 'done', 'skipped'];
  if (!runId || !stepId || !validStatuses.includes(toStatus)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid advance request');
  }

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const store = loadFlowStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const runIdx = vault?.runs?.findIndex((r) => r.run_id === runId) ?? -1;
  if (!vault || runIdx < 0) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }
  const run = vault.runs[runIdx];
  if (!resolved.visibleScopes.has(run.scope)) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }
  if (run.status !== 'in_progress') {
    return refuse(409, 'FLOW_RUN_NOT_IN_PROGRESS', 'Run is not in progress');
  }

  const pinned = getFlow(input.dataDir, input.vaultId, run.flow_id, {
    filterScopes: resolved.visibleScopes,
    version: run.flow_version,
    starterDir: input.starterDir,
  });
  if (!pinned) {
    return refuse(404, 'unknown_flow', 'unknown_flow');
  }

  const stepDef = findStepDefinition(vault, run.flow_id, stepId, run.flow_version);
  if (!stepDef) {
    return refuse(400, 'BAD_REQUEST', 'Unknown step');
  }

  const frontier = frontierOrdinal(run.step_states, pinned.steps);
  if (stepDef.ordinal > frontier) {
    return refuse(409, 'FLOW_STEP_OUT_OF_ORDER', 'Step out of order');
  }

  if (toStatus === 'skipped') {
    const skipReason = typeof input.skipReason === 'string' ? input.skipReason.trim() : '';
    if (!FLOW_SKIP_REASONS.includes(skipReason)) {
      return refuse(400, 'BAD_REQUEST', 'skip_reason required for skipped status');
    }
  }

  const stateIdx = run.step_states.findIndex((s) => s.step_id === stepId);
  if (stateIdx < 0) {
    return refuse(400, 'BAD_REQUEST', 'Step not in run');
  }
  const stepState = run.step_states[stateIdx];

  if (toStatus === 'done' && !canMarkStepDone(stepDef, stepState)) {
    return refuse(403, 'FLOW_VERIFICATION_UNSATISFIED', 'Verification unsatisfied');
  }

  if (toStatus === 'in_progress') {
    for (const s of run.step_states) {
      if (s.status === 'in_progress' && s.step_id !== stepId) {
        return refuse(409, 'FLOW_STEP_OUT_OF_ORDER', 'Another step is in progress');
      }
    }
  }

  run.step_states[stateIdx] = {
    ...stepState,
    status: toStatus,
    evidence_ref: stepState.evidence_ref ?? null,
    verified: toStatus === 'done' ? stepState.verified === true : stepState.verified,
  };

  const allDone = run.step_states.every((s) => s.status === 'done' || s.status === 'skipped');
  if (allDone) {
    run.status = 'done';
  }

  vault.runs[runIdx] = run;
  saveFlowStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: FLOW_RUN_SCHEMA,
      run: runForClient(run),
    },
  };
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowRunEvidenceRequest(input) {
  if (getFlowExecutionPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Execution forbidden by policy');
  }
  if (!getFlowRunWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_RUN_WRITES_DISABLED', 'Run writes are disabled');
  }

  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const stepId = typeof input.stepId === 'string' ? input.stepId.trim() : '';
  const evidenceRef = typeof input.evidenceRef === 'string' ? input.evidenceRef.trim() : '';
  const pointerKind = typeof input.pointerKind === 'string' ? input.pointerKind.trim() : '';
  const validKinds = ['proposal', 'artifact', 'hash', 'test_result'];
  if (!runId || !stepId || !evidenceRef || !validKinds.includes(pointerKind)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid evidence request');
  }

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const store = loadFlowStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const runIdx = vault?.runs?.findIndex((r) => r.run_id === runId) ?? -1;
  if (!vault || runIdx < 0) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }
  const run = vault.runs[runIdx];
  if (!resolved.visibleScopes.has(run.scope)) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }

  const stepDef = findStepDefinition(vault, run.flow_id, stepId, run.flow_version);
  if (!stepDef) {
    return refuse(400, 'BAD_REQUEST', 'Unknown step');
  }

  const stateIdx = run.step_states.findIndex((s) => s.step_id === stepId);
  if (stateIdx < 0) {
    return refuse(400, 'BAD_REQUEST', 'Step not in run');
  }

  const verified =
    stepDef.verification?.kind !== 'human_review' && stepDef.verification?.evidence_required === true;

  run.step_states[stateIdx] = {
    ...run.step_states[stateIdx],
    evidence_ref: evidenceRef,
    verified: verified ? true : run.step_states[stateIdx].verified,
  };

  vault.runs[runIdx] = run;
  saveFlowStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: FLOW_RUN_SCHEMA,
      run: runForClient(run),
    },
  };
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowExecutionConsentMintRequest(input) {
  if (getFlowExecutionPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Execution forbidden by policy');
  }
  if (!getFlowAutomatableExecutionEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_AUTOMATABLE_EXECUTION_DISABLED', 'Automatable execution is disabled');
  }
  if (!getFlowRunWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_RUN_WRITES_DISABLED', 'Run writes are disabled');
  }

  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  if (!runId || !FLOW_RUN_ID_RE.test(runId)) {
    return refuse(400, 'BAD_REQUEST', 'Invalid run id');
  }

  const allowedLanesRaw = input.allowedLanes;
  if (!Array.isArray(allowedLanesRaw) || allowedLanesRaw.length === 0) {
    return refuse(400, 'BAD_REQUEST', 'allowed_lanes must be non-empty');
  }
  const allowedLanes = [...new Set(allowedLanesRaw.map((l) => (typeof l === 'string' ? l.trim() : '')).filter(Boolean))];
  if (allowedLanes.length === 0) {
    return refuse(400, 'BAD_REQUEST', 'allowed_lanes must be non-empty');
  }

  let costCap = input.costCapUnits;
  if (!Number.isInteger(costCap) || costCap < 1) {
    return refuse(400, 'BAD_REQUEST', 'cost_cap_units must be a positive integer');
  }

  const vaultPolicy = readVaultExecutionPolicy(input.dataDir);
  if (vaultPolicy.automatableForbidden) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Automatable steps forbidden');
  }

  for (const lane of allowedLanes) {
    if (!vaultPolicy.allowedLanes.has(lane)) {
      return refuse(403, 'FLOW_EXECUTION_LANE_DENIED', 'Lane not permitted');
    }
  }

  if (costCap > vaultPolicy.defaultCostCapUnits) {
    costCap = vaultPolicy.defaultCostCapUnits;
  }

  let ttlSeconds = input.ttlSeconds;
  if (ttlSeconds !== undefined && ttlSeconds !== null) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
      return refuse(400, 'BAD_REQUEST', 'ttl_seconds must be a positive integer');
    }
    if (ttlSeconds > vaultPolicy.maxTtlSeconds) {
      ttlSeconds = vaultPolicy.maxTtlSeconds;
    }
  } else {
    ttlSeconds = vaultPolicy.defaultTtlSeconds;
  }

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const store = loadFlowStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const run = findVisibleRun(vault, runId, resolved.visibleScopes);
  if (!run) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }

  const consentId = `${CONSENT_ID_PREFIX}${randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const actorHash = hashActorLabel(
    typeof input.actorLabel === 'string' ? input.actorLabel : input.userId ?? 'actor',
    input.vaultId,
    input.userId ?? '',
  );

  const consent = {
    schema: FLOW_EXECUTION_CONSENT_SCHEMA,
    consent_id: consentId,
    vault_id: input.vaultId,
    scope: run.scope,
    run_id: runId,
    flow_id: run.flow_id,
    flow_version: run.flow_version,
    allowed_lanes: allowedLanes,
    cost_cap_units: costCap,
    cost_consumed_units: 0,
    actor_hash: actorHash,
    expires_at: expiresAt,
    revoked_at: null,
  };

  const consentStore = loadExecutionConsentsStore(input.dataDir);
  if (!consentStore.vaults[input.vaultId]) {
    consentStore.vaults[input.vaultId] = { consents: [] };
  }
  consentStore.vaults[input.vaultId].consents.push(consent);
  saveExecutionConsentsStore(input.dataDir, consentStore);

  return {
    ok: true,
    payload: {
      schema: FLOW_EXECUTION_CONSENT_MINT_SCHEMA,
      consent: consentForClient(consent),
    },
  };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} consentId
 * @param {string} runId
 * @returns {object|null}
 */
export function findValidConsent(dataDir, vaultId, consentId, runId) {
  const store = loadExecutionConsentsStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault || !Array.isArray(vault.consents)) return null;
  const consent = vault.consents.find((c) => c.consent_id === consentId);
  if (!consent) return null;
  if (consent.revoked_at) return null;
  if (consent.run_id !== runId) return null;
  if (Date.parse(consent.expires_at) <= Date.now()) return null;
  return consent;
}

/**
 * @param {object} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowRunExecuteAutomatableRequest(input) {
  if (getFlowExecutionPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Execution forbidden by policy');
  }
  if (!getFlowAutomatableExecutionEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_AUTOMATABLE_EXECUTION_DISABLED', 'Automatable execution is disabled');
  }
  if (!getFlowRunWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_RUN_WRITES_DISABLED', 'Run writes are disabled');
  }

  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const stepId = typeof input.stepId === 'string' ? input.stepId.trim() : '';
  const consentId = typeof input.consentId === 'string' ? input.consentId.trim() : '';
  if (!runId || !stepId || !consentId) {
    return refuse(400, 'BAD_REQUEST', 'run_id, step_id, and consent_id are required');
  }

  const dryRun = input.dryRun === true;
  const modelLane =
    typeof input.modelLane === 'string' && input.modelLane.trim() ? input.modelLane.trim() : 'local_default';

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const vaultPolicy = readVaultExecutionPolicy(input.dataDir);
  if (vaultPolicy.automatableForbidden) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Automatable steps forbidden');
  }

  const consent = findValidConsent(input.dataDir, input.vaultId, consentId, runId);
  if (!consent) {
    const store = loadExecutionConsentsStore(input.dataDir);
    const vaultConsents = store.vaults[input.vaultId]?.consents ?? [];
    const any = vaultConsents.find((c) => c.consent_id === consentId);
    if (any && any.run_id !== runId) {
      return refuse(403, 'FLOW_EXECUTION_CONSENT_RUN_MISMATCH', 'Consent run mismatch');
    }
    return refuse(403, 'FLOW_EXECUTION_CONSENT_REQUIRED', 'Valid consent required');
  }

  if (!consent.allowed_lanes.includes(modelLane)) {
    return refuse(403, 'FLOW_EXECUTION_LANE_DENIED', 'Lane not in consent');
  }

  const inflightKey = inFlightExecutionKey(runId, stepId, consentId);
  const inflightStore = loadInFlightExecutionsStore(input.dataDir);
  const inflight = inflightStore.entries[inflightKey];
  if (inflight && inflight.status === 'in_flight') {
    return {
      ok: true,
      payload: {
        schema: FLOW_EXECUTE_AUTOMATABLE_SCHEMA,
        run: runForClient(inflight.run),
        execution: inflight.execution,
      },
    };
  }

  const store = loadFlowStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const runIdx = vault?.runs?.findIndex((r) => r.run_id === runId) ?? -1;
  if (!vault || runIdx < 0) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }
  const run = vault.runs[runIdx];
  if (!resolved.visibleScopes.has(run.scope)) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }
  if (run.status !== 'in_progress') {
    return refuse(409, 'FLOW_RUN_NOT_IN_PROGRESS', 'Run is not in progress');
  }

  const stepDef = findStepDefinition(vault, run.flow_id, stepId, run.flow_version);
  if (!stepDef) {
    return refuse(400, 'BAD_REQUEST', 'Unknown step');
  }
  if (stepDef.automatable !== 'automatable') {
    return refuse(400, 'FLOW_STEP_NOT_AUTOMATABLE', 'Step is not automatable');
  }

  if (stepDef.verification?.kind === 'human_review') {
    return refuse(403, 'FLOW_VERIFICATION_UNSATISFIED', 'human_review cannot be auto-verified');
  }

  const pinned = getFlow(input.dataDir, input.vaultId, run.flow_id, {
    filterScopes: resolved.visibleScopes,
    version: run.flow_version,
    starterDir: input.starterDir,
  });
  if (!pinned) {
    return refuse(404, 'unknown_flow', 'unknown_flow');
  }

  const frontier = frontierOrdinal(run.step_states, pinned.steps);
  const stateIdx = run.step_states.findIndex((s) => s.step_id === stepId);
  if (stateIdx < 0 || stepDef.ordinal > frontier) {
    return refuse(409, 'FLOW_STEP_OUT_OF_ORDER', 'Step out of order');
  }

  for (const ref of stepDef.skill_refs ?? []) {
    if (ref.kind === 'external_tool') {
      return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'external_tool not allowed on execution path');
    }
    if (!AUTOMATABLE_SKILL_KINDS.has(ref.kind)) {
      return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Skill ref kind not allowed');
    }
  }

  const projectedCost = dryRun ? 0 : 1;
  if (consent.cost_consumed_units + projectedCost > consent.cost_cap_units) {
    return refuse(403, 'FLOW_EXECUTION_COST_CAPPED', 'Cost cap exceeded');
  }

  const orchestration = runModelOrchestrationStub({ lane: modelLane, dryRun });
  const executionId = `${EXECUTION_ID_PREFIX}${randomBytes(12).toString('hex')}`;
  const completedAt = new Date().toISOString();

  const execution = {
    execution_id: executionId,
    step_id: stepId,
    status: orchestration.status,
    evidence_ref: orchestration.evidence_ref,
    cost_units: orchestration.cost_units,
    model_lane: modelLane,
    completed_at: completedAt,
  };

  if (!dryRun && orchestration.evidence_ref && stepDef.verification?.evidence_required) {
    run.step_states[stateIdx] = {
      ...run.step_states[stateIdx],
      evidence_ref: orchestration.evidence_ref,
      verified: stepDef.verification.kind !== 'human_review',
      status: run.step_states[stateIdx].status === 'pending' ? 'in_progress' : run.step_states[stateIdx].status,
    };
  }

  if (!dryRun) {
    consent.cost_consumed_units += orchestration.cost_units;
    const consentStore = loadExecutionConsentsStore(input.dataDir);
    const consentVault = consentStore.vaults[input.vaultId];
    if (consentVault) {
      const cIdx = consentVault.consents.findIndex((c) => c.consent_id === consentId);
      if (cIdx >= 0) {
        consentVault.consents[cIdx] = { ...consentVault.consents[cIdx], cost_consumed_units: consent.cost_consumed_units };
        saveExecutionConsentsStore(input.dataDir, consentStore);
      }
    }
    vault.runs[runIdx] = run;
    saveFlowStore(input.dataDir, store);
  }

  inflightStore.entries[inflightKey] = {
    status: 'in_flight',
    run,
    execution,
  };
  saveInFlightExecutionsStore(input.dataDir, inflightStore);

  return {
    ok: true,
    payload: {
      schema: FLOW_EXECUTE_AUTOMATABLE_SCHEMA,
      run: runForClient(run),
      execution,
    },
  };
}

/**
 * @param {object} input
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }>}
 */
export async function handleFlowRunSubmitReviewRequest(input) {
  if (getFlowExecutionPolicyForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_EXECUTION_POLICY_FORBIDDEN', 'Execution forbidden by policy');
  }
  if (!getFlowRunWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_RUN_WRITES_DISABLED', 'Run writes are disabled');
  }

  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const intent = typeof input.intent === 'string' ? input.intent.trim() : '';
  if (!runId || !intent) {
    return refuse(400, 'BAD_REQUEST', 'run_id and intent are required');
  }

  if (typeof input.createProposal !== 'function') {
    return refuse(500, 'RUNTIME_ERROR', 'createProposal is required');
  }

  const resolved = resolveHandlerScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  const store = loadFlowStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const run = findVisibleRun(vault, runId, resolved.visibleScopes);
  if (!run) {
    return refuse(404, 'unknown_run', 'unknown_run');
  }

  const proposal = await Promise.resolve(
    input.createProposal(input.dataDir, {
      intent,
      source: FLOW_PROPOSAL_SOURCE,
      review_queue: FLOW_REVIEW_QUEUE,
      external_ref: run.external_ref ?? undefined,
      body: JSON.stringify(
        { run_id: run.run_id, flow_id: run.flow_id, flow_version: run.flow_version },
        null,
        2,
      ),
      frontmatter: {
        type: 'flow_run_outcome',
        run_id: run.run_id,
        flow_id: run.flow_id,
        flow_version: run.flow_version,
      },
    }),
  );

  return {
    ok: true,
    payload: {
      schema: FLOW_RUN_SCHEMA,
      run: runForClient(run),
      proposal_id: proposal.proposal_id,
    },
  };
}

/**
 * MCP unified handler — action dispatch for flow_run tool.
 *
 * @param {object} input
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }>}
 */
export async function handleFlowRunMcpRequest(input) {
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  switch (action) {
    case 'start':
      return handleFlowRunStartRequest({
        ...input,
        flowId: input.flowId ?? input.flow_id,
        flowVersion: input.flowVersion ?? input.flow_version,
        taskRef: input.taskRef ?? input.task_ref,
        externalRef: input.externalRef ?? input.external_ref,
      });
    case 'get':
      return handleFlowRunGetRequest({
        ...input,
        runId: input.runId ?? input.run_id,
      });
    case 'list':
      return handleFlowRunListRequest({
        ...input,
        flowId: input.flowId ?? input.flow_id,
      });
    case 'advance':
      return handleFlowRunAdvanceRequest({
        ...input,
        runId: input.runId ?? input.run_id,
        stepId: input.stepId ?? input.step_id,
        toStatus: input.toStatus ?? input.to_status,
        skipReason: input.skipReason ?? input.skip_reason,
      });
    case 'evidence':
      return handleFlowRunEvidenceRequest({
        ...input,
        runId: input.runId ?? input.run_id,
        stepId: input.stepId ?? input.step_id,
        evidenceRef: input.evidenceRef ?? input.evidence_ref,
        pointerKind: input.pointerKind ?? input.pointer_kind,
      });
    case 'execute_automatable':
      return handleFlowRunExecuteAutomatableRequest({
        ...input,
        runId: input.runId ?? input.run_id,
        stepId: input.stepId ?? input.step_id,
        consentId: input.consentId ?? input.consent_id,
        modelLane: input.modelLane ?? input.model_lane,
        dryRun: input.dryRun ?? input.dry_run,
      });
    case 'submit_review':
      return handleFlowRunSubmitReviewRequest({
        ...input,
        runId: input.runId ?? input.run_id,
        intent: input.intent,
      });
    case 'consent_mint':
      return handleFlowExecutionConsentMintRequest({
        ...input,
        runId: input.runId ?? input.run_id,
        allowedLanes: input.allowedLanes ?? input.allowed_lanes,
        costCapUnits: input.costCapUnits ?? input.cost_cap_units,
        ttlSeconds: input.ttlSeconds ?? input.ttl_seconds,
      });
    default:
      return refuse(400, 'BAD_REQUEST', 'Unknown flow_run action');
  }
}

/**
 * @param {object[]} steps
 * @param {string} flowId
 * @param {string} [automatable]
 * @returns {object}
 */
export function makeAutomatableFlowBundle(steps, flowId = 'flow_automatable_test', automatable = 'automatable') {
  const version = '1.0.0';
  const stepId = buildFlowStepId(flowId, 1);
  return {
    flow: {
      schema: 'knowtation.flow/v0',
      flow_id: flowId,
      title: 'Automatable test flow',
      version,
      scope: 'personal',
      summary: 'Flow with automatable step for execution gate tests.',
      tags: ['test'],
      steps: [stepId],
      inputs: [],
      vault_mirror_path: `meta/flows/${flowId.replace(/^flow_/, '')}.md`,
      updated: '2026-06-20T00:00:00Z',
      truncated: false,
    },
    steps: steps ?? [
      {
        schema: 'knowtation.flow_step/v0',
        step_id: stepId,
        flow_id: flowId,
        ordinal: 1,
        owned_job: 'Summarize notes',
        instruction: 'Summarize the weekly notes into a brief.',
        trigger: 'On request',
        when_not_to_run: 'When no notes exist',
        boundaries: ['Read only — untrusted text'],
        skill_refs: [{ kind: 'cli', id: 'knowtation search' }],
        output_shape: 'A short brief',
        verification: {
          kind: 'artifact_exists',
          evidence_required: true,
          description: 'Brief artifact exists',
        },
        automatable,
      },
    ],
  };
}
