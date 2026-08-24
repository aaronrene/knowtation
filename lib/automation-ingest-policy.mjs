/**
 * AIP — per-account automation ingest policy (pure).
 * Router, body/rule validation, execute orchestration via injected I/O.
 * See docs/AUTOMATION-INGEST-POLICY-FREEZE.md D1–D26.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { notePathMatchesPrefix, normalizePathPrefix } from './write.mjs';
import { applyReviewTriggers } from './hub-proposal-review-triggers.mjs';
import { mergeProvenanceFrontmatter, stripReservedFrontmatterKeys } from './hub-provenance.mjs';

export const CONTENT_CLASSES = Object.freeze(['research', 'ops', 'general']);
export const DISPOSITIONS = Object.freeze(['direct_note', 'proposal_auto_apply', 'review_queue']);
export const MAX_USER_RULES = 32;
export const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INGEST_BODY_MAX_BYTES = 512 * 1024;
export const FINGERPRINT_RE = /^[A-Za-z0-9._:/-]{8,128}$/;
export const INGEST_PATH = 'api/v1/automation/ingest';
export const INGEST_RULES_PATH = 'api/v1/automation/ingest-rules';

const MATCH_KEYS = [
  'credential_id',
  'credential_name',
  'credential_name_prefix',
  'path_prefix',
  'intent',
  'content_class',
];

function packagedDefaultPath() {
  try {
    const u = typeof import.meta !== 'undefined' ? import.meta.url : '';
    if (u) return path.join(path.dirname(fileURLToPath(u)), '..', 'hub', 'automation-ingest-rules-default.json');
  } catch (_) {}
  return path.join(process.cwd(), 'hub', 'automation-ingest-rules-default.json');
}

export function ingestHttpError(status, code, error, extra = {}) {
  const err = new Error(error || code);
  err.status = status;
  err.code = code;
  err.extra = extra;
  return err;
}

export function isKnownContentClass(value) {
  return CONTENT_CLASSES.includes(String(value || ''));
}

function predicateActive(value) {
  return value != null && String(value).trim() !== '';
}

export function activeMatchPredicates(match) {
  const m = match && typeof match === 'object' ? match : {};
  return MATCH_KEYS.filter((k) => predicateActive(m[k]));
}

export function mintRuleId() {
  return `ingr_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeFingerprint(raw) {
  return String(raw == null ? '' : raw).trim();
}

export function isValidFingerprint(raw) {
  return FINGERPRINT_RE.test(normalizeFingerprint(raw));
}

export function idempotencyKeyFromRequest(headerRaw, sourceFingerprint) {
  const header = String(headerRaw == null ? '' : headerRaw).trim();
  if (header) {
    if (!FINGERPRINT_RE.test(header)) {
      throw ingestHttpError(400, 'INGEST_FINGERPRINT_INVALID', 'idempotency key invalid');
    }
    return header;
  }
  return sourceFingerprint;
}

export function idempotencyStoreKey(sub, vaultId, key) {
  return `${sub}\t${vaultId}\t${key}`;
}

/**
 * D14 — ingest contract marker for the legacy proposals hook.
 * @param {unknown} body
 */
export function isIngestContractBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (!isValidFingerprint(body.source_fingerprint)) return false;
  if (body.ingest === true) return true;
  return isKnownContentClass(body.content_class);
}

/**
 * @param {unknown} rawPath
 * @returns {string}
 */
export function normalizeIngestPath(rawPath) {
  if (typeof rawPath !== 'string') {
    throw ingestHttpError(400, 'INGEST_PATH_INVALID', 'path required');
  }
  let p = rawPath.trim().replace(/\\/g, '/');
  while (p.startsWith('/')) p = p.slice(1);
  if (!p || p.length > 512 || !p.endsWith('.md')) {
    throw ingestHttpError(400, 'INGEST_PATH_INVALID', 'path must be vault-relative .md (max 512)');
  }
  for (const seg of p.split('/')) {
    if (seg === '..' || seg === '.') {
      throw ingestHttpError(400, 'INGEST_PATH_INVALID', 'path must not contain ..');
    }
  }
  return p;
}

/**
 * @param {unknown} raw
 * @param {{ requireContract?: boolean }} [opts]
 */
export function normalizeIngestBody(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw ingestHttpError(400, 'INGEST_BODY_REQUIRED', 'body required');
  }
  if (opts.requireContract && !isIngestContractBody(raw)) {
    throw ingestHttpError(400, 'INGEST_CONTRACT_REQUIRED', 'ingest contract required');
  }
  const notePath = normalizeIngestPath(raw.path);
  if (typeof raw.body !== 'string') {
    throw ingestHttpError(400, 'INGEST_BODY_REQUIRED', 'body string required');
  }
  if (Buffer.byteLength(raw.body, 'utf8') > INGEST_BODY_MAX_BYTES) {
    throw ingestHttpError(400, 'INGEST_BODY_REQUIRED', 'body exceeds 512 KiB');
  }
  const fp = normalizeFingerprint(raw.source_fingerprint);
  if (!fp) throw ingestHttpError(400, 'INGEST_FINGERPRINT_REQUIRED', 'source_fingerprint required');
  if (!FINGERPRINT_RE.test(fp)) {
    throw ingestHttpError(400, 'INGEST_FINGERPRINT_INVALID', 'source_fingerprint invalid');
  }
  let contentClass = null;
  if (raw.content_class != null && String(raw.content_class).trim() !== '') {
    const cc = String(raw.content_class).trim().toLowerCase();
    if (!isKnownContentClass(cc)) {
      throw ingestHttpError(400, 'INGEST_CONTENT_CLASS_UNKNOWN', 'unknown content_class');
    }
    contentClass = cc;
  }
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  if (labels.length > 32) {
    throw ingestHttpError(400, 'INGEST_BODY_REQUIRED', 'labels max 32');
  }
  const labelOut = labels.map((x) => String(x).slice(0, 64));
  const intent = raw.intent == null ? '' : String(raw.intent).slice(0, 256);
  const sourceRaw = raw.source == null || String(raw.source).trim() === '' ? 'automation_ingest' : String(raw.source);
  const source = sourceRaw.slice(0, 64);
  const frontmatter =
    raw.frontmatter && typeof raw.frontmatter === 'object' && !Array.isArray(raw.frontmatter)
      ? stripReservedFrontmatterKeys(raw.frontmatter)
      : {};
  return {
    path: notePath,
    body: raw.body,
    frontmatter,
    intent,
    labels: labelOut,
    source,
    source_fingerprint: fp,
    content_class: contentClass,
    ingest: raw.ingest === true,
  };
}

function matchRule(rule, input) {
  const m = rule.match && typeof rule.match === 'object' ? rule.match : {};
  const active = activeMatchPredicates(m);
  if (active.length === 0) return false;
  const requestClass = input.content_class || 'general';
  for (const key of active) {
    const expected = String(m[key]).trim();
    if (key === 'credential_id') {
      if (!input.credential_id || input.credential_id !== expected) return false;
    } else if (key === 'credential_name') {
      if (!input.credential_name || input.credential_name !== expected) return false;
    } else if (key === 'credential_name_prefix') {
      if (!input.credential_name || !String(input.credential_name).startsWith(expected)) return false;
    } else if (key === 'path_prefix') {
      let prefixNorm;
      try {
        prefixNorm = normalizePathPrefix(expected);
      } catch {
        return false;
      }
      if (!notePathMatchesPrefix(input.path, prefixNorm)) return false;
    } else if (key === 'intent') {
      if (String(input.intent || '') !== expected) return false;
    } else if (key === 'content_class') {
      if (requestClass !== expected) return false;
    }
  }
  return true;
}

/**
 * First-match router. Pure aside from applyReviewTriggers (no I/O).
 * @param {{
 *   sub?: string,
 *   path: string,
 *   body: string,
 *   intent?: string,
 *   labels?: string[],
 *   content_class?: string|null,
 *   credential_id?: string|null,
 *   credential_name?: string|null,
 *   evaluationRequired?: boolean,
 *   sessionBound?: boolean,
 *   triggers?: object,
 * }} input
 * @param {object[]} rules
 */
export function routeAutomationIngest(input, rules) {
  const list = Array.isArray(rules) ? rules.filter((r) => r && r.enabled === true) : [];
  list.sort((a, b) => {
    const pa = Number(a.priority) || 0;
    const pb = Number(b.priority) || 0;
    if (pa !== pb) return pa - pb;
    return String(a.rule_id || '').localeCompare(String(b.rule_id || ''));
  });
  let candidate = {
    rule_id: null,
    disposition: 'review_queue',
    content_class: input.content_class || 'general',
  };
  for (const rule of list) {
    if (matchRule(rule, input)) {
      const cc = input.content_class || rule.content_class || 'general';
      candidate = {
        rule_id: rule.rule_id || null,
        disposition: DISPOSITIONS.includes(rule.disposition) ? rule.disposition : 'review_queue',
        content_class: isKnownContentClass(cc) ? cc : 'general',
      };
      break;
    }
  }
  if (!input.content_class && candidate.rule_id) {
    const hit = list.find((r) => r.rule_id === candidate.rule_id);
    if (hit && hit.content_class) candidate.content_class = hit.content_class;
  }
  const triggers = input.triggers && typeof input.triggers === 'object' ? input.triggers : {
    literal_phrases: [],
    path_prefixes: [],
    label_any: [],
  };
  const trigger_result = applyReviewTriggers(triggers, {
    path: input.path,
    body: input.body,
    intent: input.intent,
    labels: Array.isArray(input.labels) ? input.labels : [],
  });
  let elevated_override = false;
  let evaluation_block = false;
  const reasons = Array.isArray(trigger_result.auto_flag_reasons) ? trigger_result.auto_flag_reasons : [];
  if (
    trigger_result.forcePending ||
    trigger_result.review_severity === 'elevated' ||
    reasons.length > 0
  ) {
    candidate.disposition = 'review_queue';
    elevated_override = true;
  }
  if (
    candidate.disposition === 'proposal_auto_apply' &&
    input.evaluationRequired === true &&
    input.sessionBound !== true
  ) {
    candidate.disposition = 'review_queue';
    evaluation_block = true;
  }
  return {
    rule_id: candidate.rule_id,
    disposition: candidate.disposition,
    content_class: candidate.content_class,
    elevated_override,
    evaluation_block,
    trigger_result,
  };
}

export function listPackTemplates() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(packagedDefaultPath(), 'utf8'));
  } catch {
    raw = { version: 1, templates: [] };
  }
  const templates = Array.isArray(raw.templates) ? raw.templates : [];
  return templates.map((t) => ({ ...t, enabled: false }));
}

export function normalizeRuleForSave(raw, { mintMissingId = true } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw ingestHttpError(400, 'INGEST_RULE_MATCH_EMPTY', 'rule required');
  }
  const label = String(raw.label || '').trim();
  if (!label || label.length > 128) {
    throw ingestHttpError(400, 'INGEST_RULE_MATCH_EMPTY', 'label required (1–128)');
  }
  let priority = raw.priority == null ? 100 : Number(raw.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 10000) {
    throw ingestHttpError(400, 'INGEST_RULE_MATCH_EMPTY', 'priority must be 0–10000');
  }
  if (!DISPOSITIONS.includes(raw.disposition)) {
    throw ingestHttpError(400, 'INGEST_DISPOSITION_UNKNOWN', 'unknown disposition');
  }
  let contentClass = null;
  if (raw.content_class != null && String(raw.content_class).trim() !== '') {
    const cc = String(raw.content_class).trim().toLowerCase();
    if (!isKnownContentClass(cc)) {
      throw ingestHttpError(400, 'INGEST_CONTENT_CLASS_UNKNOWN', 'unknown content_class');
    }
    contentClass = cc;
  }
  const matchIn = raw.match && typeof raw.match === 'object' ? raw.match : {};
  const match = {};
  for (const key of MATCH_KEYS) {
    const v = matchIn[key];
    match[key] = predicateActive(v) ? String(v) : null;
  }
  if (activeMatchPredicates(match).length === 0) {
    throw ingestHttpError(400, 'INGEST_RULE_MATCH_EMPTY', 'match requires at least one predicate');
  }
  let ruleId = typeof raw.rule_id === 'string' ? raw.rule_id.trim() : '';
  if (!ruleId || !/^ingr_[0-9a-f]{16}$/.test(ruleId)) {
    if (!mintMissingId) {
      throw ingestHttpError(400, 'INGEST_RULE_MATCH_EMPTY', 'rule_id invalid');
    }
    ruleId = mintRuleId();
  }
  return {
    rule_id: ruleId,
    enabled: raw.enabled === true,
    priority,
    pack_id: raw.pack_id == null || raw.pack_id === '' ? null : String(raw.pack_id).slice(0, 64),
    label,
    match,
    disposition: raw.disposition,
    content_class: contentClass,
  };
}

export function stampIngestFrontmatter(frontmatter, { sub, contentClass, sourceFingerprint, source }) {
  const merged = mergeProvenanceFrontmatter(frontmatter, { sub, kind: 'agent' });
  return {
    ...merged,
    content_class: contentClass,
    source_fingerprint: sourceFingerprint,
    source,
  };
}

export function buildSuccessEnvelope({
  disposition,
  ruleId,
  outcome,
  notePath,
  contentClass,
  proposalId = null,
  noteWritten = false,
  replayed = false,
  elevatedOverride = false,
  evaluationBlock = false,
}) {
  return {
    disposition,
    rule_id: ruleId,
    outcome,
    path: notePath,
    content_class: contentClass,
    proposal_id: proposalId,
    note: noteWritten ? { path: notePath } : null,
    replayed,
    elevated_override: elevatedOverride,
    evaluation_block: evaluationBlock,
  };
}

export function ingestAuditDetail({
  ruleId,
  disposition,
  sourceFingerprint,
  notePath,
  contentClass,
  vaultId,
  credentialId,
  elevatedOverride,
  evaluationBlock,
  replayed,
}) {
  return {
    rule_id: ruleId,
    disposition,
    source_fingerprint: sourceFingerprint,
    path: notePath,
    content_class: contentClass,
    vault_id: vaultId,
    credential_id: credentialId == null ? null : String(credentialId),
    elevated_override: Boolean(elevatedOverride),
    evaluation_block: Boolean(evaluationBlock),
    replayed: Boolean(replayed),
  };
}

function existingFingerprint(existing) {
  if (!existing || typeof existing !== 'object') return '';
  const fm = existing.frontmatter && typeof existing.frontmatter === 'object' ? existing.frontmatter : existing;
  return fm.source_fingerprint != null ? String(fm.source_fingerprint) : '';
}

/**
 * Execute I/O via injected adapters (wrappers own writeNote / canister fetch).
 * @param {object} args
 */
export async function executeAutomationIngest(args) {
  const {
    normalized,
    routed,
    actor,
    io,
  } = args;
  const vaultId = actor.vaultId || 'default';
  const detailBase = {
    ruleId: routed.rule_id,
    disposition: routed.disposition,
    sourceFingerprint: normalized.source_fingerprint,
    notePath: normalized.path,
    contentClass: routed.content_class,
    vaultId,
    credentialId: actor.credentialId || null,
    elevatedOverride: routed.elevated_override,
    evaluationBlock: routed.evaluation_block,
    replayed: false,
  };

  await io.appendAudit('ingest_routed', ingestAuditDetail(detailBase), '');

  if (routed.elevated_override) {
    await io.appendAudit('ingest_elevated_override', ingestAuditDetail(detailBase), '');
  }

  const fm = stampIngestFrontmatter(normalized.frontmatter, {
    sub: actor.sub,
    contentClass: routed.content_class,
    sourceFingerprint: normalized.source_fingerprint,
    source: normalized.source,
  });

  const createPayload = {
    path: normalized.path,
    body: normalized.body,
    frontmatter: fm,
    intent: normalized.intent,
    labels: normalized.labels,
    source: normalized.source,
    proposed_by: actor.sub,
  };

  if (routed.disposition === 'direct_note') {
    const existing = await io.readExistingNote(normalized.path);
    if (existing) {
      const prev = existingFingerprint(existing);
      if (prev !== normalized.source_fingerprint) {
        throw ingestHttpError(409, 'INGEST_PATH_CONFLICT', 'path exists with a different source_fingerprint');
      }
    }
    await io.writeNote(normalized.path, { body: normalized.body, frontmatter: fm });
    await io.appendAudit('ingest_direct_note', ingestAuditDetail(detailBase), '');
    return buildSuccessEnvelope({
      disposition: 'direct_note',
      ruleId: routed.rule_id,
      outcome: 'note',
      notePath: normalized.path,
      contentClass: routed.content_class,
      noteWritten: true,
      elevatedOverride: routed.elevated_override,
      evaluationBlock: routed.evaluation_block,
    });
  }

  if (routed.disposition === 'proposal_auto_apply') {
    const existing = await io.readExistingNote(normalized.path);
    if (existing) {
      const prev = existingFingerprint(existing);
      if (prev !== normalized.source_fingerprint) {
        throw ingestHttpError(409, 'INGEST_PATH_CONFLICT', 'path exists with a different source_fingerprint');
      }
    }
    const proposal = await io.createProposal(createPayload);
    const proposalId = proposal && proposal.proposal_id ? String(proposal.proposal_id) : '';
    await io.writeNote(normalized.path, { body: normalized.body, frontmatter: fm });
    const marked = await io.markProposalApproved(proposalId);
    if (!marked || marked.ok !== true) {
      await io.appendAudit(
        'ingest_apply_failed',
        ingestAuditDetail({ ...detailBase, replayed: false }),
        proposalId
      );
      throw ingestHttpError(500, 'INGEST_APPLY_FAILED', 'auto-apply mark failed', {
        proposal_id: proposalId,
        path: normalized.path,
      });
    }
    await io.appendAudit('ingest_auto_applied', ingestAuditDetail(detailBase), proposalId);
    return buildSuccessEnvelope({
      disposition: 'proposal_auto_apply',
      ruleId: routed.rule_id,
      outcome: 'note_and_proposal',
      notePath: normalized.path,
      contentClass: routed.content_class,
      proposalId,
      noteWritten: true,
      elevatedOverride: routed.elevated_override,
      evaluationBlock: routed.evaluation_block,
    });
  }

  const proposal = await io.createProposal(createPayload);
  const proposalId = proposal && proposal.proposal_id ? String(proposal.proposal_id) : '';
  await io.appendAudit('ingest_review_queued', ingestAuditDetail(detailBase), proposalId);
  return buildSuccessEnvelope({
    disposition: 'review_queue',
    ruleId: routed.rule_id,
    outcome: 'proposal',
    notePath: normalized.path,
    contentClass: routed.content_class,
    proposalId,
    elevatedOverride: routed.elevated_override,
    evaluationBlock: routed.evaluation_block,
  });
}

/**
 * Full ingest pipeline after auth: normalize, idempotency, route, bill, execute.
 * @param {object} args
 */
export async function processAutomationIngest(args) {
  const {
    rawBody,
    idempotencyHeader,
    actor,
    rules,
    triggers,
    io,
    requireContract = false,
  } = args;
  const normalized = normalizeIngestBody(rawBody, { requireContract });
  const key = idempotencyKeyFromRequest(idempotencyHeader, normalized.source_fingerprint);
  const storeKey = idempotencyStoreKey(actor.sub, actor.vaultId || 'default', key);
  const now = Date.now();
  const prior = await io.getIdempotency(storeKey);
  if (prior && Number(prior.expires_at) > now) {
    if (prior.source_fingerprint !== normalized.source_fingerprint || prior.path !== normalized.path) {
      throw ingestHttpError(409, 'INGEST_IDEMPOTENCY_CONFLICT', 'idempotency key reused with different payload');
    }
    const result = { ...(prior.result || {}), replayed: true };
    const routedLite = {
      rule_id: result.rule_id ?? null,
      disposition: result.disposition || 'review_queue',
      content_class: result.content_class || normalized.content_class || 'general',
      elevated_override: Boolean(result.elevated_override),
      evaluation_block: Boolean(result.evaluation_block),
    };
    await io.appendAudit(
      'ingest_routed',
      ingestAuditDetail({
        ruleId: routedLite.rule_id,
        disposition: routedLite.disposition,
        sourceFingerprint: normalized.source_fingerprint,
        notePath: normalized.path,
        contentClass: routedLite.content_class,
        vaultId: actor.vaultId || 'default',
        credentialId: actor.credentialId || null,
        elevatedOverride: routedLite.elevated_override,
        evaluationBlock: routedLite.evaluation_block,
        replayed: true,
      }),
      result.proposal_id || ''
    );
    await io.appendAudit(
      'ingest_idempotent_replay',
      ingestAuditDetail({
        ruleId: routedLite.rule_id,
        disposition: routedLite.disposition,
        sourceFingerprint: normalized.source_fingerprint,
        notePath: normalized.path,
        contentClass: routedLite.content_class,
        vaultId: actor.vaultId || 'default',
        credentialId: actor.credentialId || null,
        elevatedOverride: routedLite.elevated_override,
        evaluationBlock: routedLite.evaluation_block,
        replayed: true,
      }),
      result.proposal_id || ''
    );
    return { status: 200, body: result };
  }

  const routed = routeAutomationIngest(
    {
      path: normalized.path,
      body: normalized.body,
      intent: normalized.intent,
      labels: normalized.labels,
      content_class: normalized.content_class,
      credential_id: actor.credentialId || null,
      credential_name: actor.credentialName || null,
      evaluationRequired: actor.evaluationRequired === true,
      sessionBound: actor.sessionBound === true,
      triggers,
    },
    rules
  );

  const billOp = routed.disposition === 'review_queue' ? 'proposal_write' : 'note_write';
  const billed = await io.runBilling(billOp);
  if (billed === false) return { billed: false };

  const body = await executeAutomationIngest({ normalized, routed, actor, io });
  await io.putIdempotency(storeKey, {
    source_fingerprint: normalized.source_fingerprint,
    path: normalized.path,
    result: body,
    created_at: now,
    expires_at: now + IDEMPOTENCY_TTL_MS,
  });
  return { status: 201, body };
}

export function sendIngestError(res, err) {
  const status = Number(err && err.status) || 500;
  const code = err && err.code ? String(err.code) : 'RUNTIME_ERROR';
  const payload = {
    error: err && err.message ? err.message : code,
    code,
    ...(err && err.extra && typeof err.extra === 'object' ? err.extra : {}),
  };
  return res.status(status).json(payload);
}
