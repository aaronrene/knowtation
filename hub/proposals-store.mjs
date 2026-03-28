/**
 * File-based proposal store. Phase 11 + augmentation (labels, enrich, external_ref) + human evaluation.
 * Stores proposals in data_dir/hub_proposals.json.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { notePathMatchesPrefix, normalizePathPrefix } from '../lib/write.mjs';

const FILENAME = 'hub_proposals.json';

export function getProposalsPath(dataDir) {
  return path.join(dataDir, FILENAME);
}

function loadProposals(dataDir) {
  const filePath = getProposalsPath(dataDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function saveProposals(dataDir, proposals) {
  const filePath = getProposalsPath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(proposals, null, 2), 'utf8');
}

function normalizeLabels(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, 32);
}

function normalizeSource(v) {
  if (v == null || typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.slice(0, 64);
}

/**
 * Effective evaluation status for gate logic (missing → none).
 * @param {object} p
 * @returns {string}
 */
export function getEvaluationStatus(p) {
  const s = p?.evaluation_status;
  if (s == null || s === '') return 'none';
  return String(s);
}

/**
 * Merge rubric template with client checklist toggles.
 * @param {{ id: string, label: string }[]} rubricItems
 * @param {unknown} clientChecklist - array of { id, passed? }
 * @returns {{ id: string, label: string, passed: boolean }[]}
 */
export function mergeEvaluationChecklist(rubricItems, clientChecklist) {
  const byId = new Map();
  if (Array.isArray(clientChecklist)) {
    for (const row of clientChecklist) {
      if (!row || typeof row !== 'object') continue;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) continue;
      byId.set(id, Boolean(row.passed));
    }
  }
  const out = (rubricItems || []).map(({ id, label }) => ({
    id,
    label,
    passed: byId.has(id) ? byId.get(id) : false,
  }));
  return out;
}

/**
 * @param {string} dataDir
 * @param {{
 *   status?: string,
 *   vault_id?: string,
 *   limit?: number,
 *   offset?: number,
 *   label?: string,
 *   source?: string,
 *   path_prefix?: string,
 *   evaluation_status?: string,
 * }} options
 * @returns {{ proposals: object[], total: number }}
 */
export function listProposals(dataDir, options = {}) {
  const all = loadProposals(dataDir);
  let list = all;
  if (options.status) list = list.filter((p) => p.status === options.status);
  if (options.vault_id != null) {
    list = list.filter((p) => (p.vault_id ?? 'default') === options.vault_id);
  }
  if (options.source && String(options.source).trim()) {
    const src = String(options.source).trim();
    list = list.filter((p) => (p.source || '') === src);
  }
  if (options.label && String(options.label).trim()) {
    const want = String(options.label).trim().toLowerCase();
    list = list.filter((p) => {
      const labels = Array.isArray(p.labels) ? p.labels : [];
      return labels.some((l) => String(l).toLowerCase() === want);
    });
  }
  if (options.path_prefix && String(options.path_prefix).trim()) {
    let prefixNorm;
    try {
      prefixNorm = normalizePathPrefix(options.path_prefix);
    } catch {
      prefixNorm = null;
    }
    if (prefixNorm) {
      list = list.filter((p) => notePathMatchesPrefix(p.path, prefixNorm));
    }
  }
  if (options.evaluation_status && String(options.evaluation_status).trim()) {
    const want = String(options.evaluation_status).trim();
    list = list.filter((p) => getEvaluationStatus(p) === want);
  }
  if (options.review_queue && String(options.review_queue).trim()) {
    const want = String(options.review_queue).trim();
    list = list.filter((p) => (p.review_queue || '') === want);
  }
  if (options.review_severity && String(options.review_severity).trim()) {
    const want = String(options.review_severity).trim();
    list = list.filter((p) => (p.review_severity || '') === want);
  }
  const total = list.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  list = list.slice(offset, offset + limit).map((p) => ({ ...p, evaluation_status: getEvaluationStatus(p) }));
  return { proposals: list, total };
}

/**
 * @param {string} dataDir
 * @param {string} id
 */
export function getProposal(dataDir, id) {
  const all = loadProposals(dataDir);
  const p = all.find((pr) => pr.proposal_id === id) ?? null;
  if (!p) return null;
  return { ...p, evaluation_status: getEvaluationStatus(p) };
}

/**
 * @param {string} dataDir
 * @param {{
 *   path?: string,
 *   body?: string,
 *   frontmatter?: object,
 *   intent?: string,
 *   base_state_id?: string,
 *   external_ref?: string,
 *   vault_id?: string,
 *   proposed_by?: string,
 *   labels?: string[],
 *   source?: string,
 *   evaluationRequired?: boolean,
 *   evaluationForcedPending?: boolean,
 *   review_queue?: string,
 *   review_severity?: 'standard'|'elevated',
 *   auto_flag_reasons?: string[],
 * }} input
 */
export function createProposal(dataDir, input) {
  const all = loadProposals(dataDir);
  const now = new Date().toISOString();
  const proposedBy =
    typeof input.proposed_by === 'string' && input.proposed_by.trim() ? input.proposed_by.trim() : undefined;
  const ext =
    input.external_ref != null && String(input.external_ref).trim()
      ? String(input.external_ref).trim().slice(0, 512)
      : '';
  const needPending = Boolean(input.evaluationRequired || input.evaluationForcedPending);
  const evaluation_status = needPending ? 'pending' : 'none';
  const rq =
    input.review_queue != null && String(input.review_queue).trim()
      ? String(input.review_queue).trim().slice(0, 64)
      : undefined;
  const rs =
    input.review_severity === 'elevated' || input.review_severity === 'standard'
      ? input.review_severity
      : undefined;
  const afr = Array.isArray(input.auto_flag_reasons)
    ? input.auto_flag_reasons.map((x) => String(x).slice(0, 256)).filter(Boolean).slice(0, 32)
    : [];
  const proposal = {
    proposal_id: randomUUID(),
    path: input.path || `inbox/proposal-${Date.now()}.md`,
    status: 'proposed',
    vault_id: typeof input.vault_id === 'string' && input.vault_id.trim() ? input.vault_id.trim() : 'default',
    intent: input.intent ?? undefined,
    base_state_id: input.base_state_id ?? undefined,
    external_ref: ext || undefined,
    body: input.body ?? '',
    frontmatter: input.frontmatter ?? {},
    labels: normalizeLabels(input.labels),
    source: normalizeSource(input.source),
    suggested_labels: [],
    assistant_notes: undefined,
    assistant_model: undefined,
    assistant_at: undefined,
    evaluation_status,
    evaluation_grade: undefined,
    evaluation_checklist: undefined,
    evaluation_comment: undefined,
    evaluated_by: undefined,
    evaluated_at: undefined,
    evaluation_waiver: undefined,
    ...(rq && { review_queue: rq }),
    ...(rs && { review_severity: rs }),
    ...(afr.length ? { auto_flag_reasons: afr } : {}),
    review_hints: undefined,
    review_hints_at: undefined,
    review_hints_model: undefined,
    ...(proposedBy && { proposed_by: proposedBy }),
    created_at: now,
    updated_at: now,
  };
  all.push(proposal);
  saveProposals(dataDir, all);
  return proposal;
}

/**
 * Approve / discard. When approving with a waiver, pass `extras.evaluation_waiver`.
 * @param {string} dataDir
 * @param {string} id
 * @param {'approved'|'discarded'} status
 * @param {{ evaluation_waiver?: { by: string, at: string, reason: string } }} [extras]
 * @returns {object|null} Updated proposal or null
 */
export function updateProposalStatus(dataDir, id, status, extras = {}) {
  const all = loadProposals(dataDir);
  const idx = all.findIndex((p) => p.proposal_id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  let next = { ...all[idx], status, updated_at: now };
  if (status === 'approved' && extras.evaluation_waiver) {
    next = { ...next, evaluation_waiver: extras.evaluation_waiver };
  }
  all[idx] = next;
  saveProposals(dataDir, all);
  return all[idx];
}

const OUTCOME_TO_STATUS = {
  pass: 'passed',
  fail: 'failed',
  needs_changes: 'needs_changes',
};

/**
 * @param {string} dataDir
 * @param {string} id
 * @param {{
 *   outcome: string,
 *   evaluation_checklist: { id: string, label: string, passed: boolean }[],
 *   evaluation_grade?: string,
 *   evaluation_comment?: string,
 *   evaluated_by: string,
 * }} payload
 * @returns {{ ok: true, proposal: object } | { ok: false, error: string, code: string }}
 */
export function submitProposalEvaluation(dataDir, id, payload) {
  const all = loadProposals(dataDir);
  const idx = all.findIndex((p) => p.proposal_id === id);
  if (idx === -1) return { ok: false, error: 'Proposal not found', code: 'NOT_FOUND' };
  const p = all[idx];
  if (p.status !== 'proposed') {
    return { ok: false, error: 'Can only evaluate proposed proposals', code: 'BAD_REQUEST' };
  }
  const rawOutcome = String(payload.outcome || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  const evaluation_status = OUTCOME_TO_STATUS[rawOutcome];
  if (!evaluation_status) {
    return { ok: false, error: 'outcome must be pass, fail, or needs_changes', code: 'BAD_REQUEST' };
  }
  const comment = payload.evaluation_comment != null ? String(payload.evaluation_comment).trim() : '';
  if ((evaluation_status === 'failed' || evaluation_status === 'needs_changes') && comment.length < 1) {
    return { ok: false, error: 'comment is required for fail and needs_changes', code: 'BAD_REQUEST' };
  }
  const checklist = Array.isArray(payload.evaluation_checklist) ? payload.evaluation_checklist : [];
  if (evaluation_status === 'passed' && checklist.length > 0) {
    const allPass = checklist.every((c) => c && c.passed === true);
    if (!allPass) {
      return { ok: false, error: 'All checklist items must pass for a pass outcome', code: 'BAD_REQUEST' };
    }
  }
  const grade =
    payload.evaluation_grade != null && String(payload.evaluation_grade).trim()
      ? String(payload.evaluation_grade).trim().slice(0, 32)
      : undefined;
  const now = new Date().toISOString();
  const evaluated_by =
    typeof payload.evaluated_by === 'string' && payload.evaluated_by.trim()
      ? payload.evaluated_by.trim().slice(0, 512)
      : 'unknown';
  all[idx] = {
    ...p,
    evaluation_status,
    evaluation_grade: grade,
    evaluation_checklist: checklist,
    evaluation_comment: comment || undefined,
    evaluated_by,
    evaluated_at: now,
    updated_at: now,
  };
  saveProposals(dataDir, all);
  return { ok: true, proposal: all[idx] };
}

/**
 * Whether approve is allowed without waiver (evaluation satisfied).
 * @param {object} proposal
 */
export function evaluationAllowsApprove(proposal) {
  const es = getEvaluationStatus(proposal);
  return es === 'none' || es === 'passed';
}

/**
 * Tier-2 assistant fields (feature-flagged route).
 * @param {string} dataDir
 * @param {string} id
 * @param {{ assistant_notes: string, assistant_model: string, suggested_labels?: string[] }} fields
 * @returns {object|null}
 */
export function updateProposalEnrichment(dataDir, id, fields) {
  const all = loadProposals(dataDir);
  const idx = all.findIndex((p) => p.proposal_id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const sug = normalizeLabels(fields.suggested_labels ?? []);
  all[idx] = {
    ...all[idx],
    assistant_notes: fields.assistant_notes,
    assistant_model: fields.assistant_model,
    assistant_at: now,
    suggested_labels: sug.length ? sug : all[idx].suggested_labels || [],
    updated_at: now,
  };
  saveProposals(dataDir, all);
  return all[idx];
}

/**
 * Optional async LLM review hints (never merge authority).
 * @param {string} dataDir
 * @param {string} id
 * @param {{ review_hints: string, review_hints_model: string }} fields
 * @returns {object|null}
 */
export function updateProposalReviewHints(dataDir, id, fields) {
  const all = loadProposals(dataDir);
  const idx = all.findIndex((p) => p.proposal_id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    review_hints: fields.review_hints,
    review_hints_model: fields.review_hints_model,
    review_hints_at: now,
    updated_at: now,
  };
  saveProposals(dataDir, all);
  return all[idx];
}

/**
 * Discard proposals in "proposed" state whose path is under path_prefix in the given vault.
 * @param {string} dataDir
 * @param {{ vault_id?: string, path_prefix: string }} opts
 * @returns {number} count discarded
 */
export function discardProposalsUnderPathPrefix(dataDir, opts) {
  const pathPrefixRaw = opts && opts.path_prefix != null ? String(opts.path_prefix) : '';
  const prefixNorm = normalizePathPrefix(pathPrefixRaw);
  const vid = opts.vault_id != null && String(opts.vault_id).trim() ? String(opts.vault_id).trim() : 'default';
  const all = loadProposals(dataDir);
  const now = new Date().toISOString();
  let n = 0;
  const next = all.map((p) => {
    if (p.status !== 'proposed') return p;
    const pv = p.vault_id != null && String(p.vault_id).trim() ? String(p.vault_id).trim() : 'default';
    if (pv !== vid) return p;
    if (!notePathMatchesPrefix(p.path, prefixNorm)) return p;
    n += 1;
    return { ...p, status: 'discarded', updated_at: now };
  });
  saveProposals(dataDir, next);
  return n;
}

/**
 * Discard proposals in "proposed" state whose path is in the given set (exact match, vault-relative forward slashes).
 * @param {string} dataDir
 * @param {{ vault_id?: string, paths: string[] }} opts
 * @returns {number} count discarded
 */
export function discardProposalsAtPaths(dataDir, opts) {
  const vid = opts.vault_id != null && String(opts.vault_id).trim() ? String(opts.vault_id).trim() : 'default';
  const set = new Set((opts.paths || []).map((p) => String(p).replace(/\\/g, '/')));
  if (set.size === 0) return 0;
  const all = loadProposals(dataDir);
  const now = new Date().toISOString();
  let n = 0;
  const next = all.map((p) => {
    if (p.status !== 'proposed') return p;
    const pv = p.vault_id != null && String(p.vault_id).trim() ? String(p.vault_id).trim() : 'default';
    if (pv !== vid) return p;
    const normPath = String(p.path || '').replace(/\\/g, '/');
    if (!set.has(normPath)) return p;
    n += 1;
    return { ...p, status: 'discarded', updated_at: now };
  });
  saveProposals(dataDir, next);
  return n;
}

/**
 * Remove all proposals for a vault id (Hub delete vault).
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {number} number removed
 */
export function removeProposalsForVault(dataDir, vaultId) {
  const vid = String(vaultId || '').trim();
  if (!vid) return 0;
  const all = loadProposals(dataDir);
  const next = all.filter((p) => {
    const pv = p.vault_id != null && String(p.vault_id).trim() ? String(p.vault_id).trim() : 'default';
    return pv !== vid;
  });
  const removed = all.length - next.length;
  if (removed > 0) saveProposals(dataDir, next);
  return removed;
}
