/**
 * Flow authoring write-back facade (Phase 7A-L1b).
 *
 * A typed facade over the existing `/proposals` lifecycle (SD-4): drafting,
 * editing, or importing a Flow becomes a standard proposal targeting the Flow's
 * mirror note. There is **no second write path** — review/evaluation/approve/
 * apply and the optimistic-concurrency check are the same machinery notes use.
 * The Flow index changes **only** at approve→apply, by reconciling the approved
 * mirror back into the store as a new `(flow_id, version)` row.
 *
 * `FLOW_AUTHORING_WRITES` defaults **off**; when off every propose/import returns
 * `403 FLOW_AUTHORING_DISABLED` and no write path is reachable.
 *
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md
 */

import fs from 'fs';
import path from 'path';

import { fnv1a64Hex, stableStringify } from '../note-state-id.mjs';
import {
  validateFlowBundle,
  flowDefinitionForClient,
  latestStoredFlow,
  upsertFlowVersion,
  loadFlowStore,
  parseSemver,
  compareSemver,
  FLOW_ID_RE,
  SEMVER_RE,
} from './flow-store.mjs';
import {
  resolveFlowVisibleScopes,
  resolveFlowWriteAuthority,
} from './flow-scope.mjs';
import {
  readVaultExternalAgentPolicy,
  validateImportExternalTools,
} from './external-agent.mjs';
import { validateImportAutomatableSteps } from './flow-execution.mjs';

export const FLOW_STATE_ID_PREFIX = 'flowst1_';
export const FLOW_AUTHORING_POLICY_FILE = 'hub_flow_authoring_policy.json';
export const FLOW_PROPOSAL_SCHEMA = 'knowtation.flow_proposal/v0';
export const FLOW_PROPOSAL_SOURCE = 'flow';
export const FLOW_REVIEW_QUEUE = 'flow-authoring';

/** @typedef {import('./flow-scope.mjs').FlowScope} FlowScope */
/** @typedef {'new'|'edit'|'import'} FlowProposeKind */

/**
 * Canonicalize a flow record to the stable subset used by `flowStateId`.
 * Mirrors `flowDefinitionForClient` so a token computed from a `flow get`
 * payload reproduces server-side byte-for-byte.
 *
 * @param {Record<string, unknown>} flow
 * @returns {Record<string, unknown>}
 */
function canonicalFlowForState(flow) {
  return {
    schema: 'knowtation.flow/v0',
    flow_id: flow.flow_id,
    title: flow.title,
    version: flow.version,
    scope: flow.scope,
    summary: flow.summary,
    tags: Array.isArray(flow.tags) ? flow.tags : [],
    steps: Array.isArray(flow.steps) ? flow.steps : [],
    inputs: Array.isArray(flow.inputs) ? flow.inputs : [],
    vault_mirror_path: typeof flow.vault_mirror_path === 'string' ? flow.vault_mirror_path : null,
    updated: flow.updated,
    truncated: flow.truncated === true,
  };
}

/**
 * @param {Record<string, unknown>} step
 * @returns {Record<string, unknown>}
 */
function canonicalStepForState(step) {
  return {
    schema: 'knowtation.flow_step/v0',
    step_id: step.step_id,
    flow_id: step.flow_id,
    ordinal: step.ordinal,
    owned_job: step.owned_job,
    instruction: step.instruction,
    trigger: step.trigger,
    when_not_to_run: step.when_not_to_run,
    requires: Array.isArray(step.requires) ? step.requires : [],
    boundaries: Array.isArray(step.boundaries) ? step.boundaries : [],
    skill_refs: Array.isArray(step.skill_refs) ? step.skill_refs : [],
    inputs: Array.isArray(step.inputs) ? step.inputs : [],
    outputs: Array.isArray(step.outputs) ? step.outputs : [],
    output_shape: step.output_shape,
    verification: step.verification,
    automatable: step.automatable,
  };
}

/**
 * Deterministic optimistic-concurrency token over a flow definition + ordered
 * steps. `flowst1_<16 hex>` = FNV-1a 64-bit over the key-sorted canonical
 * content. Reuses `fnv1a64Hex` + `stableStringify` from `lib/note-state-id.mjs`.
 *
 * @param {Record<string, unknown>} flow
 * @param {Record<string, unknown>[]} steps
 * @returns {string}
 */
export function flowStateId(flow, steps) {
  const orderedSteps = [...(Array.isArray(steps) ? steps : [])]
    .map((s) => canonicalStepForState(s))
    .sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
  const payload = stableStringify({
    flow: canonicalFlowForState(flow || {}),
    steps: orderedSteps,
  });
  return FLOW_STATE_ID_PREFIX + fnv1a64Hex(Buffer.from(payload, 'utf8'));
}

/**
 * State token for a flow that must still be **absent** (propose-new). Mirrors
 * the note `absentNoteStateId` sentinel.
 *
 * @returns {string}
 */
export function absentFlowStateId() {
  return FLOW_STATE_ID_PREFIX + fnv1a64Hex(Buffer.from([0x00]));
}

/** @param {unknown} v */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

/**
 * @param {string} dataDir
 * @returns {{ flow_authoring_writes_enabled?: boolean, flow_authoring_forbidden?: boolean }}
 */
export function readFlowAuthoringPolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, FLOW_AUTHORING_POLICY_FILE);
  try {
    if (!fs.existsSync(fp)) return {};
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return {};
    const out = {};
    if (typeof j.flow_authoring_writes_enabled === 'boolean') {
      out.flow_authoring_writes_enabled = j.flow_authoring_writes_enabled;
    }
    if (typeof j.flow_authoring_forbidden === 'boolean') {
      out.flow_authoring_forbidden = j.flow_authoring_forbidden;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Whether durable Flow authoring writes are enabled (tri-state, default OFF).
 * Precedence: explicit `FLOW_AUTHORING_WRITES` env (1/true|0/false) overrides the
 * policy file; else file; else default `false`.
 *
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowAuthoringWritesEnabled(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_AUTHORING_WRITES);
  if (fromEnv !== null) return fromEnv;
  return readFlowAuthoringPolicyFile(dataDir).flow_authoring_writes_enabled === true;
}

/**
 * Whether an org/classroom policy forbids authoring entirely (default false).
 *
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getFlowAuthoringForbidden(dataDir) {
  const fromEnv = envTriState(process.env.FLOW_AUTHORING_FORBIDDEN);
  if (fromEnv !== null) return fromEnv;
  return readFlowAuthoringPolicyFile(dataDir).flow_authoring_forbidden === true;
}

/**
 * Server-derive `auto_approvable` from the bundle's verification kinds. A draft
 * has no `auto_approvable` field; any `human_review` step ⇒ `false` so a draft
 * can never self-authorize.
 *
 * @param {{ verification?: { kind?: string } }[]} steps
 * @returns {boolean}
 */
export function deriveAutoApprovable(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  return steps.every((s) => s?.verification?.kind && s.verification.kind !== 'human_review');
}

/**
 * @param {string} flowId
 * @returns {string}
 */
function defaultMirrorPath(flowId) {
  const slug = flowId.replace(/^flow_/, '').replace(/_/g, '-');
  return `meta/flows/${slug}.md`;
}

/**
 * @param {Set<FlowScope>} [a]
 * @param {Set<FlowScope>} [b]
 * @returns {Set<FlowScope>}
 */
function unionScopes(a, b) {
  const out = new Set();
  if (a) for (const s of a) out.add(s);
  if (b) for (const s of b) out.add(s);
  if (out.size === 0) out.add('personal');
  return out;
}

/**
 * @param {object} input
 * @returns {{ visibleScopes: Set<FlowScope>, ambiguous: boolean }}
 */
function resolveWriteScopes(input) {
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
 * @param {number} status
 * @param {string} code
 * @param {string} [error]
 */
function refuse(status, code, error) {
  return { ok: false, status, error: error ?? code, code };
}

/**
 * THE one handler — MCP `flow_propose`/`flow_import`, Hub `POST /api/v1/flows`
 * (+`/{id}/proposals`, `/import`), and CLI `flow propose|import` all converge
 * here. Validates the bundle, resolves write authority server-side, runs the
 * propose-time concurrency precheck, and delegates to the proposal create
 * lifecycle. Never writes the Flow index (that happens only at approve→apply).
 *
 * @param {{
 *   dataDir: string,
 *   vaultId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: FlowScope[],
 *   visibleScopes?: Set<FlowScope>,
 *   ambiguous?: boolean,
 *   kind: FlowProposeKind,
 *   flow?: unknown,
 *   steps?: unknown,
 *   bundle?: { flow?: unknown, steps?: unknown },
 *   intent?: unknown,
 *   flowId?: string,
 *   baseVersion?: string,
 *   baseStateId?: string,
 *   externalRef?: string,
 *   sourceVaultHint?: string,
 *   createProposal: (dataDir: string, input: object) => { proposal_id: string },
 *   starterDir?: string,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleFlowProposeRequest(input) {
  const isImport = input.kind === 'import';
  const malformedCode = isImport ? 'FLOW_IMPORT_BUNDLE_MALFORMED' : 'FLOW_DRAFT_INVALID';

  // Gating — fail closed before any work.
  if (getFlowAuthoringForbidden(input.dataDir)) {
    return refuse(403, 'FLOW_AUTHORING_POLICY_FORBIDDEN', 'Flow authoring forbidden by policy');
  }
  if (!getFlowAuthoringWritesEnabled(input.dataDir)) {
    return refuse(403, 'FLOW_AUTHORING_DISABLED', 'Flow authoring writes are disabled');
  }

  if (typeof input.createProposal !== 'function') {
    return refuse(500, 'RUNTIME_ERROR', 'createProposal is required');
  }

  // Intent — required, untrusted, recorded verbatim.
  const intent = typeof input.intent === 'string' ? input.intent.trim() : '';
  if (!intent) {
    return refuse(400, malformedCode, 'intent is required');
  }

  // Bundle shape + anatomy completeness.
  const rawBundle = isImport
    ? input.bundle && typeof input.bundle === 'object'
      ? input.bundle
      : {}
    : { flow: input.flow, steps: input.steps };
  const validated = validateFlowBundle(rawBundle);
  if (!validated.ok) {
    return refuse(400, malformedCode, validated.reason);
  }
  const { flow, steps } = validated;

  // For an edit, the request flow_id must match the bundle.
  if (input.kind === 'edit') {
    const requestedId = typeof input.flowId === 'string' ? input.flowId.trim() : '';
    if (requestedId && requestedId !== flow.flow_id) {
      return refuse(400, 'FLOW_DRAFT_INVALID', 'flow_id mismatch between path and bundle');
    }
  }

  // Scope resolution (deny-by-default; ambiguous fails closed).
  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'FLOW_SCOPE_AMBIGUOUS', 'Ambiguous flow scope');
  }

  // Write authority — scope × role, server-side; no scope widening from inside.
  const authority = resolveFlowWriteAuthority(resolved.visibleScopes, flow.scope);
  if (!authority.ok) {
    const code = isImport && authority.code === 'FLOW_SCOPE_DENIED'
      ? 'FLOW_IMPORT_SCOPE_DENIED'
      : authority.code;
    return refuse(authority.status, code, authority.error);
  }

  // Import sandbox: external_tool refs must be in vault allowlist (FLOW-V0-SPEC §6 item 3).
  if (isImport) {
    const vaultPolicy = readVaultExternalAgentPolicy(input.dataDir);
    const externalCheck = validateImportExternalTools(steps, vaultPolicy.allowedTools);
    if (!externalCheck.ok && vaultPolicy.importPolicy === 'reject') {
      return refuse(403, 'FLOW_IMPORT_EXTERNAL_TOOL_DENIED', 'Import declares tools outside allowlist');
    }
    const automatableCheck = validateImportAutomatableSteps(steps, input.dataDir);
    if (!automatableCheck.ok) {
      return refuse(403, 'FLOW_IMPORT_AUTOMATABLE_DENIED', 'Import declares automatable steps where policy forbids');
    }
  }

  // Optimistic concurrency precheck (fast fail; approve re-checks authoritatively).
  const store = loadFlowStore(input.dataDir);
  const vault = store.vaults[input.vaultId];
  const current = vault ? latestStoredFlow(vault, flow.flow_id) : null;
  // Only flows in a scope the actor may read are "visible"; others are absent to them.
  const currentVisible =
    current && resolved.visibleScopes.has(current.flow.scope) ? current : null;

  let proposalBaseStateId;
  let proposalBaseVersion = null;

  if (input.kind === 'edit') {
    const baseVersion = typeof input.baseVersion === 'string' ? input.baseVersion.trim() : '';
    const baseStateId = typeof input.baseStateId === 'string' ? input.baseStateId.trim() : '';
    if (!baseVersion || !SEMVER_RE.test(baseVersion) || !baseStateId.startsWith(FLOW_STATE_ID_PREFIX)) {
      return refuse(400, 'FLOW_DRAFT_INVALID', 'edit requires base_version + base_state_id');
    }
    // No existence leak: an unreadable/missing flow is uniformly unknown_flow.
    if (!currentVisible) {
      return refuse(404, 'unknown_flow', 'unknown_flow');
    }
    const canonical = flowDefinitionForClient(currentVisible.flow, currentVisible.steps);
    const serverStateId = flowStateId(canonical.flow, canonical.steps);
    if (currentVisible.flow.version !== baseVersion || serverStateId !== baseStateId) {
      return refuse(409, 'FLOW_LINEAGE_CONFLICT', 'flow changed since edit was based');
    }
    const next = parseSemver(flow.version);
    const base = parseSemver(baseVersion);
    if (!next || !base || compareSemver(next, base) <= 0) {
      return refuse(400, 'FLOW_DRAFT_INVALID', 'flow.version must be greater than base_version');
    }
    proposalBaseStateId = baseStateId;
    proposalBaseVersion = baseVersion;
  } else {
    // New (and import-as-new): the flow_id must still be absent in the actor's scope.
    if (currentVisible) {
      return refuse(409, 'FLOW_LINEAGE_CONFLICT', 'flow_id already exists in scope');
    }
    proposalBaseStateId = absentFlowStateId();
  }

  const autoApprovable = deriveAutoApprovable(steps);

  // Build the mirror-note proposal (review-before-write; no index write here).
  const mirrorPath = flow.vault_mirror_path || defaultMirrorPath(flow.flow_id);
  const body = JSON.stringify({ flow, steps }, null, 2);
  const frontmatter = {
    type: 'flow',
    flow_id: flow.flow_id,
    flow_version: flow.version,
    scope: flow.scope,
  };
  const externalRef = buildExternalRef(input);

  const proposal = input.createProposal(input.dataDir, {
    path: mirrorPath,
    body,
    frontmatter,
    intent,
    base_state_id: proposalBaseStateId,
    external_ref: externalRef || undefined,
    source: FLOW_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by: typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: FLOW_REVIEW_QUEUE,
    flow_meta: {
      kind: isImport ? 'import' : input.kind,
      base_version: proposalBaseVersion,
      base_state_id: proposalBaseStateId,
    },
  });

  return {
    ok: true,
    payload: {
      schema: FLOW_PROPOSAL_SCHEMA,
      proposal_id: proposal.proposal_id,
      flow_id: flow.flow_id,
      base_version: proposalBaseVersion,
      base_state_id: input.kind === 'edit' ? proposalBaseStateId : null,
      scope: flow.scope,
      auto_approvable: autoApprovable,
      status: 'proposed',
      review_queue: FLOW_REVIEW_QUEUE,
    },
  };
}

/**
 * Build a pointer-only lineage `external_ref` for an import (labels/pointers
 * only — never content or secrets).
 *
 * @param {{ kind: FlowProposeKind, externalRef?: string, sourceVaultHint?: string }} input
 * @returns {string}
 */
function buildExternalRef(input) {
  if (input.kind !== 'import') return '';
  const parts = [];
  if (typeof input.externalRef === 'string' && input.externalRef.trim()) {
    parts.push(input.externalRef.trim().slice(0, 256));
  }
  if (typeof input.sourceVaultHint === 'string' && input.sourceVaultHint.trim()) {
    parts.push(`source_vault_hint=${input.sourceVaultHint.trim().slice(0, 128)}`);
  }
  return parts.join(' ').slice(0, 512);
}

/**
 * Approve-time **authoritative** concurrency re-check + bundle parse for a Flow
 * proposal (the binding check). Run BEFORE the mirror note is written so a
 * conflict short-circuits with no partial state.
 *
 * @param {string} dataDir
 * @param {object} proposal - the stored proposal (source === 'flow').
 * @returns {{ ok: true, vaultId: string, flow: object, steps: object[] } | { ok: false, status: number, error: string, code: string }}
 */
export function precheckApprovedFlowProposal(dataDir, proposal) {
  let parsed;
  try {
    parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
  } catch {
    return refuse(400, 'FLOW_DRAFT_INVALID', 'flow proposal body is not valid JSON');
  }
  const validated = validateFlowBundle(parsed);
  if (!validated.ok) {
    return refuse(400, 'FLOW_DRAFT_INVALID', validated.reason);
  }
  const { flow, steps } = validated;
  const vaultId = typeof proposal.vault_id === 'string' && proposal.vault_id.trim()
    ? proposal.vault_id.trim()
    : 'default';
  const meta = proposal.flow_meta && typeof proposal.flow_meta === 'object' ? proposal.flow_meta : {};
  const kind = meta.kind === 'edit' ? 'edit' : 'new';

  const store = loadFlowStore(dataDir);
  const vault = store.vaults[vaultId];
  const current = vault ? latestStoredFlow(vault, flow.flow_id) : null;

  if (kind === 'edit') {
    if (!current) {
      return refuse(409, 'FLOW_LINEAGE_CONFLICT', 'flow disappeared before approve');
    }
    const baseVersion = typeof meta.base_version === 'string' ? meta.base_version : '';
    const baseStateId = typeof meta.base_state_id === 'string' ? meta.base_state_id : '';
    const canonical = flowDefinitionForClient(current.flow, current.steps);
    const serverStateId = flowStateId(canonical.flow, canonical.steps);
    if (current.flow.version !== baseVersion || serverStateId !== baseStateId) {
      return refuse(409, 'FLOW_LINEAGE_CONFLICT', 'flow changed since edit was based');
    }
    const next = parseSemver(flow.version);
    const base = parseSemver(baseVersion);
    if (!next || !base || compareSemver(next, base) <= 0) {
      return refuse(400, 'FLOW_DRAFT_INVALID', 'flow.version must be greater than base_version');
    }
  } else if (current) {
    return refuse(409, 'FLOW_LINEAGE_CONFLICT', 'flow_id already exists');
  }

  return { ok: true, vaultId, flow, steps };
}

/**
 * Apply a pre-checked Flow bundle into the index as a new `(flow_id, version)`
 * row. Call AFTER the mirror note write succeeds; the bundle has already been
 * validated by {@link precheckApprovedFlowProposal} so this cannot fail on shape.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {object} flow
 * @param {object[]} steps
 * @returns {{ created: boolean, version: string }}
 */
export function applyFlowProposalToIndex(dataDir, vaultId, flow, steps) {
  return upsertFlowVersion(dataDir, vaultId, flow, steps);
}

export { FLOW_ID_RE };
