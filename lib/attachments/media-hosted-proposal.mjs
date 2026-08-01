/**
 * Hosted media proposal parity (SEC-SEAM-MEDIA-b — SM-C2/C3/C4/C5).
 *
 * Media proposals (`source: media`) must live in the canister proposal store so Hub
 * Activity can list them. The canister has no `source` / `media_meta` columns — those
 * ride in frontmatter (task/capture pattern, G20). Approve apply runs via
 * `POST …/attachments/proposals/:id/apply-approved` (gateway hook after approve) using
 * the SAME `precheckApprovedMediaProposal` + `reconcileApprovedMediaProposal` pair as
 * self-hosted Hub approve — no hosted-only precheck fork (SM-C5).
 *
 * S3.0 (load-bearing): `normalizeCanisterProposalForMediaPrecheck` is BOTH the gateway
 * hook trigger (hub/gateway/media-approve-hosted.mjs) AND an `isSeamSurfaceProposal`
 * condition (lib/hub-proposal-personal-self-apply.mjs), shipped in the same change —
 * never a hand-written kind/intent list.
 *
 * media_attach hosted note I/O uses the SM-C5 **temp-stage** option: GET the canister
 * note → stage into a per-request temp vaultPath → run the shared precheck/reconcile →
 * POST the mutated note back to the canister notes surface (`api/v1/notes` family,
 * hub/icp/src/hub/main.mo notes routes) → discard the temp dir. No Netlify-local vault
 * filesystem walk is required at apply: the propose-time `media_pointer` stamp is
 * preferred over `resolveMediaPointerForAttach` (G22).
 *
 * @see docs/SEC-SEAM-MEDIA-FREEZE.md
 * @see lib/task/task-hosted-proposal.mjs (pattern sibling)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

import { parseCanisterProposalGetBody } from '../canister-proposal-response-parse.mjs';
import { readNote, resolveVaultRelativePath } from '../vault.mjs';
import {
  MEDIA_PROPOSAL_SOURCE,
  precheckApprovedMediaProposal,
  reconcileApprovedMediaProposal,
  resolveMediaPointerForAttach,
} from './attachment-write.mjs';

export const FM_PROPOSAL_SOURCE = 'knowtation_proposal_source';
export const FM_MEDIA_PROPOSAL_KIND = 'media_proposal_kind';
export const FM_MEDIA_ATTACHMENT_ID = 'attachment_id';
export const FM_MEDIA_CONNECTOR_ID = 'connector_id';
export const FM_MEDIA_CONSENT_ID = 'consent_id';
export const FM_MEDIA_NOTE_REF = 'note_ref';
export const FM_MEDIA_POINTER = 'media_pointer';

/** Closed media kind set — anything else fails closed to null (SM-C2). */
const MEDIA_PROPOSAL_KINDS = new Set(['media_external_link', 'media_attach']);

/**
 * @param {unknown} frontmatter
 * @returns {Record<string, unknown>}
 */
export function parseProposalFrontmatter(frontmatter) {
  if (frontmatter == null) return {};
  if (typeof frontmatter === 'object' && !Array.isArray(frontmatter)) {
    return /** @type {Record<string, unknown>} */ (frontmatter);
  }
  if (typeof frontmatter === 'string' && frontmatter.trim()) {
    try {
      const parsed = JSON.parse(frontmatter);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? /** @type {Record<string, unknown>} */ (parsed)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Embed media metadata in canister frontmatter JSON (canister has no media_meta column).
 *
 * @param {Record<string, unknown>|undefined|null} baseFm
 * @param {{
 *   proposal_kind: string,
 *   attachment_id?: string|null,
 *   connector_id?: string|null,
 *   consent_id?: string|null,
 *   note_ref?: string|null,
 *   media_pointer?: string|null,
 * }} mediaMeta
 * @returns {Record<string, unknown>}
 */
export function mergeMediaFrontmatter(baseFm, mediaMeta) {
  const fm = {
    ...(baseFm && typeof baseFm === 'object' && !Array.isArray(baseFm) ? baseFm : {}),
  };
  fm[FM_PROPOSAL_SOURCE] = MEDIA_PROPOSAL_SOURCE;
  fm[FM_MEDIA_PROPOSAL_KIND] = String(mediaMeta.proposal_kind || '').slice(0, 32);
  if (mediaMeta.attachment_id != null && String(mediaMeta.attachment_id).trim()) {
    fm[FM_MEDIA_ATTACHMENT_ID] = String(mediaMeta.attachment_id).slice(0, 64);
  }
  if (mediaMeta.connector_id != null && String(mediaMeta.connector_id).trim()) {
    fm[FM_MEDIA_CONNECTOR_ID] = String(mediaMeta.connector_id).slice(0, 64);
  }
  if (mediaMeta.consent_id != null && String(mediaMeta.consent_id).trim()) {
    fm[FM_MEDIA_CONSENT_ID] = String(mediaMeta.consent_id).slice(0, 64);
  }
  if (mediaMeta.note_ref != null && String(mediaMeta.note_ref).trim()) {
    fm[FM_MEDIA_NOTE_REF] = String(mediaMeta.note_ref).slice(0, 512);
  }
  if (mediaMeta.media_pointer != null && String(mediaMeta.media_pointer).trim()) {
    fm[FM_MEDIA_POINTER] = String(mediaMeta.media_pointer).slice(0, 256);
  }
  return fm;
}

/**
 * @param {Record<string, unknown>} proposal
 * @returns {Record<string, unknown>|null}
 */
function bodyObjectOf(proposal) {
  try {
    const parsed = JSON.parse(typeof proposal.body === 'string' ? proposal.body : '');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>|null|undefined} obj
 * @param {string} key
 * @returns {string}
 */
function stringField(obj, key) {
  if (!obj || typeof obj !== 'object') return '';
  const v = /** @type {Record<string, unknown>} */ (obj)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

/**
 * Map a canister proposal row into the shape the shared media precheck / seam
 * classification expect (`source: media` + `media_meta`) — SM-C2.
 *
 * Recognition (minimum union, mirroring the task normalizer G20): frontmatter
 * `knowtation_proposal_source === 'media'`, OR `proposal.source === 'media'`, OR
 * path prefix `meta/media/proposals/`. The proposal must additionally carry a
 * resolvable media kind (`media_external_link` | `media_attach`) from frontmatter /
 * `media_meta` / body JSON — otherwise fail-closed `null`.
 *
 * Total over arbitrary input (object guards + defensive parse); never throws.
 *
 * @param {Record<string, unknown>|null|undefined} proposal
 * @returns {Record<string, unknown>|null}
 */
export function normalizeCanisterProposalForMediaPrecheck(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;

  const fm = parseProposalFrontmatter(proposal.frontmatter);
  const fromFm = fm[FM_PROPOSAL_SOURCE] === MEDIA_PROPOSAL_SOURCE;
  const fromSource = proposal.source === MEDIA_PROPOSAL_SOURCE;
  const fromPath =
    typeof proposal.path === 'string' &&
    proposal.path.replace(/^\/+/, '').startsWith('meta/media/proposals/');

  if (!fromFm && !fromSource && !fromPath) return null;

  const meta =
    proposal.media_meta && typeof proposal.media_meta === 'object' && !Array.isArray(proposal.media_meta)
      ? /** @type {Record<string, unknown>} */ (proposal.media_meta)
      : null;
  const body = bodyObjectOf(proposal);

  const kind =
    stringField(fm, FM_MEDIA_PROPOSAL_KIND) ||
    stringField(fm, 'proposal_kind') ||
    stringField(meta, 'proposal_kind') ||
    stringField(meta, 'record_kind') ||
    stringField(body, 'proposal_kind');
  if (!MEDIA_PROPOSAL_KINDS.has(kind)) return null;

  /** @type {Record<string, unknown>} */
  const media_meta = {
    record_kind: kind,
    proposal_kind: kind,
  };

  const attachmentId =
    stringField(fm, FM_MEDIA_ATTACHMENT_ID) ||
    stringField(meta, 'attachment_id') ||
    stringField(body, 'attachment_id');
  if (attachmentId) media_meta.attachment_id = attachmentId;

  const connectorId =
    stringField(fm, FM_MEDIA_CONNECTOR_ID) ||
    stringField(meta, 'connector_id') ||
    stringField(body, 'connector_id');
  media_meta.connector_id = connectorId || null;

  const consentId =
    stringField(fm, FM_MEDIA_CONSENT_ID) ||
    stringField(meta, 'consent_id') ||
    stringField(body, 'consent_id');
  media_meta.consent_id = consentId || null;

  const noteRef =
    stringField(fm, FM_MEDIA_NOTE_REF) ||
    stringField(meta, 'note_ref') ||
    stringField(body, 'note_ref');
  media_meta.note_ref = noteRef || null;

  const mediaPointer =
    stringField(fm, FM_MEDIA_POINTER) ||
    stringField(meta, 'media_pointer') ||
    stringField(body, 'media_pointer');
  if (mediaPointer) media_meta.media_pointer = mediaPointer;

  return {
    ...proposal,
    source: MEDIA_PROPOSAL_SOURCE,
    media_meta,
  };
}

/**
 * POST a media proposal to the canister (hosted bridge propose path — SM-C3).
 *
 * Embeds media markers via {@link mergeMediaFrontmatter} so canister rows survive
 * without a `media_meta` column. E1 create-time evaluation satisfaction runs through
 * the existing `applyPersonalSelfApplyEvaluationE1` path (task hosted parity) — the
 * E1 body carries `source: media` + `media_meta` so the T5 fingerprint can evaluate.
 *
 * @param {{
 *   canisterUrl: string,
 *   sessionBound?: boolean,
 *   headers: Record<string, string>,
 *   input: {
 *     path: string,
 *     body?: string,
 *     intent?: string,
 *     frontmatter?: Record<string, unknown>,
 *     base_state_id?: string,
 *     external_ref?: string,
 *     media_meta?: {
 *       record_kind?: string,
 *       proposal_kind: string,
 *       attachment_id?: string|null,
 *       connector_id?: string|null,
 *       consent_id?: string|null,
 *       note_ref?: string|null,
 *       media_pointer?: string|null,
 *     },
 *     vault_id?: string,
 *     review_queue?: string,
 *     proposed_by?: string,
 *   },
 * }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createMediaProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted media proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const mediaMeta = input.media_meta ?? { proposal_kind: '' };
  const frontmatter = mergeMediaFrontmatter(input.frontmatter, {
    proposal_kind: mediaMeta.proposal_kind,
    attachment_id: mediaMeta.attachment_id,
    connector_id: mediaMeta.connector_id,
    consent_id: mediaMeta.consent_id,
    note_ref: mediaMeta.note_ref,
    media_pointer: mediaMeta.media_pointer,
  });

  /** @type {Record<string, unknown>} */
  const payload = {
    path: input.path,
    body: input.body ?? '',
    intent: input.intent ?? '',
    frontmatter,
  };
  if (input.base_state_id) payload.base_state_id = input.base_state_id;
  if (input.review_queue) payload.review_queue = input.review_queue;
  if (input.external_ref) payload.external_ref = input.external_ref;

  // E1 create-time satisfaction for admitted Media fingerprints (pending path allowed;
  // Motoko rewrites meta/media/proposals/pending.json to the real proposal_id).
  const { applyPersonalSelfApplyEvaluationE1 } = await import('../hub-proposal-personal-self-apply.mjs');
  const e1Body = applyPersonalSelfApplyEvaluationE1(
    {
      ...payload,
      source: MEDIA_PROPOSAL_SOURCE,
      media_meta: input.media_meta,
      external_ref: input.external_ref,
      status: 'proposed',
    },
    {
      evaluatedBy: typeof input.proposed_by === 'string' ? input.proposed_by : '',
      authorActorId: typeof input.proposed_by === 'string' ? input.proposed_by : '',
      sessionBound: opts.sessionBound === true,
    },
  );
  if (e1Body.evaluation_status === 'passed') {
    payload.evaluation_status = 'passed';
    if (e1Body.evaluated_by) payload.evaluated_by = e1Body.evaluated_by;
    if (e1Body.evaluated_at) payload.evaluated_at = e1Body.evaluated_at;
  }

  const res = await fetch(`${base}/api/v1/proposals`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = new Error(
      typeof json.error === 'string' ? json.error : text || `Canister proposal create ${res.status}`,
    );
    err.status = res.status;
    err.code = typeof json.code === 'string' ? json.code : 'UPSTREAM_ERROR';
    throw err;
  }

  const proposalId = typeof json.proposal_id === 'string' ? json.proposal_id : '';
  if (!proposalId) {
    const err = new Error('Canister proposal create missing proposal_id');
    err.status = 502;
    err.code = 'BAD_GATEWAY';
    throw err;
  }

  const now = new Date().toISOString();
  return {
    proposal_id: proposalId,
    path: typeof json.path === 'string' ? json.path : input.path,
    status: typeof json.status === 'string' ? json.status : 'proposed',
    vault_id: input.vault_id,
    intent: input.intent,
    body: input.body,
    frontmatter,
    base_state_id: input.base_state_id,
    external_ref: input.external_ref,
    source: MEDIA_PROPOSAL_SOURCE,
    media_meta: input.media_meta,
    review_queue: input.review_queue,
    proposed_by: input.proposed_by,
    evaluation_status: e1Body.evaluation_status,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Fetch one proposal from the canister and normalize for media apply.
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 * }} opts
 * @returns {Promise<{ ok: true, proposal: Record<string, unknown> } | { ok: false, status: number, code: string, error: string }>}
 */
export async function fetchCanisterProposalForMedia(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  const proposalId = String(opts.proposalId || '').trim();
  if (!base || !proposalId) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'canisterUrl and proposalId required' };
  }

  let res;
  let text;
  try {
    res = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(proposalId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...opts.headers },
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 502, code: 'BAD_GATEWAY', error: e?.message || 'Canister fetch failed' };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 404 ? 404 : 502,
      code: res.status === 404 ? 'NOT_FOUND' : 'BAD_GATEWAY',
      error: text.slice(0, 200) || `Canister GET proposal ${res.status}`,
    };
  }

  const raw = parseCanisterProposalGetBody(proposalId, text, {});
  const normalized = normalizeCanisterProposalForMediaPrecheck(raw);
  if (!normalized) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', error: 'Not a media proposal' };
  }
  return { ok: true, proposal: normalized };
}

/**
 * @param {string} noteRef
 * @returns {string}
 */
export function notePathFromRef(noteRef) {
  return noteRef.startsWith('note:') ? noteRef.slice(5) : noteRef;
}

/**
 * Serialize a staged note exactly like lib/write.mjs `toMarkdown` (yaml frontmatter
 * fence + body) so `readNote` / `noteStateIdFromParts` see the same shape at propose
 * staging and at apply staging.
 *
 * @param {Record<string, unknown>} frontmatter
 * @param {string} body
 * @returns {string}
 */
function stagedNoteMarkdown(frontmatter, body) {
  const y = yaml.dump(frontmatter ?? {}, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${y}\n---\n${body || ''}`;
}

/**
 * GET one note from the canister notes surface.
 *
 * @param {{ canisterUrl: string, headers: Record<string, string>, notePath: string }} opts
 * @returns {Promise<{ ok: true, frontmatter: Record<string, unknown>, body: string } | { ok: false, status: number, code: string, error: string }>}
 */
export async function fetchCanisterNote(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  let res;
  let text;
  try {
    res = await fetch(`${base}/api/v1/notes/${encodeURIComponent(opts.notePath)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...opts.headers },
    });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 502, code: 'BAD_GATEWAY', error: e?.message || 'Canister note fetch failed' };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 404 ? 404 : 502,
      code: res.status === 404 ? 'NOT_FOUND' : 'BAD_GATEWAY',
      error: text.slice(0, 200) || `Canister GET note ${res.status}`,
    };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: 502, code: 'BAD_GATEWAY', error: 'Canister note response not JSON' };
  }
  const frontmatter = parseProposalFrontmatter(json?.frontmatter);
  const body = typeof json?.body === 'string' ? json.body : '';
  return { ok: true, frontmatter, body };
}

/**
 * Stage one canister note into a fresh temp vault dir (SM-C5 temp-stage option).
 *
 * Also used by the bridge attach-propose route so `handleMediaAttachProposeRequest`
 * can validate note existence + `base_state_id` against the canister-fresh note.
 *
 * @param {{ canisterUrl: string, headers: Record<string, string>, notePath: string }} opts
 * @returns {Promise<{ vaultPath: string, staged: boolean, cleanup: () => void } | { error: { ok: false, status: number, code: string, error: string } }>}
 */
export async function stageCanisterNoteToTempVault(opts) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-media-apply-'));
  const cleanup = () => {
    try {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  };

  const fetched = await fetchCanisterNote(opts);
  if (!fetched.ok) {
    if (fetched.status === 404) {
      // Missing target note is a precheck concern: run the shared precheck against
      // the empty staged vault so the refusal code stays MEDIA_LINEAGE_CONFLICT.
      return { vaultPath, staged: false, cleanup };
    }
    cleanup();
    return { error: fetched };
  }

  try {
    const safe = resolveVaultRelativePath(vaultPath, opts.notePath);
    const full = path.join(vaultPath, safe);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, stagedNoteMarkdown(fetched.frontmatter, fetched.body), 'utf8');
  } catch (e) {
    cleanup();
    return { error: { ok: false, status: 500, code: 'RUNTIME_ERROR', error: e?.message || 'stage failed' } };
  }
  return { vaultPath, staged: true, cleanup };
}

/**
 * Apply an approved canister media proposal on the bridge (SM-C4).
 *
 * Ordered per SM-C4: fetch + normalize (400) → approved gate (409, unless
 * `requireApproved === false` for CHA-C11-style ops recovery) → shared precheck
 * (refusal codes pass through untouched; no store/note mutate on refusal) → shared
 * apply → payload. Blob hydrate/persist is the caller's job (bridge route wraps this
 * in `withMediaBlobSync` — SM-C6).
 *
 * `media_external_link` runs entirely on bridge dataDir stores (G23).
 * `media_attach` uses the temp-stage canister note read-modify-write (SM-C5): the
 * shared precheck enforces `base_state_id` against the canister-fresh note, and the
 * shared reconcile prefers the propose-time `media_pointer` stamp so no vault-wide
 * mist walk runs on the bridge lambda (G22).
 *
 * @param {{
 *   dataDir: string,
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   proposalId: string,
 *   requireApproved?: boolean,
 *   vaultId?: string,
 *   vaultPath?: string,
 *   vaultConfig?: object,
 * }} opts
 * @returns {Promise<{ ok: true, payload: Record<string, unknown> } | { ok: false, status: number, code: string, error: string }>}
 */
export async function applyApprovedMediaProposalFromCanister(opts) {
  const fetched = await fetchCanisterProposalForMedia({
    canisterUrl: opts.canisterUrl,
    headers: opts.headers,
    proposalId: opts.proposalId,
  });
  if (!fetched.ok) return fetched;

  const proposal = fetched.proposal;
  // Canister rows carry no vault_id column; the shared precheck keys the
  // connector/consent/external-ref stores by vault, so inject the bridge vault
  // context (task/capture apply parity).
  if (opts.vaultId && (typeof proposal.vault_id !== 'string' || !proposal.vault_id.trim())) {
    proposal.vault_id = opts.vaultId;
  }
  if (opts.requireApproved !== false && proposal.status !== 'approved') {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      error: 'Proposal must be approved before media apply',
    };
  }

  const meta = /** @type {Record<string, unknown>} */ (proposal.media_meta ?? {});
  const proposalKind = typeof meta.proposal_kind === 'string' ? meta.proposal_kind : '';

  if (proposalKind === 'media_external_link') {
    const precheck = precheckApprovedMediaProposal(opts.dataDir, proposal, {
      vaultPath: opts.vaultPath ?? opts.dataDir,
      vaultConfig: opts.vaultConfig ?? {},
    });
    if (!precheck.ok) {
      return { ok: false, status: precheck.status, code: precheck.code, error: precheck.error };
    }
    reconcileApprovedMediaProposal(opts.dataDir, precheck);
    return {
      ok: true,
      payload: {
        applied: true,
        proposal_id: opts.proposalId,
        vault_id: precheck.vaultId,
        proposal_kind: precheck.proposalKind,
        attachment_id: precheck.attachmentId,
        connector_id: precheck.connectorId ?? null,
      },
    };
  }

  if (proposalKind === 'media_attach') {
    const noteRefRaw = typeof meta.note_ref === 'string' && meta.note_ref.trim() ? meta.note_ref.trim() : '';
    if (!noteRefRaw) {
      return { ok: false, status: 400, code: 'MEDIA_DRAFT_INVALID', error: 'missing media note_ref' };
    }
    const notePath = notePathFromRef(noteRefRaw);

    const staged = await stageCanisterNoteToTempVault({
      canisterUrl: opts.canisterUrl,
      headers: opts.headers,
      notePath,
    });
    if ('error' in staged) return staged.error;

    try {
      const precheck = precheckApprovedMediaProposal(opts.dataDir, proposal, {
        vaultPath: staged.vaultPath,
        vaultConfig: opts.vaultConfig ?? {},
      });
      if (!precheck.ok) {
        return { ok: false, status: precheck.status, code: precheck.code, error: precheck.error };
      }

      // Capture the note BEFORE reconcile: lib/write.mjs `writeNote` String()-coerces
      // frontmatter arrays (existing quirk), which would turn attachments[] into a
      // comma-joined string. Hosted RMW posts a real array to the canister notes
      // surface, so we apply the same append logic the shared reconcile uses and
      // serialize via stagedNoteMarkdown (yaml-preserving) before POST.
      const before = readNote(staged.vaultPath, precheck.notePath);
      reconcileApprovedMediaProposal(opts.dataDir, precheck);

      const pointer =
        typeof precheck.mediaPointer === 'string' && precheck.mediaPointer.trim()
          ? precheck.mediaPointer.trim()
          : resolveMediaPointerForAttach(
              staged.vaultPath,
              opts.vaultConfig ?? {},
              String(precheck.attachmentId || ''),
            );
      if (!pointer) {
        return {
          ok: false,
          status: 500,
          code: 'RUNTIME_ERROR',
          error: 'media pointer could not be resolved at apply',
        };
      }
      const fm = { ...(before.frontmatter ?? {}) };
      const attachments = Array.isArray(fm.attachments) ? [...fm.attachments] : [];
      if (!attachments.includes(pointer)) attachments.push(pointer);
      fm.attachments = attachments;
      fm.updated = new Date().toISOString();

      const base = String(opts.canisterUrl || '').replace(/\/$/, '');
      let postRes;
      let postText;
      try {
        postRes = await fetch(`${base}/api/v1/notes`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...opts.headers,
          },
          body: JSON.stringify({
            path: precheck.notePath,
            body: before.body ?? '',
            frontmatter: fm,
          }),
        });
        postText = await postRes.text();
      } catch (e) {
        return { ok: false, status: 502, code: 'BAD_GATEWAY', error: e?.message || 'Canister note write failed' };
      }
      if (!postRes.ok) {
        return {
          ok: false,
          status: 502,
          code: 'BAD_GATEWAY',
          error: (postText || '').slice(0, 200) || `Canister note write ${postRes.status}`,
        };
      }

      return {
        ok: true,
        payload: {
          applied: true,
          proposal_id: opts.proposalId,
          vault_id: precheck.vaultId,
          proposal_kind: precheck.proposalKind,
          attachment_id: precheck.attachmentId,
          note_ref: precheck.noteRef,
        },
      };
    } finally {
      staged.cleanup();
    }
  }

  return { ok: false, status: 400, code: 'MEDIA_DRAFT_INVALID', error: 'unknown media proposal_kind' };
}
