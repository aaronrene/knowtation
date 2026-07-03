/**
 * Derived attachment read store (Phase 2F-b-b).
 *
 * Read-time index over vault media files, Mist frontmatter blobs, and embedded URLs.
 * Scope is inherited from owning notes; policy overlay supplies agent_visible consent.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { extractImageUrls, extractVideoUrls } from '../media-url-extract.mjs';
import { getNotesWithMeta } from '../list-notes.mjs';
import { applyScopeFilterToNotes } from '../../hub/lib/scope-filter.mjs';
import { SCOPE_RANK, highestFlowScope } from '../flow/flow-scope.mjs';
import { getVaultAttachmentPolicies } from './attachment-store-file.mjs';
import { getVaultExternalRefs } from './attachment-external-ref-store.mjs';
import { walkAllMediaFiles, mimeFromExtension } from './derive.mjs';

export const MAX_ATTACHMENT_SUMMARIES = 500;
export const MAX_LINKED_NOTES = 64;

export const ATTACHMENT_ID_RE = /^att_(file|mist|url|link)_[a-f0-9]{32}$/;
export const NOTE_REF_RE = /^note:[A-Za-z0-9._:\/-]{1,256}$/;
export const MIST_ID_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$/;

/** Scooling consumer charset/length cap for linked_note_refs on the wire. */
export const SCOOLING_NOTE_REF_RE = /^note:[A-Za-z0-9._:-]{1,128}$/;

export const ATTACHMENT_SOURCES = /** @type {const} */ ([
  'vault_file',
  'mist_blob',
  'embedded_url',
  'connector_ref',
]);
export const STORAGE_KINDS = /** @type {const} */ (['vault_blob', 'external_link']);
export const MIME_CLASSES = /** @type {const} */ (['image', 'video', 'audio', 'document', 'unknown']);

/** @typedef {'personal'|'project'|'org'} AttachmentScope */
/** @typedef {typeof ATTACHMENT_SOURCES[number]} AttachmentSource */
/** @typedef {typeof MIME_CLASSES[number]} MimeClass */

/**
 * @typedef {Object} StoredAttachment
 * @property {'knowtation.attachment/v0'} schema
 * @property {string} attachment_id
 * @property {AttachmentSource} source
 * @property {'vault_blob'|'external_link'} storage_kind
 * @property {MimeClass} mime_class
 * @property {string|null} mime_type
 * @property {AttachmentScope} scope
 * @property {string} display_label
 * @property {number|null} byte_size
 * @property {string[]} linked_note_refs
 * @property {boolean} agent_visible
 * @property {string} created
 * @property {string} updated
 * @property {boolean} truncated
 */

/**
 * @param {string} input
 * @returns {string}
 */
function sha256Token(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 32);
}

/**
 * @param {'file'|'mist'|'url'|'link'} sourceTag
 * @param {string} canonical
 * @returns {string}
 */
export function deriveAttachmentId(sourceTag, canonical) {
  return `att_${sourceTag}_${sha256Token(canonical)}`;
}

/**
 * @param {string} notePath
 * @returns {string}
 */
export function noteRefFromPath(notePath) {
  const normalized = notePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    return '';
  }
  return `note:${normalized}`;
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
export function isScoolingSafeNoteRef(ref) {
  return SCOOLING_NOTE_REF_RE.test(ref);
}

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrlForId(url) {
  try {
    const u = new URL(url.trim());
    u.username = '';
    u.password = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url.trim().split('#')[0].split('?')[0];
  }
}

/**
 * @param {string} url
 * @returns {string}
 */
export function urlHostOnly(url) {
  try {
    return new URL(url.trim()).host || 'unknown';
  } catch {
    const cleaned = url.trim().replace(/^https?:\/\//i, '');
    const slash = cleaned.indexOf('/');
    const host = slash === -1 ? cleaned : cleaned.slice(0, slash);
    return host.split('@').pop()?.split('?')[0] || 'unknown';
  }
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function filenameStem(relPath) {
  const base = path.basename(relPath.replace(/\\/g, '/'));
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Infer authorization scope tier from a note record.
 *
 * @param {{ path: string, frontmatter?: object }} note
 * @returns {AttachmentScope}
 */
export function inferNoteScope(note) {
  const fm = note.frontmatter ?? {};
  const raw = fm.scope;
  if (raw === 'personal' || raw === 'project' || raw === 'org') {
    return raw;
  }
  const p = note.path.replace(/\\/g, '/');
  if (p.startsWith('org/')) return 'org';
  if (p.startsWith('projects/')) return 'project';
  return 'personal';
}

/**
 * @param {AttachmentScope[]} scopes
 * @returns {AttachmentScope}
 */
export function mostRestrictiveScope(scopes) {
  if (scopes.length === 0) return 'personal';
  let best = scopes[0];
  for (const s of scopes) {
    if (SCOPE_RANK[s] > SCOPE_RANK[best]) best = s;
  }
  return best;
}

/**
 * @param {StoredAttachment} attachment
 * @returns {object}
 */
export function attachmentSummaryForClient(attachment) {
  return {
    schema: 'knowtation.attachment/v0',
    attachment_id: attachment.attachment_id,
    source: attachment.source,
    storage_kind: attachment.storage_kind,
    mime_class: attachment.mime_class,
    scope: attachment.scope,
    display_label: attachment.display_label,
    created: attachment.created,
    truncated: attachment.truncated,
  };
}

/**
 * @param {StoredAttachment} attachment
 * @returns {StoredAttachment}
 */
export function attachmentForClient(attachment) {
  let refs = attachment.linked_note_refs ?? [];
  let truncated = attachment.truncated;
  const safeRefs = refs.filter((r) => isScoolingSafeNoteRef(r));
  if (safeRefs.length < refs.length) {
    truncated = true;
  }
  if (safeRefs.length > MAX_LINKED_NOTES) {
    refs = safeRefs.slice(0, MAX_LINKED_NOTES);
    truncated = true;
  } else {
    refs = safeRefs;
  }
  return {
    schema: attachment.schema,
    attachment_id: attachment.attachment_id,
    source: attachment.source,
    storage_kind: attachment.storage_kind,
    mime_class: attachment.mime_class,
    mime_type: attachment.mime_type,
    scope: attachment.scope,
    display_label: attachment.display_label,
    byte_size: attachment.byte_size,
    linked_note_refs: refs,
    agent_visible: attachment.agent_visible,
    created: attachment.created,
    updated: attachment.updated,
    truncated,
  };
}

/**
 * @param {string} dataDir
 * @param {string} attachmentId
 * @param {Record<string, { agent_visible?: boolean, retention?: string, updated?: string }>} policies
 * @returns {{ agent_visible: boolean, retention: 'vault_lifetime'|'pinned', updated: string }}
 */
function resolvePolicy(dataDir, attachmentId, policies, fallbackUpdated) {
  const row = policies[attachmentId];
  const fallback =
    typeof fallbackUpdated === 'string' && fallbackUpdated.trim() ? fallbackUpdated : null;
  if (!row || typeof row !== 'object') {
    return {
      agent_visible: false,
      retention: 'vault_lifetime',
      updated: fallback ?? fallbackUpdated ?? '1970-01-01T00:00:00.000Z',
    };
  }
  return {
    agent_visible: row.agent_visible === true,
    retention: row.retention === 'pinned' ? 'pinned' : 'vault_lifetime',
    updated:
      typeof row.updated === 'string' && row.updated.trim()
        ? row.updated
        : fallback ?? '1970-01-01T00:00:00.000Z',
  };
}

/**
 * @param {{ path: string, frontmatter?: object, body?: string, project?: string }} note
 * @param {string} vaultPath
 * @param {string} mediaSubdir
 * @param {Map<string, { linked_note_refs: Set<string>, noteScopes: AttachmentScope[], created: string, updated: string, displayBits: object }>} index
 */
function deriveFromNote(note, vaultPath, mediaSubdir, index) {
  const notePath = note.path.replace(/\\/g, '/');
  const noteRef = noteRefFromPath(notePath);
  if (!noteRef || !NOTE_REF_RE.test(noteRef)) return;

  const noteScope = inferNoteScope(note);
  const fm = note.frontmatter ?? {};
  const noteTitle =
    typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : filenameStem(notePath);
  let noteMtime =
    typeof fm.updated === 'string' && fm.updated.trim()
      ? fm.updated
      : typeof note.updated === 'string' && note.updated.trim()
        ? note.updated
        : null;
  if (!noteMtime) {
    try {
      noteMtime = fs.statSync(path.join(vaultPath, notePath)).mtime.toISOString();
    } catch {
      noteMtime = '1970-01-01T00:00:00.000Z';
    }
  }

  const attachmentsRaw = fm.attachments;
  const attachmentList = Array.isArray(attachmentsRaw)
    ? attachmentsRaw
    : typeof attachmentsRaw === 'string' && attachmentsRaw.trim()
      ? [attachmentsRaw.trim()]
      : [];
  if (attachmentList.length > 0) {
    let mistIdx = 0;
    for (const raw of attachmentList) {
      if (typeof raw !== 'string') continue;
      if (MIST_ID_RE.test(raw)) {
        mistIdx += 1;
        const id = deriveAttachmentId('mist', `mist:${raw}`);
        upsertIndex(index, id, {
          source: 'mist_blob',
          storage_kind: 'vault_blob',
          mime_class: 'unknown',
          mime_type: null,
          byte_size: null,
          display_label: noteTitle === filenameStem(notePath) ? `attachment ${mistIdx}` : noteTitle,
          noteRef,
          noteScope,
          created: noteMtime,
          updated: noteMtime,
        });
        continue;
      }
      if (ATTACHMENT_ID_RE.test(raw)) {
        const existing = index.get(raw);
        if (existing) {
          upsertIndex(index, raw, {
            source: existing.source,
            storage_kind: existing.storage_kind,
            mime_class: existing.mime_class,
            mime_type: existing.mime_type,
            byte_size: existing.byte_size,
            display_label: existing.display_label,
            noteRef,
            noteScope,
            created: noteMtime,
            updated: noteMtime,
          });
        }
      }
    }
  }

  const body = typeof note.body === 'string' ? note.body : '';
  const imageUrls = extractImageUrls(body);
  const videoUrls = extractVideoUrls(body);
  const urlEntries = [
    ...imageUrls.map((u) => ({ ...u, kind: 'image' })),
    ...videoUrls.map((u) => ({ ...u, kind: 'video' })),
  ];

  for (const entry of urlEntries) {
    const normalized = normalizeUrlForId(entry.url);
    const id = deriveAttachmentId('url', `url:${notePath}|${normalized}`);
    const ext = entry.mimeType?.split('/')[1] ?? '';
    const { mimeClass, mimeType } = mimeFromExtension(ext.replace('jpeg', 'jpg').replace('quicktime', 'mov'));
    upsertIndex(index, id, {
      source: 'embedded_url',
      storage_kind: 'external_link',
      mime_class: entry.kind === 'video' ? 'video' : mimeClass === 'unknown' ? 'image' : mimeClass,
      mime_type: entry.mimeType ?? mimeType,
      byte_size: null,
      display_label: urlHostOnly(entry.url),
      noteRef,
      noteScope,
      created: noteMtime,
      updated: noteMtime,
    });
  }
}

/**
 * @param {Map<string, object>} index
 * @param {string} id
 * @param {object} row
 */
function upsertIndex(index, id, row) {
  const existing = index.get(id);
  if (!existing) {
    index.set(id, {
      attachment_id: id,
      source: row.source,
      storage_kind: row.storage_kind,
      mime_class: row.mime_class,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      display_label: row.display_label,
      linked_note_refs: new Set([row.noteRef]),
      noteScopes: [row.noteScope],
      created: row.created,
      updated: row.updated,
    });
    return;
  }
  existing.linked_note_refs.add(row.noteRef);
  existing.noteScopes.push(row.noteScope);
  if (row.created < existing.created) existing.created = row.created;
  if (row.updated > existing.updated) existing.updated = row.updated;
}

/**
 * Build the full derived attachment index for a vault.
 *
 * @param {string} vaultPath
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{ mediaSubdir?: string, vaultConfig?: object }} [options]
 * @returns {StoredAttachment[]}
 */
export function deriveAllAttachments(vaultPath, dataDir, vaultId, options = {}) {
  const mediaSubdir = options.mediaSubdir ?? 'media';
  const policies = getVaultAttachmentPolicies(dataDir, vaultId);
  /** @type {Map<string, object>} */
  const index = new Map();

  for (const file of walkAllMediaFiles(vaultPath, mediaSubdir)) {
    const id = deriveAttachmentId('file', `file:${file.relPath}`);
    const { mimeClass, mimeType } = mimeFromExtension(file.ext);
    index.set(id, {
      attachment_id: id,
      source: 'vault_file',
      storage_kind: 'vault_blob',
      mime_class: mimeClass,
      mime_type: mimeType,
      byte_size: file.byteSize,
      display_label: filenameStem(file.relPath),
      linked_note_refs: new Set(),
      noteScopes: [],
      created: file.mtimeIso,
      updated: file.mtimeIso,
      vaultRelPath: file.relPath,
    });
  }

  const externalRefs = getVaultExternalRefs(dataDir, vaultId);
  for (const [attachmentId, ref] of Object.entries(externalRefs)) {
    if (!ref || typeof ref !== 'object') continue;
    if (!ATTACHMENT_ID_RE.test(attachmentId)) continue;
    index.set(attachmentId, {
      attachment_id: attachmentId,
      source: 'connector_ref',
      storage_kind: 'external_link',
      mime_class: 'unknown',
      mime_type: null,
      byte_size: null,
      display_label:
        typeof ref.display_label === 'string' && ref.display_label.trim()
          ? ref.display_label.trim()
          : ref.connector_id || 'External link',
      linked_note_refs: new Set(),
      noteScopes: [ref.scope ?? 'personal'],
      created: ref.created ?? '1970-01-01T00:00:00.000Z',
      updated: ref.updated ?? ref.created ?? '1970-01-01T00:00:00.000Z',
    });
  }

  const notes = getNotesWithMeta(vaultPath, options.vaultConfig ?? {});
  for (const note of notes) {
    deriveFromNote(note, vaultPath, mediaSubdir, index);
  }

  const now = new Date().toISOString();
  /** @type {StoredAttachment[]} */
  const out = [];

  for (const row of index.values()) {
    const linkedRefs = [...row.linked_note_refs].sort();
    const scope =
      linkedRefs.length === 0 &&
      (row.source === 'vault_file' || row.source === 'connector_ref')
        ? row.noteScopes?.[0] ?? 'personal'
        : mostRestrictiveScope(row.noteScopes.length ? row.noteScopes : ['personal']);

    const policy = resolvePolicy(dataDir, row.attachment_id, policies, row.updated);
    out.push({
      schema: 'knowtation.attachment/v0',
      attachment_id: row.attachment_id,
      source: row.source,
      storage_kind: row.storage_kind,
      mime_class: row.mime_class,
      mime_type: row.mime_type,
      scope,
      display_label: row.display_label,
      byte_size: row.byte_size ?? null,
      linked_note_refs: linkedRefs,
      agent_visible: policy.agent_visible,
      created: row.created ?? now,
      updated: policy.updated ?? row.updated ?? now,
      truncated: false,
    });
  }

  return out;
}

/**
 * @param {StoredAttachment} attachment
 * @param {{ hubScope?: { projects?: string[], folders?: string[] }|null, notesByRef?: Map<string, object> }} ctx
 * @returns {boolean}
 */
function isAttachmentNoteVisible(attachment, ctx) {
  if (attachment.linked_note_refs.length === 0) {
    return attachment.source === 'vault_file' || attachment.source === 'connector_ref';
  }
  const hubScope = ctx.hubScope;
  const notesByRef = ctx.notesByRef ?? new Map();
  for (const ref of attachment.linked_note_refs) {
    const pathPart = ref.startsWith('note:') ? ref.slice(5) : ref;
    const note = notesByRef.get(ref) ?? { path: pathPart, project: undefined };
    if (!hubScope || (!hubScope.projects?.length && !hubScope.folders?.length)) {
      return true;
    }
    const filtered = applyScopeFilterToNotes([note], hubScope);
    if (filtered.length > 0) return true;
  }
  return false;
}

/**
 * @param {StoredAttachment} attachment
 * @param {Set<AttachmentScope>} filterScopes
 * @param {{ hubScope?: object|null, notesByRef?: Map<string, object>, agentContext?: boolean, agentVisibleOnly?: boolean }} ctx
 * @returns {boolean}
 */
function attachmentVisible(attachment, filterScopes, ctx) {
  if (!filterScopes.has(attachment.scope)) return false;
  if (!isAttachmentNoteVisible(attachment, ctx)) return false;
  if (ctx.agentContext && !attachment.agent_visible) return false;
  if (ctx.agentVisibleOnly && !attachment.agent_visible) return false;
  return true;
}

/**
 * @param {string} vaultPath
 * @param {object} [vaultConfig]
 * @returns {Map<string, object>}
 */
function buildNotesByRef(vaultPath, vaultConfig) {
  const notes = getNotesWithMeta(vaultPath, vaultConfig ?? {});
  const map = new Map();
  for (const note of notes) {
    map.set(noteRefFromPath(note.path), note);
  }
  return map;
}

const MIME_CLASS_ORDER = { audio: 0, document: 1, image: 2, unknown: 3, video: 4 };

/**
 * @param {StoredAttachment} a
 * @param {StoredAttachment} b
 * @returns {number}
 */
function compareAttachmentsForList(a, b) {
  const mc = (MIME_CLASS_ORDER[a.mime_class] ?? 99) - (MIME_CLASS_ORDER[b.mime_class] ?? 99);
  if (mc !== 0) return mc;
  return a.attachment_id.localeCompare(b.attachment_id);
}

/**
 * List scope-visible attachment summaries.
 *
 * @param {string} dataDir
 * @param {string} vaultPath
 * @param {string} vaultId
 * @param {{
 *   visibleScopes?: Set<AttachmentScope>,
 *   filterScopes?: Set<AttachmentScope>,
 *   effectiveScope: AttachmentScope,
 *   noteRef?: string,
 *   source?: string,
 *   mimeClass?: string,
 *   storageKind?: string,
 *   agentVisibleOnly?: boolean,
 *   agentContext?: boolean,
 *   limit?: number,
 *   mediaSubdir?: string,
 *   hubScope?: { projects?: string[], folders?: string[] }|null,
 *   vaultConfig?: object,
 * }} query
 */
export function listAttachments(dataDir, vaultPath, vaultId, query) {
  const filterScopes = query.filterScopes ?? query.visibleScopes ?? new Set(['personal']);
  let limit = typeof query.limit === 'number' ? query.limit : MAX_ATTACHMENT_SUMMARIES;
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_ATTACHMENT_SUMMARIES;
  if (limit > MAX_ATTACHMENT_SUMMARIES) limit = MAX_ATTACHMENT_SUMMARIES;

  const notesByRef = buildNotesByRef(vaultPath, query.vaultConfig);
  const ctx = {
    hubScope: query.hubScope ?? null,
    notesByRef,
    agentContext: query.agentContext === true,
    agentVisibleOnly: query.agentVisibleOnly === true,
  };

  let candidates = deriveAllAttachments(vaultPath, dataDir, vaultId, {
    mediaSubdir: query.mediaSubdir,
    vaultConfig: query.vaultConfig,
  }).filter((a) => attachmentVisible(a, filterScopes, ctx));

  const noteRef = typeof query.noteRef === 'string' ? query.noteRef.trim() : '';
  if (noteRef) {
    candidates = candidates.filter((a) => a.linked_note_refs.includes(noteRef));
  }
  const sourceFilter = typeof query.source === 'string' ? query.source.trim() : '';
  if (sourceFilter) {
    candidates = candidates.filter((a) => a.source === sourceFilter);
  }
  const mimeClassFilter = typeof query.mimeClass === 'string' ? query.mimeClass.trim() : '';
  if (mimeClassFilter) {
    candidates = candidates.filter((a) => a.mime_class === mimeClassFilter);
  }
  const storageKindFilter = typeof query.storageKind === 'string' ? query.storageKind.trim() : '';
  if (storageKindFilter) {
    candidates = candidates.filter((a) => a.storage_kind === storageKindFilter);
  }

  candidates.sort(compareAttachmentsForList);

  const totalMatching = candidates.length;
  let truncated = totalMatching > limit;
  if (candidates.length > limit) {
    candidates = candidates.slice(0, limit);
  }

  return {
    schema: 'knowtation.attachment_list/v0',
    vault_id: vaultId,
    effective_scope: query.effectiveScope,
    attachments: candidates.map((a) => attachmentSummaryForClient({ ...a, truncated })),
    truncated,
  };
}

/**
 * @param {string} dataDir
 * @param {string} vaultPath
 * @param {string} vaultId
 * @param {string} attachmentId
 * @param {{
 *   visibleScopes?: Set<AttachmentScope>,
 *   mediaSubdir?: string,
 *   hubScope?: object|null,
 *   vaultConfig?: object,
 *   agentContext?: boolean,
 * }} query
 * @returns {StoredAttachment|null}
 */
export function getAttachment(dataDir, vaultPath, vaultId, attachmentId, query) {
  if (!ATTACHMENT_ID_RE.test(attachmentId)) {
    return null;
  }

  const filterScopes = query.visibleScopes ?? new Set(['personal']);
  const notesByRef = buildNotesByRef(vaultPath, query.vaultConfig);
  const ctx = {
    hubScope: query.hubScope ?? null,
    notesByRef,
    agentContext: query.agentContext === true,
  };

  const row = deriveAllAttachments(vaultPath, dataDir, vaultId, {
    mediaSubdir: query.mediaSubdir,
    vaultConfig: query.vaultConfig,
  }).find((a) => a.attachment_id === attachmentId);

  if (!row) return null;
  if (!attachmentVisible(row, filterScopes, ctx)) return null;
  return row;
}

/**
 * @param {Set<AttachmentScope>} visibleScopes
 * @returns {AttachmentScope}
 */
export function attachmentGetEffectiveScope(visibleScopes) {
  return highestFlowScope(visibleScopes);
}
