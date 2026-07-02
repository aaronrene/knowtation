/**
 * Shared Attachment list/get handlers — CLI = MCP = Hub REST parity (Phase 2F-b-b).
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §4
 */

import {
  listAttachments,
  getAttachment,
  attachmentForClient,
  attachmentGetEffectiveScope,
  ATTACHMENT_ID_RE,
  NOTE_REF_RE,
  MAX_ATTACHMENT_SUMMARIES,
  ATTACHMENT_SOURCES,
  MIME_CLASSES,
  STORAGE_KINDS,
} from './attachment-store.mjs';
import { resolveFlowScopeQuery } from '../flow/flow-scope.mjs';
import { resolveHandlerVisibleScopes } from '../flow/flow-handlers.mjs';
import { loadConfig } from '../config.mjs';

/**
 * Resolve vault path for attachment derivation from data_dir config.
 *
 * @param {string} dataDir
 * @param {string} [vaultPathOverride]
 * @returns {string}
 */
export function resolveAttachmentVaultPath(dataDir, vaultPathOverride) {
  if (typeof vaultPathOverride === 'string' && vaultPathOverride.trim()) {
    return vaultPathOverride.trim();
  }
  try {
    const config = loadConfig();
    if (config.vault_path) return config.vault_path;
  } catch {
    /* fall through */
  }
  return dataDir;
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultPath?: string,
 *   vaultId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: import('../flow/flow-scope.mjs').FlowScope[],
 *   visibleScopes?: Set<import('../flow/flow-scope.mjs').FlowScope>,
 *   ambiguous?: boolean,
 *   scope?: string,
 *   note_ref?: string,
 *   noteRef?: string,
 *   source?: string,
 *   mime_class?: string,
 *   mimeClass?: string,
 *   storage_kind?: string,
 *   storageKind?: string,
 *   agent_visible?: boolean|string,
 *   agentVisible?: boolean,
 *   agentContext?: boolean,
 *   limit?: number,
 *   mediaSubdir?: string,
 *   hubScope?: { projects?: string[], folders?: string[] }|null,
 *   vaultConfig?: object,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleAttachmentListRequest(input) {
  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous attachment scope',
      code: 'ATTACHMENT_SCOPE_AMBIGUOUS',
    };
  }

  const scopeQuery = resolveFlowScopeQuery(resolved.visibleScopes, input.scope);
  if (!scopeQuery.ok) {
    const code =
      scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'ATTACHMENT_SCOPE_DENIED' : scopeQuery.code;
    const error =
      scopeQuery.code === 'FLOW_SCOPE_DENIED' ? 'Attachment scope not authorized' : scopeQuery.error;
    return { ok: false, status: scopeQuery.status, error, code };
  }

  const noteRefRaw =
    (typeof input.noteRef === 'string' ? input.noteRef : input.note_ref)?.trim() ?? '';
  if (noteRefRaw && !NOTE_REF_RE.test(noteRefRaw)) {
    return { ok: false, status: 400, error: 'Invalid note_ref', code: 'BAD_REQUEST' };
  }

  const source = typeof input.source === 'string' ? input.source.trim() : '';
  if (source && !ATTACHMENT_SOURCES.includes(/** @type {typeof ATTACHMENT_SOURCES[number]} */ (source))) {
    return { ok: false, status: 400, error: 'Invalid source', code: 'BAD_REQUEST' };
  }

  const mimeClass =
    (typeof input.mimeClass === 'string' ? input.mimeClass : input.mime_class)?.trim() ?? '';
  if (mimeClass && !MIME_CLASSES.includes(/** @type {typeof MIME_CLASSES[number]} */ (mimeClass))) {
    return { ok: false, status: 400, error: 'Invalid mime_class', code: 'BAD_REQUEST' };
  }

  const storageKind =
    (typeof input.storageKind === 'string' ? input.storageKind : input.storage_kind)?.trim() ?? '';
  if (
    storageKind &&
    !STORAGE_KINDS.includes(/** @type {typeof STORAGE_KINDS[number]} */ (storageKind))
  ) {
    return { ok: false, status: 400, error: 'Invalid storage_kind', code: 'BAD_REQUEST' };
  }

  let limit = input.limit;
  if (limit !== undefined && limit !== null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ATTACHMENT_SUMMARIES) {
      return {
        ok: false,
        status: 400,
        error: `limit must be an integer between 1 and ${MAX_ATTACHMENT_SUMMARIES}`,
        code: 'BAD_REQUEST',
      };
    }
  }

  const agentVisibleOnly =
    input.agentVisible === true ||
    input.agent_visible === true ||
    input.agent_visible === 'true';

  const vaultPath = resolveAttachmentVaultPath(input.dataDir, input.vaultPath);

  const payload = listAttachments(input.dataDir, vaultPath, input.vaultId, {
    visibleScopes: resolved.visibleScopes,
    filterScopes: scopeQuery.filterScopes,
    effectiveScope: scopeQuery.effectiveScope,
    noteRef: noteRefRaw || undefined,
    source: source || undefined,
    mimeClass: mimeClass || undefined,
    storageKind: storageKind || undefined,
    agentVisibleOnly,
    agentContext: input.agentContext === true,
    limit,
    mediaSubdir: input.mediaSubdir,
    hubScope: input.hubScope ?? null,
    vaultConfig: input.vaultConfig,
  });

  return { ok: true, payload };
}

/**
 * @param {{
 *   dataDir: string,
 *   vaultPath?: string,
 *   vaultId: string,
 *   attachmentId: string,
 *   userId?: string,
 *   role?: string,
 *   cliScopes?: import('../flow/flow-scope.mjs').FlowScope[],
 *   visibleScopes?: Set<import('../flow/flow-scope.mjs').FlowScope>,
 *   ambiguous?: boolean,
 *   mediaSubdir?: string,
 *   hubScope?: object|null,
 *   vaultConfig?: object,
 *   agentContext?: boolean,
 * }} input
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, error: string, code: string }}
 */
export function handleAttachmentGetRequest(input) {
  const attachmentId =
    typeof input.attachmentId === 'string' ? input.attachmentId.trim() : '';
  if (!attachmentId || !ATTACHMENT_ID_RE.test(attachmentId)) {
    return { ok: false, status: 400, error: 'Invalid attachment id', code: 'BAD_REQUEST' };
  }

  const resolved = resolveHandlerVisibleScopes(input);
  if (resolved.ambiguous) {
    return {
      ok: false,
      status: 400,
      error: 'Ambiguous attachment scope',
      code: 'ATTACHMENT_SCOPE_AMBIGUOUS',
    };
  }

  const vaultPath = resolveAttachmentVaultPath(input.dataDir, input.vaultPath);

  const stored = getAttachment(input.dataDir, vaultPath, input.vaultId, attachmentId, {
    visibleScopes: resolved.visibleScopes,
    mediaSubdir: input.mediaSubdir,
    hubScope: input.hubScope ?? null,
    vaultConfig: input.vaultConfig,
    agentContext: input.agentContext === true,
  });

  if (!stored) {
    return {
      ok: false,
      status: 404,
      error: 'unknown_attachment',
      code: 'unknown_attachment',
    };
  }

  return {
    ok: true,
    payload: {
      schema: 'knowtation.attachment_get/v0',
      vault_id: input.vaultId,
      effective_scope: attachmentGetEffectiveScope(resolved.visibleScopes),
      attachment: attachmentForClient(stored),
    },
  };
}

/**
 * @param {object} payload
 * @returns {string}
 */
export function serializeAttachmentPayload(payload) {
  return JSON.stringify(payload);
}
