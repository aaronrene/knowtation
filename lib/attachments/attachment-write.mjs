/**
 * Media write proposal facade (Phase 2F-b-d-kn-b).
 *
 * Typed facade over `/proposals` (SD-4): external link + attach + import consent.
 * Canonical mutation only at approve→apply via {@link reconcileApprovedMediaProposal}.
 *
 * @see docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { absentNoteStateId, noteStateIdFromParts } from '../note-state-id.mjs';
import { resolveFlowWriteAuthority } from '../flow/flow-scope.mjs';
import { resolveHandlerVisibleScopes } from '../flow/flow-handlers.mjs';
import { hashPrincipalRef } from '../agent/delegation.mjs';
import { readNote, noteFileExistsInVault } from '../vault.mjs';
import { writeNote } from '../write.mjs';
import { MIST_ID_RE } from './attachment-store.mjs';
import {
  getAttachment,
  deriveAttachmentId,
  NOTE_REF_RE,
  ATTACHMENT_ID_RE,
  inferNoteScope,
} from './attachment-store.mjs';
import { resolveAttachmentVaultPath } from './attachment-handlers.mjs';
import {
  CONNECTOR_ID_RE,
  getEnabledConnector,
  getVaultConnectors,
  loadMediaConnectorPolicy,
  saveMediaConnectorPolicy,
} from './media-connector-policy.mjs';
import {
  CONSENT_ID_RE,
  getActiveConsent,
  listVaultConsents,
  loadMediaImportConsentStore,
  saveMediaImportConsentStore,
  mintConsentId,
} from './media-import-consent.mjs';
import { getExternalRef, upsertExternalRef } from './attachment-external-ref-store.mjs';
import {
  SCOOLING_MEDIA_EXTERNAL_REF_RE,
  resolveOptionalScoolingExternalRef,
  readProposeExternalRefRaw,
} from '../scooling-external-ref.mjs';

export const OPAQUE_REF_RE = /^[A-Za-z0-9._:#-]{1,256}$/;
export const MEDIA_WRITE_POLICY_FILE = 'hub_media_write_policy.json';
export const MEDIA_PROPOSAL_SCHEMA = 'knowtation.media_proposal/v0';
export const MEDIA_PROPOSAL_SOURCE = 'media';
export const MEDIA_REVIEW_QUEUE = 'media-writes';
export const MAX_MEDIA_INTENT_CHARS = 2000;

/** @typedef {'personal'|'project'|'org'} MediaScope */

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
 * @returns {{ media_external_link_enabled?: boolean, media_attach_enabled?: boolean }}
 */
export function readMediaWritePolicyFile(dataDir) {
  if (!dataDir) return {};
  const fp = path.join(dataDir, MEDIA_WRITE_POLICY_FILE);
  try {
    if (!fs.existsSync(fp)) return {};
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!j || typeof j !== 'object') return {};
    const out = {};
    if (typeof j.media_external_link_enabled === 'boolean') {
      out.media_external_link_enabled = j.media_external_link_enabled;
    }
    if (typeof j.media_attach_enabled === 'boolean') {
      out.media_attach_enabled = j.media_attach_enabled;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getMediaExternalLinkEnabled(dataDir) {
  const fromEnv = envTriState(process.env.MEDIA_EXTERNAL_LINK_ENABLED);
  if (fromEnv !== null) return fromEnv;
  return readMediaWritePolicyFile(dataDir).media_external_link_enabled === true;
}

/**
 * @param {string} dataDir
 * @returns {boolean}
 */
export function getMediaAttachEnabled(dataDir) {
  const fromEnv = envTriState(process.env.MEDIA_ATTACH_ENABLED);
  if (fromEnv !== null) return fromEnv;
  return readMediaWritePolicyFile(dataDir).media_attach_enabled === true;
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
 * @param {string} connectorId
 * @param {string} opaqueRef
 * @returns {string}
 */
export function deriveLinkAttachmentId(connectorId, opaqueRef) {
  const token = crypto
    .createHash('sha256')
    .update(`link:${connectorId}|${opaqueRef}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `att_link_${token}`;
}

/**
 * @param {Set<MediaScope>} visibleScopes
 * @param {MediaScope} targetScope
 */
export function resolveAttachmentWriteAuthority(visibleScopes, targetScope) {
  const authority = resolveFlowWriteAuthority(visibleScopes, targetScope);
  if (!authority.ok) {
    return {
      ok: false,
      status: authority.status,
      error:
        authority.code === 'FLOW_SCOPE_DENIED'
          ? 'Attachment write scope not authorized'
          : authority.error,
      code:
        authority.code === 'FLOW_SCOPE_DENIED'
          ? 'ATTACHMENT_SCOPE_DENIED'
          : authority.code === 'FLOW_DRAFT_INVALID'
            ? 'MEDIA_DRAFT_INVALID'
            : authority.code,
    };
  }
  return { ok: true };
}

/**
 * @param {object} input
 */
function resolveWriteScopes(input) {
  return resolveHandlerVisibleScopes(input);
}

/**
 * @param {string} noteRef
 * @returns {string}
 */
function notePathFromRef(noteRef) {
  return noteRef.startsWith('note:') ? noteRef.slice(5) : noteRef;
}

/**
 * @param {string} proposalId
 * @returns {string}
 */
function mediaProposalMirrorPath(proposalId) {
  return `meta/media/proposals/${proposalId}.json`;
}

/**
 * @param {string} dataDir
 * @param {string} proposalId
 */
function updateProposalPath(dataDir, proposalId) {
  const fp = path.join(dataDir, 'hub_proposals.json');
  if (!fs.existsSync(fp)) return;
  const all = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const idx = all.findIndex((p) => p.proposal_id === proposalId);
  if (idx >= 0) {
    all[idx].path = mediaProposalMirrorPath(proposalId);
    fs.writeFileSync(fp, JSON.stringify(all, null, 2), 'utf8');
  }
}

/**
 * @param {object} input
 * @param {object} proposalInput
 */
async function createProposalRecord(input, proposalInput) {
  const withSession = {
    ...proposalInput,
    ...(typeof input.sessionBound === 'boolean' ? { session_bound: input.sessionBound } : {}),
  };
  return await Promise.resolve(input.createProposal(input.dataDir, withSession));
}

/**
 * Optional Scooling media external_ref on propose (§FCA.4.2). Malformed → 400; absent → ok.
 * @param {object} input
 * @returns {{ ok: true, externalRef: string|undefined } | ReturnType<typeof refuse>}
 */
function resolveMediaProposeExternalRef(input) {
  const resolved = resolveOptionalScoolingExternalRef(
    readProposeExternalRefRaw(input),
    SCOOLING_MEDIA_EXTERNAL_REF_RE,
  );
  if (!resolved.ok) {
    return refuse(resolved.status, resolved.code, resolved.error);
  }
  return { ok: true, externalRef: resolved.externalRef };
}


/**
 * @param {string} vaultPath
 * @param {object} vaultConfig
 * @param {string} attachmentId
 * @returns {string|null}
 */
export function resolveMediaPointerForAttach(vaultPath, vaultConfig, attachmentId) {
  if (attachmentId.startsWith('att_mist_')) {
    const notesDir = path.join(vaultPath);
    const walkNotes = (dir, prefix) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = walkNotes(full, rel);
          if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const note = readNote(vaultPath, rel);
            const attachments = note.frontmatter?.attachments;
            if (!Array.isArray(attachments)) continue;
            for (const raw of attachments) {
              if (typeof raw !== 'string' || !MIST_ID_RE.test(raw)) continue;
              if (deriveAttachmentId('mist', `mist:${raw}`) === attachmentId) {
                return raw;
              }
            }
          } catch {
            /* skip unreadable */
          }
        }
      }
      return null;
    };
    return walkNotes(notesDir, '');
  }
  return attachmentId;
}

/**
 * @param {object} fields
 */
function buildMediaProposalEnvelope(fields) {
  return {
    ok: true,
    payload: {
      schema: MEDIA_PROPOSAL_SCHEMA,
      proposal_id: fields.proposal_id,
      proposal_kind: fields.proposal_kind,
      attachment_id: fields.attachment_id,
      note_ref: fields.note_ref ?? null,
      connector_id: fields.connector_id ?? null,
      scope: fields.scope,
      base_state_id: fields.base_state_id,
      external_ref: fields.external_ref ?? null,
      auto_approvable: false,
      status: 'proposed',
      review_queue: MEDIA_REVIEW_QUEUE,
    },
  };
}

/**
 * External-link proposal create.
 *
 * @param {object} input
 */
export async function handleMediaLinkProposeRequest(input) {
  if (!getMediaExternalLinkEnabled(input.dataDir)) {
    return refuse(403, 'MEDIA_EXTERNAL_LINK_DISABLED', 'Media external link is disabled');
  }
  if (typeof input.createProposal !== 'function') {
    return refuse(500, 'RUNTIME_ERROR', 'createProposal is required');
  }

  const intentRaw = typeof input.intent === 'string' ? input.intent.trim() : '';
  if (!intentRaw) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'intent is required');
  }
  if (intentRaw.length > MAX_MEDIA_INTENT_CHARS) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'intent too long');
  }

  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'ATTACHMENT_SCOPE_AMBIGUOUS', 'Ambiguous attachment scope');
  }

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
  const connectorId = typeof body.connector_id === 'string' ? body.connector_id.trim() : '';
  const opaqueRef = typeof body.opaque_ref === 'string' ? body.opaque_ref.trim() : '';
  const consentId = typeof body.consent_id === 'string' ? body.consent_id.trim() : '';
  const displayLabel =
    typeof body.display_label === 'string' && body.display_label.trim()
      ? body.display_label.trim().slice(0, 256)
      : connectorId || 'External link';

  if (!scope || !['personal', 'project', 'org'].includes(scope)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'scope is required');
  }
  if (!CONNECTOR_ID_RE.test(connectorId)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid connector_id');
  }
  if (!OPAQUE_REF_RE.test(opaqueRef)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid opaque_ref');
  }
  if (!CONSENT_ID_RE.test(consentId)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid consent_id');
  }

  const authority = resolveAttachmentWriteAuthority(resolved.visibleScopes, /** @type {MediaScope} */ (scope));
  if (!authority.ok) return authority;

  if (!getEnabledConnector(input.dataDir, input.vaultId, connectorId)) {
    return refuse(403, 'MEDIA_CONNECTOR_DENIED', 'Connector not allowlisted');
  }

  const consentStore = loadMediaImportConsentStore(input.dataDir);
  const consentRecord = consentStore.vaults?.[input.vaultId]?.consents?.[consentId];
  if (
    !consentRecord ||
    consentRecord.status !== 'active' ||
    consentRecord.connector_id !== connectorId ||
    consentRecord.scope !== scope
  ) {
    return refuse(403, 'MEDIA_IMPORT_CONSENT_REQUIRED', 'Active import consent required');
  }
  if (consentRecord.expires_at != null) {
    const exp = new Date(consentRecord.expires_at).getTime();
    if (!Number.isNaN(exp) && exp <= Date.now()) {
      return refuse(403, 'MEDIA_IMPORT_CONSENT_REQUIRED', 'Import consent expired');
    }
  }

  const attachmentId = deriveLinkAttachmentId(connectorId, opaqueRef);
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'derived attachment_id invalid');
  }

  if (getExternalRef(input.dataDir, input.vaultId, attachmentId)) {
    return refuse(409, 'MEDIA_LINEAGE_CONFLICT', 'External reference already exists');
  }

  const baseStateId = absentNoteStateId();
  const proposalBody = JSON.stringify(
    {
      proposal_kind: 'media_external_link',
      connector_id: connectorId,
      opaque_ref: opaqueRef,
      display_label: displayLabel,
      consent_id: consentId,
      scope,
      attachment_id: attachmentId,
    },
    null,
    2,
  );

  const ext = resolveMediaProposeExternalRef(input);
  if (!ext.ok) return ext;

  const proposal = await createProposalRecord(input, {
    path: mediaProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: {
      type: 'media_proposal',
      proposal_kind: 'media_external_link',
      attachment_id: attachmentId,
    },
    intent: intentRaw,
    base_state_id: baseStateId,
    source: MEDIA_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by:
      typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: MEDIA_REVIEW_QUEUE,
    ...(ext.externalRef ? { external_ref: ext.externalRef } : {}),
    media_meta: {
      record_kind: 'media_external_link',
      proposal_kind: 'media_external_link',
      attachment_id: attachmentId,
      connector_id: connectorId,
      consent_id: consentId,
      note_ref: null,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return buildMediaProposalEnvelope({
    proposal_id: proposal.proposal_id,
    proposal_kind: 'media_external_link',
    attachment_id: attachmentId,
    note_ref: null,
    connector_id: connectorId,
    scope,
    base_state_id: baseStateId,
    external_ref: proposal.external_ref ?? null,
  });
}

/**
 * Attach proposal create.
 *
 * @param {object} input
 */
export async function handleMediaAttachProposeRequest(input) {
  if (!getMediaAttachEnabled(input.dataDir)) {
    return refuse(403, 'MEDIA_ATTACH_DISABLED', 'Media attach is disabled');
  }
  if (typeof input.createProposal !== 'function') {
    return refuse(500, 'RUNTIME_ERROR', 'createProposal is required');
  }

  const intentRaw = typeof input.intent === 'string' ? input.intent.trim() : '';
  if (!intentRaw) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'intent is required');
  }
  if (intentRaw.length > MAX_MEDIA_INTENT_CHARS) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'intent too long');
  }

  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'ATTACHMENT_SCOPE_AMBIGUOUS', 'Ambiguous attachment scope');
  }

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
  const attachmentId = typeof body.attachment_id === 'string' ? body.attachment_id.trim() : '';
  const noteRef = typeof body.note_ref === 'string' ? body.note_ref.trim() : '';
  const baseStateId = typeof body.base_state_id === 'string' ? body.base_state_id.trim() : '';

  if (!scope || !['personal', 'project', 'org'].includes(scope)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'scope is required');
  }
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid attachment_id');
  }
  if (!NOTE_REF_RE.test(noteRef)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid note_ref');
  }
  if (!baseStateId.startsWith('kn1_')) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'base_state_id is required');
  }

  const payloadScopeAuthority = resolveAttachmentWriteAuthority(
    resolved.visibleScopes,
    /** @type {MediaScope} */ (scope),
  );
  if (!payloadScopeAuthority.ok) return payloadScopeAuthority;

  const vaultPath = resolveAttachmentVaultPath(input.dataDir, input.vaultPath);
  const vaultConfig = input.vaultConfig ?? {};

  const media = getAttachment(input.dataDir, vaultPath, input.vaultId, attachmentId, {
    visibleScopes: resolved.visibleScopes,
    mediaSubdir: input.mediaSubdir,
    hubScope: input.hubScope ?? null,
    vaultConfig,
  });
  if (!media) {
    return refuse(404, 'unknown_attachment', 'unknown_attachment');
  }

  const notePath = notePathFromRef(noteRef);
  if (!noteFileExistsInVault(vaultPath, notePath)) {
    return refuse(404, 'unknown_note', 'unknown_note');
  }

  let note;
  try {
    note = readNote(vaultPath, notePath);
  } catch {
    return refuse(404, 'unknown_note', 'unknown_note');
  }

  const noteScope = inferNoteScope(note);
  const authority = resolveAttachmentWriteAuthority(resolved.visibleScopes, noteScope);
  if (!authority.ok) {
    if (authority.code === 'ATTACHMENT_SCOPE_DENIED') {
      return refuse(404, 'unknown_note', 'unknown_note');
    }
    return authority;
  }

  // Hosted bridge may pass liveStateIdOverride from the canister GET fingerprint so
  // yaml-stage → readNote trimEnd cannot false-conflict with the client's base_state_id.
  const liveStateId =
    typeof input.liveStateIdOverride === 'string' && input.liveStateIdOverride.startsWith('kn1_')
      ? input.liveStateIdOverride
      : noteStateIdFromParts(note.frontmatter ?? {}, note.body ?? '');
  if (liveStateId !== baseStateId) {
    return refuse(409, 'MEDIA_LINEAGE_CONFLICT', 'Note changed since base_state_id was captured');
  }

  const proposalBody = JSON.stringify(
    {
      proposal_kind: 'media_attach',
      attachment_id: attachmentId,
      note_ref: noteRef,
      scope,
      base_state_id: baseStateId,
    },
    null,
    2,
  );

  const ext = resolveMediaProposeExternalRef(input);
  if (!ext.ok) return ext;

  const proposal = await createProposalRecord(input, {
    path: mediaProposalMirrorPath('pending'),
    body: proposalBody,
    frontmatter: {
      type: 'media_proposal',
      proposal_kind: 'media_attach',
      attachment_id: attachmentId,
      note_ref: noteRef,
    },
    intent: intentRaw,
    base_state_id: baseStateId,
    source: MEDIA_PROPOSAL_SOURCE,
    vault_id: input.vaultId,
    proposed_by:
      typeof input.userId === 'string' && input.userId.trim() ? input.userId.trim() : undefined,
    review_queue: MEDIA_REVIEW_QUEUE,
    ...(ext.externalRef ? { external_ref: ext.externalRef } : {}),
    media_meta: {
      record_kind: 'media_attach',
      proposal_kind: 'media_attach',
      attachment_id: attachmentId,
      connector_id: null,
      consent_id: null,
      note_ref: noteRef,
    },
  });

  updateProposalPath(input.dataDir, proposal.proposal_id);

  return buildMediaProposalEnvelope({
    proposal_id: proposal.proposal_id,
    proposal_kind: 'media_attach',
    attachment_id: attachmentId,
    note_ref: noteRef,
    connector_id: null,
    scope,
    base_state_id: baseStateId,
    external_ref: proposal.external_ref ?? null,
  });
}

/**
 * Grant import consent (human writer only — not MCP write).
 *
 * @param {object} input
 */
export function handleMediaImportConsentGrantRequest(input) {
  if (!getMediaExternalLinkEnabled(input.dataDir)) {
    return refuse(403, 'MEDIA_EXTERNAL_LINK_DISABLED', 'Media external link is disabled');
  }

  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const connectorId = typeof body.connector_id === 'string' ? body.connector_id.trim() : '';
  const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
  const expiresAt =
    body.expires_at === null || body.expires_at === undefined
      ? null
      : typeof body.expires_at === 'string'
        ? body.expires_at.trim()
        : null;

  if (!CONNECTOR_ID_RE.test(connectorId)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid connector_id');
  }
  if (!scope || !['personal', 'project', 'org'].includes(scope)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'scope is required');
  }
  if (expiresAt != null && Number.isNaN(new Date(expiresAt).getTime())) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid expires_at');
  }

  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'ATTACHMENT_SCOPE_AMBIGUOUS', 'Ambiguous attachment scope');
  }

  const authority = resolveAttachmentWriteAuthority(resolved.visibleScopes, /** @type {MediaScope} */ (scope));
  if (!authority.ok) return authority;

  if (!getEnabledConnector(input.dataDir, input.vaultId, connectorId)) {
    return refuse(403, 'MEDIA_CONNECTOR_DENIED', 'Connector not allowlisted');
  }

  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  const grantedBy = userId ? hashPrincipalRef(userId) : 'uid_hash:' + '0'.repeat(64);

  const consentId = mintConsentId();
  const now = new Date().toISOString();
  const store = loadMediaImportConsentStore(input.dataDir);
  if (!store.vaults[input.vaultId]) {
    store.vaults[input.vaultId] = { consents: {} };
  }
  if (!store.vaults[input.vaultId].consents) {
    store.vaults[input.vaultId].consents = {};
  }
  store.vaults[input.vaultId].consents[consentId] = {
    connector_id: connectorId,
    scope: /** @type {MediaScope} */ (scope),
    granted_by: grantedBy,
    granted_at: now,
    expires_at: expiresAt,
    status: 'active',
  };
  saveMediaImportConsentStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: 'knowtation.media_import_consent/v0',
      consent_id: consentId,
      connector_id: connectorId,
      scope,
      granted_by: grantedBy,
      granted_at: now,
      expires_at: expiresAt,
      status: 'active',
    },
  };
}

/**
 * List import consents (read-only surface).
 *
 * @param {object} input
 */
export function handleMediaImportConsentListRequest(input) {
  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'ATTACHMENT_SCOPE_AMBIGUOUS', 'Ambiguous attachment scope');
  }

  const scopeFilter =
    typeof input.scope === 'string' && input.scope.trim() ? input.scope.trim() : undefined;
  if (scopeFilter && !['personal', 'project', 'org'].includes(scopeFilter)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid scope filter');
  }
  if (scopeFilter) {
    const authority = resolveAttachmentWriteAuthority(
      resolved.visibleScopes,
      /** @type {MediaScope} */ (scopeFilter),
    );
    if (!authority.ok) return authority;
  }

  const rows = listVaultConsents(input.dataDir, input.vaultId, scopeFilter);
  const visible = rows.filter((row) => resolved.visibleScopes.has(row.record.scope));

  return {
    ok: true,
    payload: {
      schema: 'knowtation.media_import_consent_list/v0',
      vault_id: input.vaultId,
      consents: visible.map(({ consent_id, record }) => ({
        consent_id,
        connector_id: record.connector_id,
        scope: record.scope,
        granted_by: record.granted_by,
        granted_at: record.granted_at,
        expires_at: record.expires_at,
        status: record.status,
      })),
    },
  };
}

/**
 * Revoke import consent.
 *
 * @param {object} input
 */
export function handleMediaImportConsentRevokeRequest(input) {
  const consentId =
    typeof input.consentId === 'string'
      ? input.consentId.trim()
      : typeof input.body?.consent_id === 'string'
        ? input.body.consent_id.trim()
        : '';
  if (!CONSENT_ID_RE.test(consentId)) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'invalid consent_id');
  }

  const store = loadMediaImportConsentStore(input.dataDir);
  const record = store.vaults?.[input.vaultId]?.consents?.[consentId];
  if (!record) {
    return refuse(404, 'NOT_FOUND', 'Consent not found');
  }

  const resolved = resolveWriteScopes(input);
  if (resolved.ambiguous) {
    return refuse(400, 'ATTACHMENT_SCOPE_AMBIGUOUS', 'Ambiguous attachment scope');
  }

  const authority = resolveAttachmentWriteAuthority(resolved.visibleScopes, record.scope);
  if (!authority.ok) return authority;

  record.status = 'revoked';
  saveMediaImportConsentStore(input.dataDir, store);

  return {
    ok: true,
    payload: {
      schema: 'knowtation.media_import_consent/v0',
      consent_id: consentId,
      status: 'revoked',
    },
  };
}

/**
 * @param {object} proposal
 * @returns {object|null}
 */
function parseMediaProposalBody(proposal) {
  try {
    const parsed = JSON.parse(proposal.body || '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Approve-time authoritative re-check for media proposals.
 *
 * @param {string} dataDir
 * @param {object} proposal
 * @param {{ vaultPath: string, vaultConfig?: object, mediaSubdir?: string, liveStateIdOverride?: string }} ctx
 */
export function precheckApprovedMediaProposal(dataDir, proposal, ctx) {
  const vaultId = proposal.vault_id ?? 'default';
  const meta = proposal.media_meta;
  const parsed = parseMediaProposalBody(proposal);
  const proposalKind =
    meta?.proposal_kind || parsed?.proposal_kind || meta?.record_kind || parsed?.proposal_kind;

  if (!proposalKind) {
    return refuse(400, 'MEDIA_DRAFT_INVALID', 'missing media proposal_kind');
  }

  if (proposalKind === 'media_external_link') {
    const connectorId = meta?.connector_id || parsed?.connector_id;
    const opaqueRef = parsed?.opaque_ref;
    const consentId = meta?.consent_id || parsed?.consent_id;
    const scope = parsed?.scope || meta?.scope;
    const attachmentId = meta?.attachment_id || parsed?.attachment_id;

    if (!getEnabledConnector(dataDir, vaultId, connectorId)) {
      return refuse(403, 'MEDIA_CONNECTOR_DENIED', 'Connector not allowlisted');
    }

    const consentStore = loadMediaImportConsentStore(dataDir);
    const consentRecord = consentStore.vaults?.[vaultId]?.consents?.[consentId];
    if (
      !consentRecord ||
      consentRecord.status !== 'active' ||
      consentRecord.connector_id !== connectorId
    ) {
      return refuse(403, 'MEDIA_IMPORT_CONSENT_REQUIRED', 'Active import consent required');
    }
    if (consentRecord.expires_at != null) {
      const exp = new Date(consentRecord.expires_at).getTime();
      if (!Number.isNaN(exp) && exp <= Date.now()) {
        return refuse(403, 'MEDIA_IMPORT_CONSENT_REQUIRED', 'Import consent expired');
      }
    }

    if (getExternalRef(dataDir, vaultId, attachmentId)) {
      return refuse(409, 'MEDIA_LINEAGE_CONFLICT', 'External reference already exists');
    }

    return {
      ok: true,
      vaultId,
      proposalKind,
      attachmentId,
      connectorId,
      opaqueRef,
      consentId,
      scope,
      displayLabel: parsed?.display_label || connectorId,
    };
  }

  if (proposalKind === 'media_attach') {
    const noteRef = meta?.note_ref || parsed?.note_ref;
    const attachmentId = meta?.attachment_id || parsed?.attachment_id;
    const baseStateId = proposal.base_state_id || parsed?.base_state_id;
    // SEC-SEAM-MEDIA SM-C5: propose-time media_pointer stamp (media_meta / body JSON).
    // Hosted apply prefers this over the vault-wide mist walk (G22).
    const mediaPointerRaw = meta?.media_pointer ?? parsed?.media_pointer;
    const mediaPointer =
      typeof mediaPointerRaw === 'string' && mediaPointerRaw.trim() ? mediaPointerRaw.trim() : null;
    const vaultPath = ctx.vaultPath;
    const notePath = notePathFromRef(noteRef);

    if (!noteFileExistsInVault(vaultPath, notePath)) {
      return refuse(409, 'MEDIA_LINEAGE_CONFLICT', 'Target note missing at approve');
    }

    let note;
    try {
      note = readNote(vaultPath, notePath);
    } catch {
      return refuse(409, 'MEDIA_LINEAGE_CONFLICT', 'Target note unreadable at approve');
    }

    const liveStateId =
      typeof ctx.liveStateIdOverride === 'string' && ctx.liveStateIdOverride.startsWith('kn1_')
        ? ctx.liveStateIdOverride
        : noteStateIdFromParts(note.frontmatter ?? {}, note.body ?? '');
    if (liveStateId !== baseStateId) {
      return refuse(409, 'MEDIA_LINEAGE_CONFLICT', 'Note changed since proposal was created');
    }

    return {
      ok: true,
      vaultId,
      proposalKind,
      attachmentId,
      noteRef,
      notePath,
      baseStateId,
      mediaPointer,
      vaultPath,
      vaultConfig: ctx.vaultConfig ?? {},
    };
  }

  return refuse(400, 'MEDIA_DRAFT_INVALID', 'unknown media proposal_kind');
}

/**
 * Apply a pre-checked media proposal — external ref store or note frontmatter only.
 *
 * @param {string} dataDir
 * @param {object} applyCtx
 */
export function reconcileApprovedMediaProposal(dataDir, applyCtx) {
  const kind = applyCtx.proposalKind;

  if (kind === 'media_external_link') {
    upsertExternalRef(dataDir, applyCtx.vaultId, applyCtx.attachmentId, {
      connector_id: applyCtx.connectorId,
      opaque_ref: applyCtx.opaqueRef,
      scope: applyCtx.scope,
      display_label: applyCtx.displayLabel,
      consent_id: applyCtx.consentId,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    return { applied: true, attachment_id: applyCtx.attachmentId };
  }

  if (kind === 'media_attach') {
    const note = readNote(applyCtx.vaultPath, applyCtx.notePath);
    const fm = { ...(note.frontmatter ?? {}) };
    const attachments = Array.isArray(fm.attachments) ? [...fm.attachments] : [];
    // SEC-SEAM-MEDIA SM-C5: prefer the propose-time media_pointer stamp; the vault
    // walk stays the self-hosted fallback for pre-stamp proposals only (G22).
    const pointer =
      typeof applyCtx.mediaPointer === 'string' && applyCtx.mediaPointer.trim()
        ? applyCtx.mediaPointer.trim()
        : resolveMediaPointerForAttach(
            applyCtx.vaultPath,
            applyCtx.vaultConfig,
            applyCtx.attachmentId,
          );
    if (!pointer) {
      throw new Error('media pointer could not be resolved at apply');
    }
    if (!attachments.includes(pointer)) {
      attachments.push(pointer);
    }
    fm.attachments = attachments;
    fm.updated = new Date().toISOString();
    writeNote(applyCtx.vaultPath, applyCtx.notePath, {
      body: note.body ?? '',
      frontmatter: fm,
    });
    return { applied: true, attachment_id: applyCtx.attachmentId, note_ref: applyCtx.noteRef };
  }

  throw new Error(`unsupported media proposal_kind at apply: ${kind}`);
}

export { CONNECTOR_ID_RE, getVaultConnectors, loadMediaConnectorPolicy, saveMediaConnectorPolicy } from './media-connector-policy.mjs';
export { CONSENT_ID_RE } from './media-import-consent.mjs';
