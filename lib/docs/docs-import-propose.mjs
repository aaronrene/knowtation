/**
 * Review-before-write proposal builder for live document connectors.
 *
 * This module never writes notes. It creates proposal records after enforcing
 * frozen file-count and byte caps and deduplicating canonical and pending work.
 */

import fs from 'fs';
import path from 'path';
import { createProposal as createStoredProposal } from '../../hub/proposals-store.mjs';
import { noteStateIdFromParts } from '../note-state-id.mjs';
import { listMarkdownFiles, readNote } from '../vault.mjs';
import { safeId } from './google-drive-normalizer.mjs';

export const MAX_DOCS_IMPORT_FILES = 20;
export const MAX_DOCS_IMPORT_FILE_BYTES = 25_000_000;
export const MAX_DOCS_IMPORT_BATCH_BYTES = 80_000_000;
export const DOCS_SYNC_REVIEW_QUEUE = 'docs-sync';

function badRequest(message) {
  const error = new TypeError(message);
  error.code = 'BAD_REQUEST';
  return error;
}

function defaultLoadProposals(dataDir) {
  const filePath = path.join(dataDir, 'hub_proposals.json');
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isPendingProposal(proposal, vaultId, source, sourceId) {
  if (!proposal || !['proposed', 'approved'].includes(proposal.status)) return false;
  if ((proposal.vault_id ?? 'default') !== vaultId) return false;
  return proposal.frontmatter?.source === source
    && proposal.frontmatter?.source_id === sourceId;
}

function findExistingNote(vaultPath, source, sourceId, listFilesFn, readNoteFn) {
  for (const relativePath of listFilesFn(vaultPath)) {
    let note;
    try {
      note = readNoteFn(vaultPath, relativePath);
    } catch {
      continue;
    }
    if (note.frontmatter?.source === source && note.frontmatter?.source_id === sourceId) {
      return note;
    }
  }
  return null;
}

/**
 * Create review proposals for already-fetched provider documents.
 *
 * @param {{
 *   dataDir: string,
 *   vaultPath: string,
 *   vaultId: string,
 *   connectorId: string,
 *   provider: 'google-drive'|'notion',
 *   items: Array<{ source_id?: string, file_id?: string, page_id?: string, name?: string, markdown: string, size?: number }>,
 *   now?: number|string|Date,
 *   createProposalFn?: typeof createStoredProposal,
 *   loadProposalsFn?: (dataDir: string) => object[],
 *   listMarkdownFilesFn?: typeof listMarkdownFiles,
 *   readNoteFn?: typeof readNote,
 * }} input
 * @returns {{ proposed: number, skipped: number, proposal_ids: string[], skip_details: Array<{ source_id: string, reason: string }> }}
 */
export function proposeDocsImports(input) {
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items || items.length < 1 || items.length > MAX_DOCS_IMPORT_FILES) {
    throw badRequest('file_ids must contain between 1 and 20 items');
  }
  if (!['google-drive', 'notion'].includes(input.provider)) throw badRequest('provider denied');

  let batchBytes = 0;
  for (const item of items) {
    const size = Number.isFinite(item.size)
      ? Number(item.size)
      : Buffer.byteLength(typeof item.markdown === 'string' ? item.markdown : '', 'utf8');
    if (size < 0) throw badRequest('invalid file size');
    batchBytes += size;
  }
  if (batchBytes > MAX_DOCS_IMPORT_BATCH_BYTES) throw badRequest('import batch exceeds byte cap');

  const source = input.provider;
  const vaultId = typeof input.vaultId === 'string' && input.vaultId ? input.vaultId : 'default';
  const createFn = input.createProposalFn ?? createStoredProposal;
  const loadFn = input.loadProposalsFn ?? defaultLoadProposals;
  const listFilesFn = input.listMarkdownFilesFn ?? listMarkdownFiles;
  const readNoteFn = input.readNoteFn ?? readNote;
  const pending = loadFn(input.dataDir);
  const importedAt = new Date(input.now ?? Date.now()).toISOString();
  const proposalIds = [];
  const skipDetails = [];

  for (const item of items) {
    const sourceId = item.source_id ?? item.file_id ?? item.page_id;
    if (typeof sourceId !== 'string' || !sourceId) throw badRequest('invalid source id');
    const itemSize = Number.isFinite(item.size)
      ? Number(item.size)
      : Buffer.byteLength(typeof item.markdown === 'string' ? item.markdown : '', 'utf8');
    if (itemSize > MAX_DOCS_IMPORT_FILE_BYTES) {
      skipDetails.push({ source_id: sourceId, reason: 'too_large' });
      continue;
    }
    if (typeof item.markdown !== 'string' || !item.markdown.trim()) {
      skipDetails.push({ source_id: sourceId, reason: 'empty_extract' });
      continue;
    }
    if (pending.some((proposal) => isPendingProposal(proposal, vaultId, source, sourceId))) {
      skipDetails.push({ source_id: sourceId, reason: 'already_pending' });
      continue;
    }
    const pathId = safeId(sourceId);
    if (!pathId) throw badRequest('invalid source id');
    const existing = findExistingNote(input.vaultPath, source, sourceId, listFilesFn, readNoteFn);
    const proposalPath = existing?.path ?? `imports/${source}/${pathId}.md`;
    const displayName = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : sourceId;
    const prefix = 'docs-sync import: ';
    const intent = prefix + displayName.slice(0, 128 - prefix.length);
    const frontmatter = {
      source,
      source_id: sourceId,
      connector_id: input.connectorId,
      imported_at: importedAt,
    };
    const proposal = createFn(input.dataDir, {
      path: proposalPath,
      body: item.markdown,
      frontmatter,
      intent,
      vault_id: vaultId,
      source: 'import',
      review_queue: DOCS_SYNC_REVIEW_QUEUE,
      ...(existing
        ? { base_state_id: noteStateIdFromParts(existing.frontmatter ?? {}, existing.body ?? '') }
        : {}),
    });
    if (!proposal || typeof proposal.proposal_id !== 'string') {
      throw new Error('Proposal store did not return a proposal id');
    }
    proposalIds.push(proposal.proposal_id);
    pending.push(proposal);
  }

  return {
    proposed: proposalIds.length,
    skipped: skipDetails.length,
    proposal_ids: proposalIds,
    skip_details: skipDetails,
  };
}

export const createDocsImportProposals = proposeDocsImports;
