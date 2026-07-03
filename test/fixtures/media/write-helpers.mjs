/**
 * Shared helpers for media-write seven-tier tests.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  precheckApprovedMediaProposal,
  reconcileApprovedMediaProposal,
  deriveLinkAttachmentId,
} from '../../../lib/attachments/attachment-write.mjs';
import {
  saveMediaConnectorPolicy,
  loadMediaConnectorPolicy,
} from '../../../lib/attachments/media-connector-policy.mjs';
import {
  handleMediaImportConsentGrantRequest,
} from '../../../lib/attachments/attachment-write.mjs';
import { getProposal, updateProposalStatus } from '../../../hub/proposals-store.mjs';
import { noteStateIdFromParts } from '../../../lib/note-state-id.mjs';
import { readNote } from '../../../lib/vault.mjs';
import { buildAttachmentFixtureVault } from '../attachment-fixture.mjs';

export const visibleAll = new Set(['personal', 'project', 'org']);

/**
 * @param {string} tmpRoot
 * @returns {ReturnType<typeof buildAttachmentFixtureVault> & { targetNoteRef: string, targetNotePath: string, targetBaseStateId: string }}
 */
export function buildMediaWriteFixture(tmpRoot) {
  const fx = buildAttachmentFixtureVault(tmpRoot);
  const targetNotePath = 'target-lesson.md';
  fs.writeFileSync(
    path.join(fx.vaultPath, targetNotePath),
    `---
title: Target Lesson
---
# Lesson body
`,
  );
  const note = readNote(fx.vaultPath, targetNotePath);
  const targetNoteRef = 'note:target-lesson.md';
  const targetBaseStateId = noteStateIdFromParts(note.frontmatter ?? {}, note.body ?? '');

  seedConnectorAllowlist(fx.dataDir, fx.vaultId, { gdrive: true });
  return { ...fx, targetNoteRef, targetNotePath, targetBaseStateId };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {Record<string, boolean>} connectors
 */
export function seedConnectorAllowlist(dataDir, vaultId, connectors) {
  const store = loadMediaConnectorPolicy(dataDir);
  if (!store.vaults[vaultId]) store.vaults[vaultId] = { connectors: {} };
  const now = new Date().toISOString();
  for (const [id, enabled] of Object.entries(connectors)) {
    store.vaults[vaultId].connectors[id] = {
      enabled: enabled === true,
      display_name: id,
      updated: now,
    };
  }
  saveMediaConnectorPolicy(dataDir, store);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @param {string} scope
 */
export function grantActiveConsent(dataDir, vaultId, connectorId, scope = 'personal') {
  const result = handleMediaImportConsentGrantRequest({
    dataDir,
    vaultId,
    userId: 'test-user',
    cliScopes: ['personal', 'project', 'org'],
    body: { connector_id: connectorId, scope, expires_at: null },
  });
  if (!result.ok) throw new Error(result.error);
  return result.payload.consent_id;
}

/**
 * @param {string} dataDir
 * @param {string} proposalId
 * @param {string} vaultPath
 * @param {object} [vaultConfig]
 */
export function approveMediaProposal(dataDir, proposalId, vaultPath, vaultConfig = {}) {
  const proposal = getProposal(dataDir, proposalId);
  const pre = precheckApprovedMediaProposal(dataDir, proposal, { vaultPath, vaultConfig });
  if (!pre.ok) return pre;
  reconcileApprovedMediaProposal(dataDir, pre);
  updateProposalStatus(dataDir, proposalId, 'approved');
  return { ok: true, pre };
}

/**
 * @param {object} [overrides]
 */
export function sampleLinkProposeBody(overrides = {}) {
  const connectorId = 'gdrive';
  const opaqueRef = overrides.opaque_ref ?? '1AbCd_efGhIjkLmnOpQrStU';
  return {
    scope: 'personal',
    connector_id: connectorId,
    opaque_ref: opaqueRef,
    consent_id: overrides.consent_id ?? 'mic_0123456789abcdef',
    display_label: 'Design board',
    attachment_id: deriveLinkAttachmentId(connectorId, opaqueRef),
    ...overrides,
  };
}

/**
 * @param {object} fx
 * @param {object} [overrides]
 */
export function sampleAttachProposeBody(fx, overrides = {}) {
  return {
    scope: 'personal',
    attachment_id: fx.fileId,
    note_ref: fx.targetNoteRef,
    base_state_id: fx.targetBaseStateId,
    ...overrides,
  };
}
