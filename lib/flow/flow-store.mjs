/**
 * Local file-backed Flow store (Flow v0 — Phase 7A-10b, Option A calendar parity).
 *
 * Persists flow definitions, steps, runs, candidates, and projections per vault under
 * data_dir. Read-only list/get in v0; idempotent starter seed on first read.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md
 * @see docs/FLOW-V0-SPEC.md
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getRepoRoot } from '../repo-root.mjs';

export const FLOW_STORE_FILENAME = 'hub_flow_store.json';
export const STARTER_FLOWS_DIRNAME = 'flows/starter';

/** Parent segments from hub/bridge (or lib/flow) to bundled `flows/starter`. */
const STARTER_REL_FROM_MODULE = ['..', '..', 'flows', 'starter'];

/**
 * Resolve bundled starter Flow JSON directory (Netlify Lambda cwd-safe).
 *
 * @param {string | URL} [moduleUrl] `import.meta.url` of a module in this package
 * @returns {string}
 */
export function resolveStarterFlowsDir(moduleUrl) {
  if (moduleUrl) {
    const base = path.dirname(fileURLToPath(moduleUrl));
    return path.normalize(path.join(base, ...STARTER_REL_FROM_MODULE));
  }
  return path.join(getRepoRoot(), STARTER_FLOWS_DIRNAME);
}
export const MAX_FLOW_SUMMARIES = 200;
export const MAX_STEPS_PER_FLOW = 100;

export const FLOW_ID_RE = /^flow_[a-z0-9_]{1,64}$/;
export const FLOW_STEP_ID_RE = /^flow_[a-z0-9_]{1,64}#[1-9][0-9]*$/;
export const FLOW_RUN_ID_RE = /^run_[a-z0-9_]{1,48}$/;
/** Portable cross-system pointer (Scooling runRef / overseer lineage). */
export const FLOW_RUN_REF_RE = /^flow_run:[A-Za-z0-9._:-]{1,128}$/;
export const FLOW_CANDIDATE_ID_RE = /^cand_[a-z0-9]{4,32}$/;
export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const FLOW_RUN_SCHEMA = 'knowtation.flow_run/v0';
export const FLOW_RUN_LIST_SCHEMA = 'knowtation.flow_run_list/v0';
export const FLOW_RUN_GET_SCHEMA = 'knowtation.flow_run_get/v0';

/** Canonical overseer loopback pointer (9A-3 / P-FLOW seed). */
export const OVERSEER_FIXTURE_RUN_REF = 'flow_run:fixture-overseer-001';
export const MAX_FLOW_RUNS_LIST = 200;

/** @typedef {'personal'|'project'|'org'} FlowScope */

/**
 * @typedef {Object} StoredFlow
 * @property {'knowtation.flow/v0'} schema
 * @property {string} flow_id
 * @property {string} title
 * @property {string} version
 * @property {FlowScope} scope
 * @property {string} summary
 * @property {string[]} [tags]
 * @property {string[]} steps
 * @property {{ name: string, type: string, required: boolean }[]} [inputs]
 * @property {string|null} [vault_mirror_path]
 * @property {string} updated
 * @property {boolean} truncated
 */

/**
 * @typedef {Object} StoredFlowStep
 * @property {'knowtation.flow_step/v0'} schema
 * @property {string} step_id
 * @property {string} flow_id
 * @property {string} [flow_version] - store-internal parent semver (7A-10c); omitted on wire
 * @property {number} ordinal
 * @property {string} owned_job
 * @property {string} instruction
 * @property {string} trigger
 * @property {string} when_not_to_run
 * @property {{ kind: string, id: string }[]} [requires]
 * @property {string[]} boundaries
 * @property {{ kind: string, id: string }[]} [skill_refs]
 * @property {{ name: string, from: string }[]} [inputs]
 * @property {{ name: string, type: string }[]} [outputs]
 * @property {string} output_shape
 * @property {{ kind: string, evidence_required: boolean, description: string }} verification
 * @property {'manual'|'agent_assisted'|'automatable'} automatable
 */

/**
 * @typedef {Object} VaultFlowStore
 * @property {StoredFlow[]} flows
 * @property {StoredFlowStep[]} steps
 * @property {object[]} runs
 * @property {object[]} candidates
 * @property {object[]} projections
 * @property {object[]} tasks
 * @property {object[]} task_loops
 * @property {object[]} orchestrator_graphs
 */

/**
 * @typedef {Object} FlowStoreFile
 * @property {Record<string, VaultFlowStore>} vaults
 */

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getFlowStorePath(dataDir) {
  return path.join(dataDir, FLOW_STORE_FILENAME);
}

/**
 * @param {string} dataDir
 * @returns {FlowStoreFile}
 */
export function loadFlowStore(dataDir) {
  const filePath = getFlowStorePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { vaults: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { vaults: {} };
    }
    return /** @type {FlowStoreFile} */ (parsed);
  } catch {
    return { vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {FlowStoreFile} store
 */
export function saveFlowStore(dataDir, store) {
  const filePath = getFlowStorePath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {VaultFlowStore}
 */
export function getVaultFlowStore(dataDir, vaultId) {
  const store = loadFlowStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  } else if (!Array.isArray(store.vaults[vaultId].tasks)) {
    store.vaults[vaultId].tasks = [];
  }
  if (!Array.isArray(store.vaults[vaultId].task_loops)) {
    store.vaults[vaultId].task_loops = [];
  }
  if (!Array.isArray(store.vaults[vaultId].orchestrator_graphs)) {
    store.vaults[vaultId].orchestrator_graphs = [];
  }
  return store.vaults[vaultId];
}

/**
 * @param {string} flowId
 * @param {number} ordinal
 * @returns {string}
 */
export function buildFlowStepId(flowId, ordinal) {
  return `${flowId}#${ordinal}`;
}

/**
 * @param {string} version
 * @returns {[number, number, number]|null}
 */
export function parseSemver(version) {
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Stamp store-internal `flow_version` on validated steps before persistence.
 *
 * @param {StoredFlowStep[]} steps
 * @param {string} version
 * @returns {StoredFlowStep[]}
 */
export function stampStepsForStore(steps, version) {
  return steps.map((step) => ({ ...step, flow_version: version }));
}

/**
 * Migrate legacy 7A-10b step rows (no `flow_version`) into one row per
 * `(flow_id, version, step_id)` so prior stores remain readable.
 *
 * @param {VaultFlowStore} vault
 */
export function normalizeVaultSteps(vault) {
  if (!vault || !Array.isArray(vault.steps)) return;
  const legacy = vault.steps.filter((s) => !s.flow_version);
  if (legacy.length === 0) return;

  const kept = vault.steps.filter((s) => s.flow_version);
  /** @type {StoredFlowStep[]} */
  const migrated = [];

  for (const step of legacy) {
    const flowRows = vault.flows.filter(
      (f) => f.flow_id === step.flow_id && (f.steps ?? []).includes(step.step_id),
    );
    if (flowRows.length === 0) {
      const sole = vault.flows.find((f) => f.flow_id === step.flow_id);
      if (sole) migrated.push({ ...step, flow_version: sole.version });
      continue;
    }
    for (const flow of flowRows) {
      migrated.push({ ...step, flow_version: flow.version });
    }
  }

  const seen = new Set();
  /** @type {StoredFlowStep[]} */
  const deduped = [];
  for (const step of [...kept, ...migrated]) {
    const key = `${step.flow_id}\0${step.flow_version ?? ''}\0${step.step_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(step);
  }
  vault.steps = deduped;
}

/**
 * Return ordered steps for one `(flow_id, version)` pair (7A-10c).
 *
 * @param {VaultFlowStore} vault
 * @param {string} flowId
 * @param {string} version
 * @returns {StoredFlowStep[]}
 */
export function stepsForFlowVersion(vault, flowId, version) {
  normalizeVaultSteps(vault);
  const versionsForFlow = vault.flows.filter((f) => f.flow_id === flowId).map((f) => f.version);
  const legacySingleVersion = versionsForFlow.length === 1 && versionsForFlow[0] === version;
  return vault.steps
    .filter((s) => {
      if (s.flow_id !== flowId) return false;
      if (s.flow_version === version) return true;
      return !s.flow_version && legacySingleVersion;
    })
    .sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * @param {unknown} scope
 * @returns {scope is FlowScope}
 */
function isFlowScope(scope) {
  return scope === 'personal' || scope === 'project' || scope === 'org';
}

/**
 * Validate a starter bundle against FLOW-V0-SPEC §1 anatomy rules.
 *
 * @param {{ flow?: unknown, steps?: unknown }} bundle
 * @returns {{ ok: true, flow: StoredFlow, steps: StoredFlowStep[] } | { ok: false, reason: string }}
 */
export function validateFlowBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, reason: 'bundle must be an object' };
  }
  const flow = /** @type {Record<string, unknown>} */ (bundle.flow);
  const stepsRaw = bundle.steps;
  if (!flow || typeof flow !== 'object') {
    return { ok: false, reason: 'bundle.flow is required' };
  }
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return { ok: false, reason: 'bundle.steps must be a non-empty array' };
  }

  const flowId = flow.flow_id;
  if (typeof flowId !== 'string' || !FLOW_ID_RE.test(flowId)) {
    return { ok: false, reason: 'invalid flow_id' };
  }
  if (flow.schema !== 'knowtation.flow/v0') {
    return { ok: false, reason: 'flow.schema must be knowtation.flow/v0' };
  }
  if (typeof flow.title !== 'string' || !flow.title.trim()) {
    return { ok: false, reason: 'flow.title is required' };
  }
  if (typeof flow.version !== 'string' || !SEMVER_RE.test(flow.version)) {
    return { ok: false, reason: 'flow.version must be semver' };
  }
  if (!isFlowScope(flow.scope)) {
    return { ok: false, reason: 'flow.scope must be personal|project|org' };
  }
  if (typeof flow.summary !== 'string') {
    return { ok: false, reason: 'flow.summary is required' };
  }
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    return { ok: false, reason: 'flow.steps must be a non-empty array' };
  }
  if (typeof flow.updated !== 'string' || !flow.updated.trim()) {
    return { ok: false, reason: 'flow.updated is required' };
  }
  if (typeof flow.truncated !== 'boolean') {
    return { ok: false, reason: 'flow.truncated must be boolean' };
  }

  /** @type {StoredFlowStep[]} */
  const steps = [];
  const stepIds = new Set();

  for (const raw of stepsRaw) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, reason: 'each step must be an object' };
    }
    const step = /** @type {Record<string, unknown>} */ (raw);
    if (step.schema !== 'knowtation.flow_step/v0') {
      return { ok: false, reason: 'step.schema must be knowtation.flow_step/v0' };
    }
    if (typeof step.step_id !== 'string' || !FLOW_STEP_ID_RE.test(step.step_id)) {
      return { ok: false, reason: 'invalid step_id' };
    }
    if (step.flow_id !== flowId) {
      return { ok: false, reason: 'step.flow_id must match flow.flow_id' };
    }
    if (typeof step.ordinal !== 'number' || !Number.isInteger(step.ordinal) || step.ordinal < 1) {
      return { ok: false, reason: 'step.ordinal must be a 1-based integer' };
    }
    if (buildFlowStepId(flowId, step.ordinal) !== step.step_id) {
      return { ok: false, reason: 'step_id must equal flow_id#ordinal' };
    }
    if (typeof step.owned_job !== 'string' || !step.owned_job.trim()) {
      return { ok: false, reason: 'step.owned_job is required' };
    }
    if (typeof step.instruction !== 'string' || !step.instruction.trim()) {
      return { ok: false, reason: 'step.instruction is required' };
    }
    if (typeof step.trigger !== 'string' || !step.trigger.trim()) {
      return { ok: false, reason: 'step.trigger is required (anatomy completeness)' };
    }
    if (typeof step.when_not_to_run !== 'string' || !step.when_not_to_run.trim()) {
      return { ok: false, reason: 'step.when_not_to_run is required (anatomy completeness)' };
    }
    if (!Array.isArray(step.boundaries)) {
      return { ok: false, reason: 'step.boundaries must be an array' };
    }
    if (typeof step.output_shape !== 'string' || !step.output_shape.trim()) {
      return { ok: false, reason: 'step.output_shape is required (anatomy completeness)' };
    }
    const verification = step.verification;
    if (!verification || typeof verification !== 'object') {
      return { ok: false, reason: 'step.verification is required (anatomy completeness)' };
    }
    const ver = /** @type {Record<string, unknown>} */ (verification);
    if (typeof ver.kind !== 'string' || !ver.kind.trim()) {
      return { ok: false, reason: 'step.verification.kind is required' };
    }
    if (typeof ver.evidence_required !== 'boolean') {
      return { ok: false, reason: 'step.verification.evidence_required must be boolean' };
    }
    if (typeof ver.description !== 'string' || !ver.description.trim()) {
      return { ok: false, reason: 'step.verification.description is required' };
    }
    if (step.automatable !== 'manual' && step.automatable !== 'agent_assisted' && step.automatable !== 'automatable') {
      return { ok: false, reason: 'step.automatable must be manual|agent_assisted|automatable' };
    }
    if (stepIds.has(step.step_id)) {
      return { ok: false, reason: 'duplicate step_id' };
    }
    stepIds.add(step.step_id);
    steps.push(/** @type {StoredFlowStep} */ (step));
  }

  for (const ref of flow.steps) {
    if (typeof ref !== 'string' || !stepIds.has(ref)) {
      return { ok: false, reason: 'flow.steps references missing step_id' };
    }
  }

  const orderedStepIds = [...steps].sort((a, b) => a.ordinal - b.ordinal).map((s) => s.step_id);
  if (JSON.stringify(flow.steps) !== JSON.stringify(orderedStepIds)) {
    return { ok: false, reason: 'flow.steps must list step ids in ascending ordinal order' };
  }

  /** @type {StoredFlow} */
  const storedFlow = {
    schema: 'knowtation.flow/v0',
    flow_id: flowId,
    title: flow.title,
    version: flow.version,
    scope: flow.scope,
    summary: flow.summary,
    tags: Array.isArray(flow.tags) ? flow.tags.filter((t) => typeof t === 'string') : [],
    steps: flow.steps,
    inputs: Array.isArray(flow.inputs) ? flow.inputs : [],
    vault_mirror_path: typeof flow.vault_mirror_path === 'string' ? flow.vault_mirror_path : null,
    updated: flow.updated,
    truncated: flow.truncated,
  };

  return { ok: true, flow: storedFlow, steps };
}

/**
 * Idempotently seed canonical starter flows from flows/starter/.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string, onReject?: (name: string, reason: string) => void }} [options]
 * @returns {{ seeded: number, skipped: number }}
 */
export function seedStarterFlows(dataDir, vaultId, options = {}) {
  const starterDir = options.starterDir ?? path.join(getRepoRoot(), STARTER_FLOWS_DIRNAME);
  const onReject = options.onReject ?? ((name, reason) => {
    console.warn(`[flow-store] rejected starter bundle ${name}: ${reason}`);
  });

  if (!fs.existsSync(starterDir)) {
    return { seeded: 0, skipped: 0 };
  }

  const store = loadFlowStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  }
  const vault = store.vaults[vaultId];

  let seeded = 0;
  let skipped = 0;

  const files = fs.readdirSync(starterDir).filter((f) => f.startsWith('flow_') && f.endsWith('.json')).sort();
  for (const file of files) {
    let bundle;
    try {
      bundle = JSON.parse(fs.readFileSync(path.join(starterDir, file), 'utf8'));
    } catch {
      onReject(file, 'invalid JSON');
      continue;
    }

    const validated = validateFlowBundle(bundle);
    if (!validated.ok) {
      onReject(file, validated.reason);
      continue;
    }

    const { flow, steps } = validated;
    const exists = vault.flows.some((f) => f.flow_id === flow.flow_id && f.version === flow.version);
    if (exists) {
      skipped += 1;
      continue;
    }

    vault.flows.push(flow);
    for (const step of stampStepsForStore(steps, flow.version)) {
      const stepExists = vault.steps.some(
        (s) => s.flow_id === flow.flow_id && s.flow_version === flow.version && s.step_id === step.step_id,
      );
      if (!stepExists) {
        vault.steps.push(step);
      }
    }
    seeded += 1;
  }

  if (seeded > 0) {
    saveFlowStore(dataDir, store);
  }

  return { seeded, skipped };
}

/**
 * Lazy-seed missing starter Flows.
 *
 * Always calls {@link seedStarterFlows} (idempotent per flow_id+version). Do **not**
 * skip when the vault already has other flows — hosted Business vaults often have
 * authored drafts while starters were never imported (SMOKE: Start run → unknown_flow).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ starterDir?: string }} [options]
 */
function ensureStarterSeed(dataDir, vaultId, options = {}) {
  seedStarterFlows(dataDir, vaultId, options);
}

/**
 * @param {StoredFlow} flow
 * @param {number} stepCount
 * @returns {object}
 */
export function flowSummaryForClient(flow, stepCount) {
  return {
    schema: 'knowtation.flow/v0',
    flow_id: flow.flow_id,
    title: flow.title,
    version: flow.version,
    scope: flow.scope,
    summary: flow.summary,
    tags: flow.tags ?? [],
    step_count: stepCount,
    updated: flow.updated,
    truncated: flow.truncated,
  };
}

/**
 * @param {StoredFlow} flow
 * @param {StoredFlowStep[]} steps
 * @returns {{ flow: object, steps: object[] }}
 */
export function flowDefinitionForClient(flow, steps) {
  return {
    flow: {
      schema: flow.schema,
      flow_id: flow.flow_id,
      title: flow.title,
      version: flow.version,
      scope: flow.scope,
      summary: flow.summary,
      tags: flow.tags ?? [],
      steps: flow.steps,
      inputs: flow.inputs ?? [],
      vault_mirror_path: flow.vault_mirror_path ?? null,
      updated: flow.updated,
      truncated: flow.truncated,
    },
    steps: steps.map((step) => ({
      schema: step.schema,
      step_id: step.step_id,
      flow_id: step.flow_id,
      ordinal: step.ordinal,
      owned_job: step.owned_job,
      instruction: step.instruction,
      trigger: step.trigger,
      when_not_to_run: step.when_not_to_run,
      requires: step.requires ?? [],
      boundaries: step.boundaries,
      skill_refs: step.skill_refs ?? [],
      inputs: step.inputs ?? [],
      outputs: step.outputs ?? [],
      output_shape: step.output_shape,
      verification: step.verification,
      automatable: step.automatable,
    })),
  };
}

/**
 * @param {VaultFlowStore} vault
 * @param {string} flowId
 * @param {string} version
 * @returns {number}
 */
function countStepsForFlow(vault, flowId, version) {
  return stepsForFlowVersion(vault, flowId, version).length;
}

/**
 * List scope-visible flows (content-minimized).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   visibleScopes?: Set<FlowScope>,
 *   filterScopes?: Set<FlowScope>,
 *   effectiveScope: FlowScope,
 *   tag?: string,
 *   limit?: number,
 *   starterDir?: string,
 * }} query
 * @returns {{ schema: 'knowtation.flow_list/v0', vault_id: string, effective_scope: FlowScope, flows: object[], truncated: boolean }}
 */
export function listFlows(dataDir, vaultId, query) {
  ensureStarterSeed(dataDir, vaultId, { starterDir: query.starterDir });

  const visibleScopes = query.visibleScopes ?? query.filterScopes ?? new Set(['personal']);
  const filterScopes = query.filterScopes ?? visibleScopes;
  const tag = typeof query.tag === 'string' && query.tag.trim() ? query.tag.trim() : '';
  let limit = typeof query.limit === 'number' ? query.limit : MAX_FLOW_SUMMARIES;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_FLOW_SUMMARIES;
  if (limit > MAX_FLOW_SUMMARIES) limit = MAX_FLOW_SUMMARIES;

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId] ?? {
    flows: [],
    steps: [],
    runs: [],
    candidates: [],
    projections: [],
    tasks: [],
    task_loops: [],
    orchestrator_graphs: [],
  };

  /** @type {Map<string, StoredFlow>} */
  const latestById = new Map();
  for (const flow of vault.flows) {
    if (!filterScopes.has(flow.scope)) continue;
    if (tag && !(flow.tags ?? []).includes(tag)) continue;
    const parsed = parseSemver(flow.version);
    if (!parsed) continue;
    const existing = latestById.get(flow.flow_id);
    if (!existing) {
      latestById.set(flow.flow_id, flow);
      continue;
    }
    const existingParsed = parseSemver(existing.version);
    if (existingParsed && compareSemver(parsed, existingParsed) > 0) {
      latestById.set(flow.flow_id, flow);
    }
  }

  let candidates = [...latestById.values()].sort((a, b) => {
    const t = Date.parse(b.updated) - Date.parse(a.updated);
    if (t !== 0) return t;
    return a.flow_id.localeCompare(b.flow_id);
  });

  const totalMatching = candidates.length;
  let truncated = totalMatching > limit;
  if (candidates.length > limit) {
    candidates = candidates.slice(0, limit);
  }

  const flows = candidates.map((flow) => flowSummaryForClient(flow, countStepsForFlow(vault, flow.flow_id, flow.version)));

  return {
    schema: 'knowtation.flow_list/v0',
    vault_id: vaultId,
    effective_scope: query.effectiveScope,
    flows,
    truncated,
  };
}

/**
 * Resolve the latest stored version of a flow **regardless of reader scope**.
 *
 * Used by the authoring write-back path (approve→apply reconcile and the
 * propose-time concurrency precheck), where the server compares against the
 * actual canonical state, not a reader-filtered projection.
 *
 * @param {VaultFlowStore} vault
 * @param {string} flowId
 * @returns {{ flow: StoredFlow, steps: StoredFlowStep[] } | null}
 */
export function latestStoredFlow(vault, flowId) {
  if (!vault) return null;
  const matching = vault.flows.filter((f) => f.flow_id === flowId);
  if (matching.length === 0) return null;
  let flow = matching[0];
  for (const candidate of matching) {
    const a = parseSemver(candidate.version);
    const b = parseSemver(flow.version);
    if (a && b && compareSemver(a, b) > 0) flow = candidate;
  }
  const steps = stepsForFlowVersion(vault, flowId, flow.version);
  return { flow, steps };
}

/**
 * Reconcile a validated bundle into the Flow index as a **new (flow_id, version)
 * row** (Phase 7A-L1b; the only index write besides seed).
 *
 * Carry-forward constraint (FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1 §4): an edit
 * is reconciled as a new version record — an existing version row is never
 * mutated in place. The flow row is upserted by `(flow_id, version)` so prior
 * versions stay pinnable. Step bodies are keyed by `(flow_id, flow_version,
 * step_id)` (7A-10c) so divergent step text across versions is preserved.
 * Writes atomically (tmp + rename) so a failed reconcile leaves zero partial state.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {StoredFlow} flow - validated flow record (from `validateFlowBundle`).
 * @param {StoredFlowStep[]} steps - validated ordered steps.
 * @returns {{ created: boolean, version: string }}
 */
export function upsertFlowVersion(dataDir, vaultId, flow, steps) {
  const store = loadFlowStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  }
  const vault = store.vaults[vaultId];

  const idx = vault.flows.findIndex((f) => f.flow_id === flow.flow_id && f.version === flow.version);
  const created = idx === -1;
  if (created) {
    vault.flows.push(flow);
  } else {
    vault.flows[idx] = flow;
  }

  vault.steps = vault.steps.filter(
    (s) => !(s.flow_id === flow.flow_id && s.flow_version === flow.version),
  );
  for (const step of stampStepsForStore(steps, flow.version)) {
    vault.steps.push(step);
  }

  saveFlowStore(dataDir, store);
  return { created, version: flow.version };
}

/**
 * Get one flow definition + ordered steps, or null when missing/invisible.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} flowId
 * @param {{
 *   visibleScopes?: Set<FlowScope>,
 *   filterScopes?: Set<FlowScope>,
 *   version?: string,
 *   starterDir?: string,
 * }} query
 * @returns {{ schema: 'knowtation.flow_get/v0', vault_id: string, flow: object, steps: object[] } | null}
 */
export function getFlow(dataDir, vaultId, flowId, query) {
  if (!FLOW_ID_RE.test(flowId)) {
    return null;
  }

  ensureStarterSeed(dataDir, vaultId, { starterDir: query.starterDir });

  const filterScopes = query.filterScopes ?? query.visibleScopes ?? new Set(['personal']);
  const pinnedVersion = typeof query.version === 'string' && query.version.trim() ? query.version.trim() : '';

  if (pinnedVersion && !SEMVER_RE.test(pinnedVersion)) {
    return null;
  }

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;

  const matching = vault.flows.filter((f) => {
    if (f.flow_id !== flowId) return false;
    if (!filterScopes.has(f.scope)) return false;
    if (pinnedVersion) return f.version === pinnedVersion;
    return true;
  });

  if (matching.length === 0) return null;

  let flow = matching[0];
  if (!pinnedVersion) {
    for (const candidate of matching) {
      const a = parseSemver(candidate.version);
      const b = parseSemver(flow.version);
      if (a && b && compareSemver(a, b) > 0) {
        flow = candidate;
      }
    }
  }

  let steps = stepsForFlowVersion(vault, flowId, flow.version);

  let truncated = false;
  if (steps.length > MAX_STEPS_PER_FLOW) {
    steps = steps.slice(0, MAX_STEPS_PER_FLOW);
    truncated = true;
  }

  const client = flowDefinitionForClient(
    truncated ? { ...flow, truncated: true } : flow,
    steps,
  );

  return {
    schema: 'knowtation.flow_get/v0',
    vault_id: vaultId,
    flow: client.flow,
    steps: client.steps,
  };
}

/**
 * Build the default portable run pointer for a canonical run_id.
 *
 * @param {string} runId
 * @returns {string}
 */
export function buildDefaultRunRef(runId) {
  return `flow_run:${runId}`;
}

/**
 * @param {string} input
 * @returns {boolean}
 */
export function isValidRunLookupKey(input) {
  if (typeof input !== 'string' || !input.trim()) return false;
  const key = input.trim();
  return FLOW_RUN_ID_RE.test(key) || FLOW_RUN_REF_RE.test(key);
}

/**
 * Locate a run in a vault by canonical run_id or portable run_ref.
 *
 * @param {VaultFlowStore|null|undefined} vault
 * @param {string} lookupKey
 * @returns {object|null}
 */
export function findRunInVault(vault, lookupKey) {
  if (!vault || !Array.isArray(vault.runs)) return null;
  const key = lookupKey.trim();
  if (FLOW_RUN_ID_RE.test(key)) {
    return vault.runs.find((r) => r.run_id === key) ?? null;
  }
  if (FLOW_RUN_REF_RE.test(key)) {
    return vault.runs.find((r) => r.run_ref === key) ?? null;
  }
  return null;
}

/**
 * @param {VaultFlowStore|null|undefined} vault
 * @param {string} lookupKey
 * @param {Set<FlowScope>} visibleScopes
 * @returns {object|null}
 */
export function findVisibleRun(vault, lookupKey, visibleScopes) {
  const run = findRunInVault(vault, lookupKey);
  if (!run) return null;
  if (!visibleScopes.has(run.scope)) return null;
  return run;
}

/**
 * Project a stored run for wire clients (content-minimized, pointer-only).
 *
 * @param {object} run
 * @returns {object}
 */
export function runForClient(run) {
  return {
    schema: FLOW_RUN_SCHEMA,
    run_id: run.run_id,
    run_ref: typeof run.run_ref === 'string' ? run.run_ref : buildDefaultRunRef(run.run_id),
    flow_id: run.flow_id,
    flow_version: run.flow_version,
    scope: run.scope,
    status: run.status,
    step_states: Array.isArray(run.step_states)
      ? run.step_states.map((s) => ({
          step_id: s.step_id,
          status: s.status,
          evidence_ref: s.evidence_ref ?? null,
          verified: s.verified === true,
        }))
      : [],
    started: run.started,
    provenance: {
      actor: run.provenance?.actor ?? '',
      harness: run.provenance?.harness ?? 'unknown',
    },
    task_ref: typeof run.task_ref === 'string' ? run.task_ref : null,
    external_ref: typeof run.external_ref === 'string' ? run.external_ref : null,
  };
}

/**
 * Seed the SD-2 / overseer anchor run when absent (read-only; no run-write gate).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {{ seeded: boolean }}
 */
export function seedOverseerAnchorRun(dataDir, vaultId) {
  const store = loadFlowStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  }
  const vault = store.vaults[vaultId];
  const runId = 'run_overseer_in_progress';
  const runRef = OVERSEER_FIXTURE_RUN_REF;
  const exists = vault.runs.some((r) => r.run_id === runId || r.run_ref === runRef);
  if (exists) {
    return { seeded: false };
  }

  vault.runs.push({
    schema: FLOW_RUN_SCHEMA,
    run_id: runId,
    run_ref: runRef,
    flow_id: 'flow_overseer_handover',
    flow_version: '0.1.0',
    scope: 'project',
    status: 'in_progress',
    task_ref: 'task_2g_handover_001',
    external_ref: 'musehub:commit:abc123def456',
    step_states: [
      {
        step_id: 'flow_overseer_handover#1',
        status: 'done',
        evidence_ref: 'artifact:snapshot-001',
        verified: true,
      },
      {
        step_id: 'flow_overseer_handover#2',
        status: 'blocked',
        evidence_ref: null,
        verified: false,
      },
    ],
    started: '2026-06-19T10:00:00Z',
    provenance: {
      actor: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      harness: 'seed',
    },
  });
  saveFlowStore(dataDir, store);
  return { seeded: true };
}

/**
 * Lazy seed anchor run on first flow_run read.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 */
function ensureRunSeed(dataDir, vaultId) {
  seedOverseerAnchorRun(dataDir, vaultId);
}

/**
 * List scope-visible flow runs (content-minimized).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   visibleScopes?: Set<FlowScope>,
 *   filterScopes?: Set<FlowScope>,
 *   effectiveScope: FlowScope,
 *   flowId?: string,
 *   limit?: number,
 * }} query
 * @returns {{ schema: typeof FLOW_RUN_LIST_SCHEMA, vault_id: string, effective_scope: FlowScope, runs: object[], truncated: boolean }}
 */
export function listFlowRuns(dataDir, vaultId, query) {
  ensureRunSeed(dataDir, vaultId);

  const filterScopes = query.filterScopes ?? query.visibleScopes ?? new Set(['personal']);
  const flowId = typeof query.flowId === 'string' ? query.flowId.trim() : '';
  let limit = typeof query.limit === 'number' ? query.limit : MAX_FLOW_RUNS_LIST;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_FLOW_RUNS_LIST;
  if (limit > MAX_FLOW_RUNS_LIST) limit = MAX_FLOW_RUNS_LIST;

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  const runs = vault && Array.isArray(vault.runs) ? vault.runs : [];

  let filtered = runs.filter((r) => {
    if (!filterScopes.has(r.scope)) return false;
    if (flowId && r.flow_id !== flowId) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const t = Date.parse(b.started ?? 0) - Date.parse(a.started ?? 0);
    if (t !== 0) return t;
    return (a.run_id ?? '').localeCompare(b.run_id ?? '');
  });

  const totalMatching = filtered.length;
  let truncated = totalMatching > limit;
  if (filtered.length > limit) {
    filtered = filtered.slice(0, limit);
  }

  return {
    schema: FLOW_RUN_LIST_SCHEMA,
    vault_id: vaultId,
    effective_scope: query.effectiveScope,
    runs: filtered.map(runForClient),
    truncated,
  };
}

/**
 * Get one flow run by run_id or portable run_ref, or null when missing/invisible.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} lookupKey
 * @param {{ visibleScopes?: Set<FlowScope>, filterScopes?: Set<FlowScope> }} query
 * @returns {{ schema: typeof FLOW_RUN_GET_SCHEMA, vault_id: string, run: object } | null}
 */
export function getFlowRun(dataDir, vaultId, lookupKey, query) {
  if (!isValidRunLookupKey(lookupKey)) {
    return null;
  }

  ensureRunSeed(dataDir, vaultId);

  const filterScopes = query.filterScopes ?? query.visibleScopes ?? new Set(['personal']);
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  const run = findVisibleRun(vault, lookupKey, filterScopes);
  if (!run) return null;

  return {
    schema: FLOW_RUN_GET_SCHEMA,
    vault_id: vaultId,
    run: runForClient(run),
  };
}

/**
 * Persist a new or updated run row atomically.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {object} run
 * @param {{ create?: boolean }} [options]
 * @returns {{ ok: true, run: object } | { ok: false, reason: string }}
 */
export function persistFlowRun(dataDir, vaultId, run, options = {}) {
  const store = loadFlowStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  }
  const vault = store.vaults[vaultId];
  const idx = vault.runs.findIndex((r) => r.run_id === run.run_id);
  if (options.create === true && idx >= 0) {
    return { ok: false, reason: 'run_exists' };
  }
  if (options.create !== true && idx < 0) {
    return { ok: false, reason: 'unknown_run' };
  }
  const row = {
    ...run,
    run_ref: typeof run.run_ref === 'string' ? run.run_ref : buildDefaultRunRef(run.run_id),
  };
  if (idx >= 0) {
    vault.runs[idx] = row;
  } else {
    vault.runs.push(row);
  }
  saveFlowStore(dataDir, store);
  return { ok: true, run: row };
}

/**
 * Upsert a `knowtation.flow_candidate/v0` record (latest row wins by candidate_id).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {object} candidate
 * @returns {object}
 */
export function upsertCandidate(dataDir, vaultId, candidate) {
  const store = loadFlowStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = {
      flows: [],
      steps: [],
      runs: [],
      candidates: [],
      projections: [],
      tasks: [],
      task_loops: [],
      orchestrator_graphs: [],
    };
  }
  const vault = store.vaults[vaultId];
  const idx = vault.candidates.findIndex((c) => c.candidate_id === candidate.candidate_id);
  const row = { ...candidate, updated: candidate.updated ?? new Date().toISOString() };
  if (idx === -1) {
    vault.candidates.push(row);
  } else {
    vault.candidates[idx] = row;
  }
  saveFlowStore(dataDir, store);
  return row;
}

/**
 * Get one candidate when readable in caller scope, or null (no existence leak).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} candidateId
 * @param {Set<import('./flow-scope.mjs').FlowScope>} visibleScopes
 * @returns {object|null}
 */
export function getCandidate(dataDir, vaultId, candidateId, visibleScopes) {
  if (!FLOW_CANDIDATE_ID_RE.test(candidateId)) return null;
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;
  const row = vault.candidates.find((c) => c.candidate_id === candidateId);
  if (!row) return null;
  if (!visibleScopes.has(row.scope_hint)) return null;
  return row;
}

/**
 * List candidates in a vault (content-minimized rows).
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ limit?: number, statusFilter?: string }} [query]
 * @returns {{ candidates: object[], truncated: boolean }}
 */
export function listCandidatesInVault(dataDir, vaultId, query = {}) {
  let limit = typeof query.limit === 'number' ? query.limit : 50;
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 50) limit = 50;

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId] ?? { candidates: [] };
  let rows = [...(vault.candidates ?? [])];
  if (query.statusFilter) {
    rows = rows.filter((c) => c.status === query.statusFilter);
  }
  rows.sort((a, b) => Date.parse(b.updated ?? 0) - Date.parse(a.updated ?? 0));
  const truncated = rows.length > limit;
  if (rows.length > limit) rows = rows.slice(0, limit);
  return { candidates: rows, truncated };
}

/**
 * Update candidate terminal/non-terminal status.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} candidateId
 * @param {string} status
 * @returns {object|null}
 */
export function updateCandidateStatus(dataDir, vaultId, candidateId, status) {
  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  if (!vault) return null;
  const idx = vault.candidates.findIndex((c) => c.candidate_id === candidateId);
  if (idx === -1) return null;
  const prev = vault.candidates[idx].status;
  if (prev !== 'pending_review') return null;
  vault.candidates[idx] = {
    ...vault.candidates[idx],
    status,
    updated: new Date().toISOString(),
  };
  saveFlowStore(dataDir, store);
  return vault.candidates[idx];
}
