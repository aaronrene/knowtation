/**
 * Issue #1 Phase D2 — Hosted MCP server variant for the Hub gateway.
 * Creates a per-session McpServer backed by canister (notes CRUD) and bridge (search/index).
 * Tools are role-filtered based on user permissions.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { IMPORT_SOURCE_TYPES } from '../../lib/import-source-types.mjs';
import {
  displayTitleFromHostedNote,
  titleFromCanisterFrontmatter,
  titleFromPathStem,
} from '../../lib/canister-frontmatter.mjs';
import { normalizeSlug, effectiveProjectSlug } from '../../lib/vault.mjs';
import { extractCheckboxTasksFromBody } from '../../lib/extract-tasks.mjs';
import { materializeListFrontmatter, tagsFromFm } from './note-facets.mjs';
import { findFirstWikilinkToTargetInBody, vaultBasenameTargetKey } from '../../lib/wikilink.mjs';
import { kmeans } from '../../lib/kmeans.mjs';
import { buildCaptureInboxWritePayload } from '../../lib/capture-inbox.mjs';
import { noteToMarkdown } from '../../mcp/resources/note.mjs';
import {
  textContent,
  maybeAppendSamplingPrefill,
  snippet,
  parseIntSafe,
  MAX_EMBEDDED_NOTES,
  MAX_ENTITY_NOTES,
  PROJECT_SUMMARY_NOTES,
  CONTENT_PLAN_NOTES,
} from '../../mcp/prompts/helpers.mjs';
import { extractImageUrls } from '../../lib/media-url-extract.mjs';
import { extractTopicFromEvent, slugify } from '../../lib/memory-event.mjs';
import { fetchImageAsBase64 } from '../../mcp/resources/image-fetch.mjs';
import { isToolAllowed, isPromptAllowed, allowedPromptsForRole } from './mcp-tool-acl.mjs';

/** @type {[string, string, ...string[]]} */
const IMPORT_SOURCE_ENUM = /** @type {any} */ ([...IMPORT_SOURCE_TYPES]);

const BRIDGE_IMPORT_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Hosted MCP `export` calls the same upstream as hub/bridge/server.mjs vault backup:
 * GET {canisterUrl}/api/v1/export with X-User-Id / X-Vault-Id (+ gateway secret when configured).
 * Response shape is built in hub/icp/src/hub/main.mo (pathKind == "export", GET): JSON object with a `notes` array.
 *
 * Full vault JSON can exceed MCP context limits; responses larger than this byte count are rejected
 * with code EXPORT_TOO_LARGE (MCP-only cap; Hub / vault_sync / direct canister export are not limited by this).
 */
const HOSTED_MCP_EXPORT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Same slice as `lib/relate.mjs` when building the embedding text from the source note. */
const RELATE_BODY_SLICE = 12000;

/** Same cap as `lib/tag-suggest.mjs` (`runTagSuggest`) when building text for semantic neighbors. */
const TAG_SUGGEST_TEXT_SLICE = 12000;

/** Default bridge semantic search limit for tag aggregation (neighbor rows before dedupe / existing-tag filter). */
const TAG_SUGGEST_NEIGHBOR_LIMIT_DEFAULT = 40;
/** Hard cap for optional `neighbor_limit` tool argument (latency: up to this many canister GETs when bridge rows lack tags). */
const TAG_SUGGEST_NEIGHBOR_LIMIT_MAX = 80;

/**
 * Hosted `backlinks`: max canister notes examined (each may trigger one `GET …/notes/:path`).
 * Soft cap to limit latency and load; partial vault coverage sets `backlinks_truncated: true`.
 */
const HOSTED_BACKLINKS_MAX_NOTES = 2000;
const HOSTED_BACKLINKS_PAGE_SIZE = 100;

/**
 * Hosted `extract_tasks`: max canister list rows processed (each may trigger one `GET …/notes/:path` when body empty).
 */
const HOSTED_EXTRACT_TASKS_MAX_NOTES = 2000;
const HOSTED_EXTRACT_TASKS_PAGE_SIZE = 100;

/**
 * Hosted `cluster`: max canister list rows processed while collecting up to {@link HOSTED_CLUSTER_MAX_NOTES} notes.
 * Same soft cap pattern as `extract_tasks` / `backlinks`.
 */
const HOSTED_CLUSTER_MAX_LIST_ROWS = 2000;
const HOSTED_CLUSTER_PAGE_SIZE = 100;
/** Max notes embedded per call (parity with local `runCluster` / `lib/cluster-semantic.mjs`). */
const HOSTED_CLUSTER_MAX_NOTES = 200;
const HOSTED_CLUSTER_TEXT_SLICE = 800;

/** Max notes expanded into MCP `resources/list` for the hosted vault note template (SDK merges `list` results there). */
const HOSTED_VAULT_RESOURCE_LIST_MAX = 50;

/** R2: static `knowtation://hosted/vault-listing` uses this cap (same canister list as `list_notes`). */
const HOSTED_VAULT_LISTING_RESOURCE_LIMIT = 100;

/** R3: `resources/list` merge cap for embedded image URIs (matches self-hosted `MCP_RESOURCE_PAGE_SIZE`). */
const HOSTED_IMAGE_RESOURCE_LIST_MAX = 50;
/**
 * R3: canister `GET /api/v1/notes` page size while scanning the vault for embedded images to merge into
 * `resources/list`. Paginate until we collect {@link HOSTED_IMAGE_RESOURCE_LIST_MAX} image URIs, the canister
 * returns no more notes, or we hit {@link HOSTED_IMAGE_LIST_MAX_NOTES_SCANNED} (fairness on very large vaults).
 */
const HOSTED_IMAGE_LIST_NOTES_PAGE_SIZE = 50;
/** R3: upper bound on notes examined per `resources/list` image merge (limits gateway latency / upstream load). */
const HOSTED_IMAGE_LIST_MAX_NOTES_SCANNED = 5000;

/** R3: bridge `GET /api/v1/memory` max slice for topic derivation / filtering (bridge hard cap 100). */
const HOSTED_MEMORY_TOPIC_BRIDGE_LIMIT = 100;

/** R3: templates folder listing uses the same page size as vault listing resources. */
const HOSTED_TEMPLATES_LIST_LIMIT = 100;

function vaultPathKey(p) {
  return String(p ?? '').replace(/\\/g, '/').trim();
}

function relateSnippet(s) {
  return String(s ?? '').slice(0, 200).replace(/\s+/g, ' ').trim();
}

function pathMatchesFolderForExtractTasks(p, folderOpt) {
  if (folderOpt == null || String(folderOpt).trim() === '') return true;
  const prefix = String(folderOpt).replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const exact = String(folderOpt).replace(/\\/g, '/').replace(/\/$/, '');
  return p === exact || p.startsWith(prefix);
}

function dateKeyFromHostedFrontmatter(fm) {
  const raw = fm.date ?? fm.updated;
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  return s.slice(0, 10);
}

/**
 * Client-side filters mirroring local `runExtractTasks` (path + materialized canister frontmatter).
 * @param {string} path
 * @param {unknown} frontmatterRaw
 * @param {{ folder?: string, project?: string, tag?: string, since?: string, until?: string }} f
 */
function hostedNotePassesExtractFilters(path, frontmatterRaw, f) {
  const p = vaultPathKey(path);
  if (!p) return false;
  if (!pathMatchesFolderForExtractTasks(p, f.folder)) return false;
  const fm = materializeListFrontmatter(frontmatterRaw);
  if (f.project != null && String(f.project).trim() !== '') {
    const wp = normalizeSlug(String(f.project));
    if (effectiveProjectSlug(p, fm) !== wp) return false;
  }
  if (f.tag != null && String(f.tag).trim() !== '') {
    const wt = normalizeSlug(String(f.tag));
    const tagSet = tagsFromFm(fm).map((t) => normalizeSlug(String(t))).filter(Boolean);
    if (!tagSet.includes(wt)) return false;
  }
  const d = dateKeyFromHostedFrontmatter(fm);
  if (f.since != null && String(f.since).trim() !== '') {
    const s = String(f.since).trim().slice(0, 10);
    if (!d || d < s) return false;
  }
  if (f.until != null && String(f.until).trim() !== '') {
    const u = String(f.until).trim().slice(0, 10);
    if (!d || d > u) return false;
  }
  return true;
}

/**
 * Text passed to bridge `POST /api/v1/embed` (document vectors), aligned with local `runCluster`.
 * @param {unknown} frontmatterRaw
 * @param {unknown} bodyFull
 */
function hostedClusterEmbedText(frontmatterRaw, bodyFull) {
  const title = titleFromCanisterFrontmatter(frontmatterRaw);
  const body = bodyFull != null ? String(bodyFull) : '';
  const t = `${title ? `${title}\n` : ''}${body.slice(0, HOSTED_CLUSTER_TEXT_SLICE)}`;
  return t.trim();
}

/**
 * Tags already on the target note (slug form), matching local `runTagSuggest` (`note.tags` vs frontmatter).
 * @param {Record<string, unknown>} note
 * @returns {string[]}
 */
function hostedExistingTagsFromCanisterNote(note) {
  const tagsTop = note && typeof note === 'object' && Array.isArray(note.tags) ? note.tags : null;
  if (tagsTop && tagsTop.length) {
    return tagsTop.map((t) => normalizeSlug(String(t))).filter(Boolean);
  }
  const fm = materializeListFrontmatter(note?.frontmatter);
  return tagsFromFm(fm).map((t) => normalizeSlug(String(t))).filter(Boolean);
}

/**
 * Tags from a bridge search hit and/or canister note JSON.
 * @param {unknown} tagsRaw
 * @param {Record<string, unknown>} [canisterNote]
 * @returns {string[]}
 */
function hostedTagsFromHitOrNote(tagsRaw, canisterNote) {
  if (Array.isArray(tagsRaw) && tagsRaw.length) {
    return tagsRaw.map((t) => normalizeSlug(String(t))).filter(Boolean);
  }
  if (canisterNote && typeof canisterNote === 'object') {
    return hostedExistingTagsFromCanisterNote(canisterNote);
  }
  return [];
}

/**
 * Bridge semantic hits may expose `score` only, or `vec_distance` when sqlite coerces distance.
 * @param {Record<string, unknown>} h
 * @returns {number}
 */
function scoreFromBridgeSearchHit(h) {
  if (!h || typeof h !== 'object') return 0;
  const sc = h.score;
  if (typeof sc === 'number' && Number.isFinite(sc) && sc > 0) return sc;
  if (typeof sc === 'string') {
    const n = Number(sc);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const vd = h.vec_distance;
  if (typeof vd === 'number' && Number.isFinite(vd) && vd >= 0) return 1 / (1 + vd);
  if (typeof vd === 'string') {
    const n = Number(vd);
    if (Number.isFinite(n) && n >= 0) return 1 / (1 + n);
  }
  if (typeof sc === 'number' && Number.isFinite(sc)) return sc;
  return 0;
}

function jsonResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function jsonError(msg, code = 'ERROR') {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg, code }) }], isError: true };
}

/** Aligns with `MAX_MEMORY_EVENTS` in `mcp/prompts/helpers.mjs` / `formatMemoryEventsAsync`. */
const MAX_MEMORY_EVENTS_FORMAT = 30;

/**
 * Format bridge `GET /api/v1/memory` JSON (`{ events, count }`) like `formatMemoryEventsAsync` (local).
 * @param {unknown} memoryJson
 * @param {{ limit?: number }} [opts]
 * @returns {{ text: string, count: number }}
 */
function formatMemoryEventsFromBridgeResponse(memoryJson, opts = {}) {
  const raw = Array.isArray(/** @type {{ events?: unknown[] }} */ (memoryJson)?.events)
    ? /** @type {{ events?: unknown[] }} */ (memoryJson).events
    : [];
  const cap = Math.min(Math.max(1, opts.limit != null ? Number(opts.limit) : 20), MAX_MEMORY_EVENTS_FORMAT);
  const events = raw.slice(0, cap);
  if (events.length === 0) return { text: '(No memory events found.)', count: 0 };
  const lines = events.map((e) => {
    const ee = /** @type {{ ts?: string, type?: string, data?: unknown }} */ (e);
    const d = ee.data != null && typeof ee.data === 'object' ? ee.data : {};
    const summary = JSON.stringify(d).slice(0, 200);
    return `- **${ee.ts}** [${ee.type}] ${summary}`;
  });
  return { text: lines.join('\n'), count: events.length };
}

/**
 * @param {unknown[]} events
 * @param {string} topicParam
 */
function filterHostedMemoryEventsByTopic(events, topicParam) {
  const want = slugify(String(topicParam || ''));
  if (!want) return [];
  return events.filter((e) => extractTopicFromEvent(/** @type {object} */ (e)) === want);
}

/**
 * @param {unknown[]} events
 * @returns {string[]}
 */
function uniqueHostedMemoryTopicSlugs(events) {
  const s = new Set();
  for (const e of events) {
    s.add(extractTopicFromEvent(/** @type {object} */ (e)));
  }
  return [...s].sort();
}

/**
 * Fetch JSON from an upstream service with auth forwarding.
 * @param {string} url
 * @param {{ method?: string, body?: unknown, token?: string, vaultId?: string, userId?: string }} [opts]
 */
async function upstreamFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.vaultId) headers['X-Vault-Id'] = opts.vaultId;
  if (opts.userId) headers['X-User-Id'] = opts.userId;
  if (opts.canisterAuthSecret) headers['X-Gateway-Auth'] = opts.canisterAuthSecret;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * GET JSON from the canister with a hard cap on response body bytes (hosted export safety).
 * @param {string} url
 * @param {{ token?: string, vaultId?: string, userId?: string, canisterAuthSecret?: string }} opts
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
async function canisterGetJsonWithByteLimit(url, opts, maxBytes) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.vaultId) headers['X-Vault-Id'] = opts.vaultId;
  if (opts.userId) headers['X-User-Id'] = opts.userId;
  if (opts.canisterAuthSecret) headers['X-Gateway-Auth'] = opts.canisterAuthSecret;
  const res = await fetch(url, { method: 'GET', headers });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  if (!res.ok) {
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  if (buf.byteLength > maxBytes) {
    const err = new Error(
      `Export response is ${buf.byteLength} bytes; this MCP tool allows at most ${maxBytes} bytes (MCP-only safety limit, not a vault or canister limit). For a full vault export with no MCP size cap, use the Hub (e.g. GitHub backup / Back up now) or other non-MCP flows such as vault_sync; operators may also call the canister GET /api/v1/export outside MCP.`
    );
    /** @type {any} */ (err).code = 'EXPORT_TOO_LARGE';
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from canister export');
  }
}

/**
 * POST multipart to bridge /api/v1/import (same headers as hub/gateway proxyImportToBridge).
 * @param {string} bridgeUrl
 * @param {{ token?: string, vaultId?: string, userId?: string }} fetchOpts
 * @param {FormData} formData
 * @returns {Promise<unknown>}
 */
async function bridgeImportMultipart(bridgeUrl, fetchOpts, formData) {
  const headers = { Accept: 'application/json' };
  if (fetchOpts.token) headers['Authorization'] = `Bearer ${fetchOpts.token}`;
  if (fetchOpts.vaultId) headers['X-Vault-Id'] = fetchOpts.vaultId;
  if (fetchOpts.userId) headers['X-User-Id'] = fetchOpts.userId;
  const res = await fetch(`${bridgeUrl}/api/v1/import`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/**
 * Create a hosted McpServer instance scoped to one user's session.
 *
 * @param {{
 *   userId: string,
 *   canisterUserId?: string,
 *   vaultId: string,
 *   role: 'viewer' | 'editor' | 'admin',
 *   token: string,
 *   canisterUrl: string,
 *   canisterAuthSecret?: string,
 *   bridgeUrl: string,
 *   scope?: Record<string, unknown>,
 * }} ctx
 * @returns {McpServer}
 */
export function createHostedMcpServer(ctx) {
  const { userId, vaultId, role, token, canisterUrl, canisterAuthSecret, bridgeUrl, scope = {} } = ctx;
  const canisterUserId =
    typeof ctx.canisterUserId === 'string' && ctx.canisterUserId.trim() !== '' ? ctx.canisterUserId.trim() : userId;
  const server = new McpServer(
    { name: 'knowtation-hosted', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );
  const fetchOpts = { token, vaultId };
  /** Same as Hub proxy: bridge resolves `effectiveCanisterUid` from JWT; header aids debugging. */
  const bridgeFetchOpts = { token, vaultId, userId };
  /** Canister `X-User-Id` matches Hub gateway: `effective_canister_user_id` when MCP session supplies it. */
  const canisterFetchOpts = { ...fetchOpts, userId: canisterUserId, canisterAuthSecret: canisterAuthSecret || '' };

  /**
   * Shared multipart body for bridge `POST /api/v1/import` (hosted `import` and `transcribe` tools).
   * @param {{ source_type: string, file_base64: string, filename: string, project?: string, output_dir?: string, tags?: string|string[] }} args
   */
  async function hostedBridgeImportFromBase64Args(args) {
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(args.file_base64, 'base64');
    } catch {
      const err = new Error('file_base64 is not valid base64');
      /** @type {any} */ (err).code = 'INVALID';
      throw err;
    }
    if (!fileBuffer.length) {
      const err = new Error('Decoded file is empty');
      /** @type {any} */ (err).code = 'INVALID';
      throw err;
    }
    if (fileBuffer.length > BRIDGE_IMPORT_MAX_BYTES) {
      const err = new Error(`Decoded file exceeds ${BRIDGE_IMPORT_MAX_BYTES} bytes`);
      /** @type {any} */ (err).code = 'INVALID';
      throw err;
    }
    const form = new FormData();
    form.set('source_type', args.source_type);
    const blob = new Blob([fileBuffer]);
    form.set('file', blob, args.filename);
    if (args.project != null && args.project !== '') form.set('project', args.project);
    if (args.output_dir != null && args.output_dir !== '') form.set('output_dir', args.output_dir);
    if (args.tags != null) {
      const tagsStr = Array.isArray(args.tags)
        ? args.tags.map((t) => String(t).trim()).filter(Boolean).join(',')
        : String(args.tags);
      if (tagsStr) form.set('tags', tagsStr);
    }
    return bridgeImportMultipart(bridgeUrl, bridgeFetchOpts, form);
  }

  if (isToolAllowed('search', role)) {
    server.registerTool(
      'search',
      {
        description:
          'Search the hosted vault: semantic (vector similarity, default) or keyword (substring / all-terms). Same filters as list-notes where applicable.',
        inputSchema: {
          query: z.string().describe('Search query'),
          mode: z.enum(['semantic', 'keyword']).optional().describe('semantic = meaning (indexed); keyword = literal text'),
          match: z.enum(['phrase', 'all_terms']).optional().describe('Keyword only: phrase = whole query substring; all_terms = every token must appear (AND)'),
          limit: z.number().optional().describe('Max results (default 10)'),
          fields: z.enum(['path', 'path+snippet', 'full']).optional().describe('Result shape (default path+snippet)'),
          snippet_chars: z.number().optional().describe('Max snippet length (default 300)'),
          count_only: z.boolean().optional().describe('Return count only, no results array'),
          folder: z.string().optional().describe('Filter by folder path prefix'),
          project: z.string().optional().describe('Filter by project slug'),
          tag: z.string().optional().describe('Filter by tag'),
          since: z.string().optional().describe('Filter by date (YYYY-MM-DD)'),
          until: z.string().optional().describe('Filter by date (YYYY-MM-DD)'),
          order: z.enum(['date', 'date-asc']).optional(),
          chain: z.string().optional().describe('Causal chain filter'),
          entity: z.string().optional().describe('Entity filter'),
          episode: z.string().optional().describe('Episode filter'),
          content_scope: z.enum(['all', 'notes', 'approval_logs']).optional().describe('Restrict to note files vs approval logs'),
        },
      },
      async (args) => {
        try {
          const body = { query: args.query };
          if (args.mode != null) body.mode = args.mode;
          if (args.match != null) body.match = args.match;
          if (args.limit != null) body.limit = args.limit;
          if (args.fields != null) body.fields = args.fields;
          if (args.snippet_chars != null) body.snippetChars = args.snippet_chars;
          if (args.count_only != null) body.count_only = args.count_only;
          if (args.folder != null) body.folder = args.folder;
          if (args.project != null) body.project = args.project;
          if (args.tag != null) body.tag = args.tag;
          if (args.since != null) body.since = args.since;
          if (args.until != null) body.until = args.until;
          if (args.order != null) body.order = args.order;
          if (args.chain != null) body.chain = args.chain;
          if (args.entity != null) body.entity = args.entity;
          if (args.episode != null) body.episode = args.episode;
          if (args.content_scope != null) body.content_scope = args.content_scope;
          const data = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body,
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted `relate` — parity with local `runRelate` (`lib/relate.mjs`) without a filesystem vault.
   *
   * Upstream (verified in `hub/bridge/server.mjs`):
   * - **Source note:** `GET {canisterUrl}/api/v1/notes/:path` with the same headers as `get_note`
   *   (`Authorization`, `X-Vault-Id`, `X-User-Id`, `X-Gateway-Auth`).
   * - **Neighbors:** `POST {bridgeUrl}/api/v1/search` with JSON body
   *   `{ query, mode: "semantic", limit, snippetChars: 200, project? }`; bridge embeds `query` with
   *   `voyageInputType: "query"`. Only paths that return 200 from canister `GET …/notes/:path` are
   *   returned (stale vector paths omitted).
   */
  if (isToolAllowed('relate', role)) {
    server.registerTool(
      'relate',
      {
        description:
          'Find semantically related notes for a vault-relative path: read the source note from the canister, semantic search on the bridge index (excludes the source path), titles from the canister. Neighbors that do not exist on the canister (stale index) are omitted.',
        inputSchema: {
          path: z.string().describe('Vault-relative path to the source note (.md)'),
          limit: z.number().optional().describe('Max related notes (default 5, max 20)'),
          project: z.string().optional().describe('Filter neighbors by project slug'),
        },
      },
      async (args) => {
        try {
          const note = await upstreamFetch(
            `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
            canisterFetchOpts
          );
          const titleFm = titleFromCanisterFrontmatter(note.frontmatter) ?? '';
          const body = note.body != null ? String(note.body) : '';
          const embedText = `${titleFm ? `${titleFm}\n` : ''}${body}`.slice(0, RELATE_BODY_SLICE);
          if (!embedText.trim()) {
            return jsonError('Source note has no title or body to embed; cannot relate.', 'INVALID');
          }
          const srcKey = vaultPathKey(note.path ?? args.path);

          const want = Math.max(1, Math.min(Number(args.limit) || 5, 20));
          const searchLimit = Math.min(100, Math.max(want + 15, want * 12));

          const searchBody = {
            query: embedText,
            mode: 'semantic',
            limit: searchLimit,
            snippetChars: 200,
          };
          if (args.project != null && String(args.project).trim() !== '') {
            searchBody.project = normalizeSlug(String(args.project));
          }

          const data = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: searchBody,
          });
          const rows = Array.isArray(data.results) ? data.results : [];
          const seen = new Set();
          const related = [];
          for (const h of rows) {
            if (related.length >= want) break;
            const p = vaultPathKey(h.path);
            if (!p || p === srcKey) continue;
            if (seen.has(p)) continue;
            seen.add(p);
            try {
              const rn = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              related.push({
                path: p,
                score: scoreFromBridgeSearchHit(/** @type {Record<string, unknown>} */ (h)),
                title: displayTitleFromHostedNote(rn),
                snippet: relateSnippet(h.snippet ?? h.text),
              });
            } catch (_) {
              // Omit stale vector hits (path not on canister).
            }
          }

          await Promise.all(
            related.map(async (r) => {
              const pathFallback = titleFromPathStem(r.path);
              try {
                const rn = await upstreamFetch(
                  `${canisterUrl}/api/v1/notes/${encodeURIComponent(r.path)}`,
                  canisterFetchOpts
                );
                const noteForTitle = { ...rn, path: (rn && rn.path) || r.path };
                r.title = displayTitleFromHostedNote(noteForTitle) ?? pathFallback;
              } catch {
                r.title = pathFallback;
              }
            })
          );

          return jsonResponse({ path: srcKey, related });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted `backlinks` — parity with local `runBacklinks` (`lib/backlinks.mjs`) without a filesystem vault.
   *
   * Contract: paginate `GET {canisterUrl}/api/v1/notes?limit=&offset=` (same headers as `list_notes`),
   * skip the target path, `GET` each candidate note for full body (list rows may omit body), scan with
   * `findFirstWikilinkToTargetInBody` (`lib/wikilink.mjs`) using `vaultBasenameTargetKey(target)` as in local.
   * Stops after **HOSTED_BACKLINKS_MAX_NOTES** candidates examined; response includes `backlinks_truncated` and
   * `backlinks_notes_scanned` so callers know coverage.
   */
  if (isToolAllowed('backlinks', role)) {
    server.registerTool(
      'backlinks',
      {
        description:
          'Notes that wikilink to a target path (`[[target]]` / `[[folder/target]]`, Obsidian-style). Scans the hosted vault via canister list + per-note reads (capped at 2000 notes examined; see backlinks_truncated in the JSON).',
        inputSchema: {
          path: z.string().describe('Vault-relative path of the target note (.md)'),
        },
      },
      async (args) => {
        try {
          await upstreamFetch(
            `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
            canisterFetchOpts
          );
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
        const srcKey = vaultPathKey(args.path);
        const targetKey = vaultBasenameTargetKey(srcKey);
        const backlinks = [];
        let offset = 0;
        let scanned = 0;
        while (scanned < HOSTED_BACKLINKS_MAX_NOTES) {
          const remain = HOSTED_BACKLINKS_MAX_NOTES - scanned;
          const pageSize = Math.min(HOSTED_BACKLINKS_PAGE_SIZE, Math.max(1, remain));
          const list = await upstreamFetch(
            `${canisterUrl}/api/v1/notes?limit=${pageSize}&offset=${offset}`,
            canisterFetchOpts
          );
          const rows = Array.isArray(list.notes) ? list.notes : [];
          if (rows.length === 0) break;
          for (const row of rows) {
            if (scanned >= HOSTED_BACKLINKS_MAX_NOTES) break;
            scanned += 1;
            const p = vaultPathKey(row.path);
            if (!p || p === srcKey) continue;
            let full;
            try {
              full = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
            } catch {
              continue;
            }
            const body = full.body != null ? String(full.body) : '';
            const context = findFirstWikilinkToTargetInBody(body, targetKey);
            if (context == null) continue;
            const pathFb = titleFromPathStem(p);
            backlinks.push({
              path: p,
              title: displayTitleFromHostedNote(full) ?? titleFromCanisterFrontmatter(full.frontmatter) ?? pathFb,
              context,
            });
          }
          offset += rows.length;
          if (rows.length < pageSize) break;
        }
        return jsonResponse({
          path: srcKey,
          backlinks,
          backlinks_truncated: scanned >= HOSTED_BACKLINKS_MAX_NOTES,
          backlinks_notes_scanned: scanned,
        });
      }
    );
  }

  /**
   * Hosted `extract_tasks` — parity with local `runExtractTasks` (`lib/extract-tasks.mjs`) without a filesystem vault.
   *
   * Upstream: paginate `GET {canisterUrl}/api/v1/notes` with the same query keys as hosted `list_notes`
   * (`folder`, `project`, `tag`, `since`, `until`, `limit`, `offset`). The ICP canister in this repo returns full
   * bodies on list rows; when a row has an empty body, the handler falls back to `GET …/notes/:path`.
   * Client-side folder/project/tag/date filters mirror local `runExtractTasks` (canister list query params are not
   * relied on for correctness). Stops after **HOSTED_EXTRACT_TASKS_MAX_NOTES** list rows processed.
   */
  if (isToolAllowed('extract_tasks', role)) {
    server.registerTool(
      'extract_tasks',
      {
        description:
          'Extract markdown checkbox tasks (`- [ ]` / `- [x]`) from the hosted vault. Uses canister note list + bodies (GET per note only when list body is empty). Optional folder/project/tag/since/until match hosted list_notes query shapes; filters are applied client-side like local extract_tasks. Max 2000 notes scanned per call (see extract_tasks_truncated in the JSON).',
        inputSchema: {
          folder: z.string().optional().describe('Restrict to notes under this vault-relative folder prefix'),
          project: z.string().optional().describe('Filter by project slug'),
          tag: z.string().optional().describe('Filter by tag'),
          since: z.string().optional().describe('Include only notes with date/updated on or after YYYY-MM-DD'),
          until: z.string().optional().describe('Include only notes with date/updated on or before YYYY-MM-DD'),
          status: z.enum(['open', 'done', 'all']).optional().describe('Task checkbox filter (default all)'),
        },
      },
      async (args) => {
        try {
          const statusArg = args.status ?? 'all';
          const filter = {
            folder: args.folder,
            project: args.project,
            tag: args.tag,
            since: args.since,
            until: args.until,
          };
          const tasks = [];
          let offset = 0;
          let scanned = 0;
          while (scanned < HOSTED_EXTRACT_TASKS_MAX_NOTES) {
            const remain = HOSTED_EXTRACT_TASKS_MAX_NOTES - scanned;
            const pageSize = Math.min(HOSTED_EXTRACT_TASKS_PAGE_SIZE, Math.max(1, remain));
            const params = new URLSearchParams();
            if (args.folder) params.set('folder', args.folder);
            if (args.project) params.set('project', args.project);
            if (args.tag) params.set('tag', args.tag);
            if (args.since) params.set('since', args.since);
            if (args.until) params.set('until', args.until);
            params.set('limit', String(pageSize));
            params.set('offset', String(offset));
            const list = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
            const rows = Array.isArray(list.notes) ? list.notes : [];
            if (rows.length === 0) break;
            for (const row of rows) {
              if (scanned >= HOSTED_EXTRACT_TASKS_MAX_NOTES) break;
              scanned += 1;
              const p = vaultPathKey(row.path);
              if (!p) continue;
              if (!hostedNotePassesExtractFilters(p, row.frontmatter, filter)) continue;
              let body = row.body != null ? String(row.body) : '';
              if (!body.trim()) {
                try {
                  const full = await upstreamFetch(
                    `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                    canisterFetchOpts
                  );
                  body = full.body != null ? String(full.body) : '';
                } catch {
                  continue;
                }
              }
              for (const t of extractCheckboxTasksFromBody(body, { path: p, status: statusArg })) {
                tasks.push(t);
              }
            }
            offset += rows.length;
            if (rows.length < pageSize) break;
          }
          return jsonResponse({
            tasks,
            extract_tasks_truncated: scanned >= HOSTED_EXTRACT_TASKS_MAX_NOTES,
            extract_tasks_notes_scanned: scanned,
          });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted `cluster` — parity with local `runCluster` (`lib/cluster-semantic.mjs`) without a filesystem vault.
   *
   * Upstream (verified in `hub/bridge/server.mjs`):
   * - **Note text:** paginate `GET {canisterUrl}/api/v1/notes` (same query keys as hosted `list_notes`); optional
   *   `GET …/notes/:path` when a list row has an empty body. Client-side `folder` / `project` filters match
   *   `hostedNotePassesExtractFilters` (same intent as local path + project filter).
   * - **Embeddings:** `POST {bridgeUrl}/api/v1/embed` with JSON `{ texts: string[] }`; same JWT + `X-Vault-Id` +
   *   `resolveHostedBridgeContext` as `POST /api/v1/search`; uses `getVectorsDirForUser` + `getBridgeStoreConfig` +
   *   `embedWithUsage` with `voyageInputType: "document"` like `POST /api/v1/index` chunk batches.
   * - **Grouping:** `kmeans` from `lib/kmeans.mjs` on returned vectors (max {@link HOSTED_CLUSTER_MAX_NOTES} notes;
   *   `n_clusters` default 5, clamped 2–15).
   */
  if (isToolAllowed('cluster', role)) {
    server.registerTool(
      'cluster',
      {
        description:
          'Semantic k-means clusters over hosted note text (title + body slice). Loads notes from the canister (list + optional per-note GET), embeds up to 200 notes via the bridge POST /api/v1/embed, then clusters in-process. Optional folder/project filters match list_notes shapes (client-side).',
        inputSchema: {
          folder: z.string().optional().describe('Restrict to notes under this vault-relative folder prefix'),
          project: z.string().optional().describe('Filter by project slug'),
          n_clusters: z
            .number()
            .int()
            .optional()
            .describe('Number of clusters (default 5, clamped between 2 and 15)'),
        },
      },
      async (args) => {
        try {
          const k = Math.max(2, Math.min(Number(args.n_clusters) || 5, 15));
          const filter = { folder: args.folder, project: args.project };
          const texts = [];
          const pathFor = [];
          let offset = 0;
          let scanned = 0;
          while (pathFor.length < HOSTED_CLUSTER_MAX_NOTES && scanned < HOSTED_CLUSTER_MAX_LIST_ROWS) {
            const remain = HOSTED_CLUSTER_MAX_LIST_ROWS - scanned;
            const pageSize = Math.min(HOSTED_CLUSTER_PAGE_SIZE, Math.max(1, remain));
            const params = new URLSearchParams();
            if (args.folder) params.set('folder', args.folder);
            if (args.project) params.set('project', args.project);
            params.set('limit', String(pageSize));
            params.set('offset', String(offset));
            const list = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
            const rows = Array.isArray(list.notes) ? list.notes : [];
            if (rows.length === 0) break;
            for (const row of rows) {
              if (pathFor.length >= HOSTED_CLUSTER_MAX_NOTES) break;
              if (scanned >= HOSTED_CLUSTER_MAX_LIST_ROWS) break;
              scanned += 1;
              const p = vaultPathKey(row.path);
              if (!p) continue;
              if (!hostedNotePassesExtractFilters(p, row.frontmatter, filter)) continue;
              let body = row.body != null ? String(row.body) : '';
              if (!body.trim()) {
                try {
                  const full = await upstreamFetch(
                    `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                    canisterFetchOpts
                  );
                  body = full.body != null ? String(full.body) : '';
                } catch {
                  continue;
                }
              }
              const t = hostedClusterEmbedText(row.frontmatter, body);
              if (!t) continue;
              texts.push(t);
              pathFor.push(p);
            }
            offset += rows.length;
            if (rows.length < pageSize) break;
          }

          if (texts.length < k) {
            return jsonResponse({
              clusters: [],
              notes_sampled: texts.length,
              max_notes: HOSTED_CLUSTER_MAX_NOTES,
              note: `Not enough notes (${texts.length}) for k=${k}. Add notes or lower n_clusters.`,
              cluster_list_rows_scanned: scanned,
              cluster_truncated: scanned >= HOSTED_CLUSTER_MAX_LIST_ROWS,
            });
          }

          const embedRes = await upstreamFetch(`${bridgeUrl}/api/v1/embed`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: { texts },
          });
          const vectorsRaw = embedRes && typeof embedRes === 'object' ? embedRes.vectors : null;
          if (!Array.isArray(vectorsRaw) || vectorsRaw.length !== texts.length) {
            return jsonError('Bridge embed returned an unexpected vectors array', 'UPSTREAM_ERROR');
          }

          const points = [];
          for (let i = 0; i < pathFor.length; i++) {
            const v = vectorsRaw[i];
            if (!v || !Array.isArray(v) || !v.length) continue;
            points.push({
              id: pathFor[i],
              vector: /** @type {number[]} */ (v),
              path: pathFor[i],
              text: texts[i],
            });
          }
          if (points.length < k) {
            return jsonResponse({
              clusters: [],
              notes_sampled: points.length,
              max_notes: HOSTED_CLUSTER_MAX_NOTES,
              note: 'Embedding failed for some notes.',
              cluster_list_rows_scanned: scanned,
              cluster_truncated: scanned >= HOSTED_CLUSTER_MAX_LIST_ROWS,
            });
          }

          const { labels } = kmeans(
            points.map((pt) => ({ id: pt.id, vector: pt.vector })),
            k
          );

          const clusters = [];
          for (let c = 0; c < k; c++) {
            const members = [];
            for (let i = 0; i < points.length; i++) {
              if (labels[i] === c) members.push(points[i]);
            }
            if (!members.length) continue;
            const centroidSnippet = (members[0].text || '').slice(0, 120).replace(/\s+/g, ' ').trim();
            const pathsIn = [...new Set(members.map((m) => m.path))];
            clusters.push({
              label: `cluster_${c + 1}`,
              centroid_snippet: centroidSnippet,
              paths: pathsIn,
            });
          }

          return jsonResponse({
            clusters,
            notes_sampled: points.length,
            max_notes: HOSTED_CLUSTER_MAX_NOTES,
            cluster_list_rows_scanned: scanned,
            cluster_truncated: scanned >= HOSTED_CLUSTER_MAX_LIST_ROWS,
          });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted `tag_suggest` — parity with local `runTagSuggest` (`lib/tag-suggest.mjs`) without a filesystem vault.
   *
   * Upstream (verified in `hub/bridge/server.mjs`):
   * - **Source note (path):** `GET {canisterUrl}/api/v1/notes/:path` with the same headers as `get_note`
   *   (`Authorization`, `X-Vault-Id`, `X-User-Id`, `X-Gateway-Auth`).
   * - **Source text (body-only):** optional `body` argument, trimmed to {@link TAG_SUGGEST_TEXT_SLICE} chars (same cap as local).
   * - **Semantic neighbors:** `POST {bridgeUrl}/api/v1/search` with JSON
   *   `{ query, mode: "semantic", limit: <neighbor_limit>, snippetChars: 200 }` (default {@link TAG_SUGGEST_NEIGHBOR_LIMIT_DEFAULT}, max {@link TAG_SUGGEST_NEIGHBOR_LIMIT_MAX}); same JWT + `X-Vault-Id` + `resolveHostedBridgeContext` as
   *   `relate` / `POST /api/v1/search` (bridge `userIdFromJwt` + hosted context). Search results include `tags` per row when the
   *   vector store exposes them (`results` map in `hub/bridge/server.mjs`). If a hit has no tags, `GET …/notes/:path` on the
   *   canister supplies frontmatter tags (`tagsFromFm` + `materializeListFrontmatter`), analogous to local `readNote` fallback.
   * - **Embedding type:** the bridge embeds `query` with `voyageInputType: "query"` for semantic search; local `runTagSuggest`
   *   uses **document** embedding for the source string — same intentional hosted vs local tradeoff as `relate` vs `lib/relate.mjs`.
   */
  if (isToolAllowed('tag_suggest', role)) {
    server.registerTool(
      'tag_suggest',
      {
        description:
          'Suggest tags from semantically similar notes on the hosted index. Pass vault-relative path (loads title+body from the canister) or raw body text; at least one is required. Uses bridge semantic search (indexed vault) and aggregates tags from neighbors (up to 12 suggestions). Optional neighbor_limit (5–80) increases how many semantic neighbors are considered (default 40).',
        inputSchema: {
          path: z.string().optional().describe('Vault-relative path to the note (.md); loaded from the canister when set'),
          body: z.string().optional().describe('Raw markdown/text when no path; combined with path is invalid — path wins if both are sent'),
          neighbor_limit: z
            .number()
            .optional()
            .describe('Semantic neighbor count for bridge search (clamped 5–80; default 40). Higher values can improve recall on larger vaults at the cost of latency.'),
        },
      },
      async (args) => {
        try {
          const hasPath = args.path != null && String(args.path).trim() !== '';
          const hasBody = args.body != null && String(args.body).trim() !== '';
          if (!hasPath && !hasBody) {
            return jsonError('Provide path or body (at least one).', 'INVALID');
          }

          let embedText = '';
          /** @type {string[]} */
          let existing = [];
          /** @type {string | null} */
          let srcKey = null;

          if (hasPath) {
            const note = await upstreamFetch(
              `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
              canisterFetchOpts
            );
            const titleFm = titleFromCanisterFrontmatter(note.frontmatter) ?? '';
            const body = note.body != null ? String(note.body) : '';
            embedText = `${titleFm ? `${titleFm}\n` : ''}${body}`.slice(0, TAG_SUGGEST_TEXT_SLICE);
            existing = hostedExistingTagsFromCanisterNote(/** @type {Record<string, unknown>} */ (note));
            srcKey = vaultPathKey(note.path ?? args.path);
          } else {
            embedText = String(args.body).slice(0, TAG_SUGGEST_TEXT_SLICE);
          }

          if (!embedText.trim()) {
            return jsonError('No title or body text to match; cannot suggest tags.', 'INVALID');
          }

          const rawNeighbor = Number(args.neighbor_limit);
          const neighborLimit = Number.isFinite(rawNeighbor)
            ? Math.max(5, Math.min(Math.floor(rawNeighbor), TAG_SUGGEST_NEIGHBOR_LIMIT_MAX))
            : TAG_SUGGEST_NEIGHBOR_LIMIT_DEFAULT;

          const searchBody = {
            query: embedText,
            mode: 'semantic',
            limit: neighborLimit,
            snippetChars: 200,
          };
          const data = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: searchBody,
          });
          const rows = Array.isArray(data.results) ? data.results : [];
          const existingSet = new Set(existing.map((t) => normalizeSlug(String(t))).filter(Boolean));
          const tagCounts = new Map();

          for (const h of rows) {
            if (!h || typeof h !== 'object') continue;
            const p = vaultPathKey(h.path);
            if (!p || (srcKey != null && p === srcKey)) continue;

            let tagsRaw = h.tags;
            /** @type {Record<string, unknown> | undefined} */
            let noteForTags;
            if (!Array.isArray(tagsRaw) || tagsRaw.length === 0) {
              try {
                noteForTags = await upstreamFetch(
                  `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                  canisterFetchOpts
                );
              } catch {
                continue;
              }
            }
            const tagList = hostedTagsFromHitOrNote(tagsRaw, noteForTags);
            for (const slug of tagList) {
              if (!slug || existingSet.has(slug)) continue;
              tagCounts.set(slug, (tagCounts.get(slug) || 0) + 1);
            }
          }

          const suggested_tags = [...tagCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name)
            .slice(0, 12);

          return jsonResponse({ suggested_tags, existing_tags: existing });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('get_note', role)) {
    server.registerTool(
      'get_note',
      {
        description: 'Retrieve a single note by vault-relative path.',
        inputSchema: {
          path: z.string().describe('Vault-relative note path'),
        },
      },
      async (args) => {
        try {
          const data = await upstreamFetch(
            `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
            canisterFetchOpts
          );
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('list_notes', role)) {
    server.registerTool(
      'list_notes',
      {
        description: 'List notes with filters.',
        inputSchema: {
          folder: z.string().optional(),
          project: z.string().optional(),
          tag: z.string().optional(),
          since: z.string().optional(),
          until: z.string().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        },
      },
      async (args) => {
        try {
          const params = new URLSearchParams();
          if (args.folder) params.set('folder', args.folder);
          if (args.project) params.set('project', args.project);
          if (args.tag) params.set('tag', args.tag);
          if (args.since) params.set('since', args.since);
          if (args.until) params.set('until', args.until);
          if (args.limit) params.set('limit', String(args.limit));
          if (args.offset) params.set('offset', String(args.offset));
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('write', role)) {
    server.registerTool(
      'write',
      {
        description: 'Write or update a note in the vault.',
        inputSchema: {
          path: z.string().describe('Vault-relative path'),
          body: z.string().describe('Markdown body'),
          // Open-ended record(value: unknown) breaks Zod v4 JSON Schema export and makes tools/list fail (no tools in clients).
          frontmatter: z.record(z.string(), z.unknown()).optional(),
        },
      },
      async (args) => {
        try {
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes`, {
            ...canisterFetchOpts,
            method: 'POST',
            body: { path: args.path, body: args.body, frontmatter: args.frontmatter },
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted `capture` — parity with local `runCaptureInbox` / `buildCaptureInboxWritePayload` (`lib/capture-inbox.mjs`).
   * Upstream: `POST {canisterUrl}/api/v1/notes` with the same headers as `write` (JWT, `X-Vault-Id`, `X-User-Id` =
   * `canisterUserId`, `X-Gateway-Auth`). Hub `POST /api/v1/capture` is webhook-only (`X-Webhook-Secret`); hosted MCP
   * does not proxy that route for capture.
   */
  if (isToolAllowed('capture', role)) {
    server.registerTool(
      'capture',
      {
        description:
          'Fast inbox capture: creates a new note under inbox/ (or projects/{project}/inbox/) with inbox frontmatter (source, date, inbox). Same path and metadata rules as local MCP capture; no AIR. Uses the canister notes API like write.',
        inputSchema: {
          text: z.string().min(1).describe('Note body text'),
          source: z.string().optional().describe('Source label (default mcp-capture)'),
          project: z.string().optional().describe('Optional project slug for project inbox path'),
          tags: z.array(z.string()).optional().describe('Optional tags (normalized like local capture)'),
        },
      },
      async (args) => {
        try {
          const { path, body, frontmatter } = buildCaptureInboxWritePayload(args.text, {
            source: args.source,
            project: args.project,
            tags: args.tags,
          });
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes`, {
            ...canisterFetchOpts,
            method: 'POST',
            body: { path, body, frontmatter },
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted `transcribe` — same upstream as Hub / bridge **`POST /api/v1/import`** with **`source_type`** **`audio`** or **`video`**
   * (Whisper via `lib/transcribe.mjs` on the bridge). Local MCP `transcribe` reads a disk path; hosted accepts **base64**
   * bytes like the **`import`** tool. Requires bridge env (**`OPENAI_API_KEY`**, optional ffmpeg for transcode) as for self-hosted import.
   */
  if (isToolAllowed('transcribe', role)) {
    server.registerTool(
      'transcribe',
      {
        description:
          'Transcribe audio or video (OpenAI Whisper on the bridge) into the hosted vault: multipart POST /api/v1/import with source_type audio or video, same contract as Hub import. Provide base64 file bytes and filename; optional project, output_dir, tags.',
        inputSchema: {
          source_type: z.enum(['audio', 'video']).describe('Importer id: audio or video (Whisper)'),
          file_base64: z.string().min(1).describe('Media file content as standard base64 (decoded size max 100 MiB)'),
          filename: z.string().min(1).describe('Original filename with extension (e.g. meeting.m4a)'),
          project: z.string().optional().describe('Optional project slug'),
          output_dir: z.string().optional().describe('Optional vault-relative output folder'),
          tags: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .describe('Optional tags: comma-separated string or array of strings'),
        },
      },
      async (args) => {
        try {
          const data = await hostedBridgeImportFromBase64Args(args);
          return jsonResponse(data);
        } catch (e) {
          const code = /** @type {any} */ (e).code === 'INVALID' ? 'INVALID' : 'UPSTREAM_ERROR';
          return jsonError(e.message || String(e), code);
        }
      }
    );
  }

  if (isToolAllowed('index', role)) {
    server.registerTool(
      'index',
      {
        description: 'Trigger re-indexing of the hosted vault.',
      },
      async () => {
        try {
          const data = await upstreamFetch(`${bridgeUrl}/api/v1/index`, {
            ...bridgeFetchOpts,
            method: 'POST',
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('vault_sync', role)) {
    server.registerTool(
      'vault_sync',
      {
        description:
          'Back up the hosted vault to GitHub (same as Hub “Back up now”): exports notes and proposals via the bridge and pushes to the connected repo. Requires GitHub connected on the bridge; optional repo overrides owner/name.',
        inputSchema: {
          repo: z
            .string()
            .optional()
            .describe('GitHub repository as owner/name (optional if a repo is already stored after Connect GitHub)'),
        },
      },
      async (args) => {
        try {
          const body =
            args.repo != null && String(args.repo).trim() !== ''
              ? { repo: String(args.repo).trim() }
              : {};
          const data = await upstreamFetch(`${bridgeUrl}/api/v1/vault/sync`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body,
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('import', role)) {
    server.registerTool(
      'import',
      {
        description:
          'Import a file into the hosted vault via the bridge (multipart parity with Hub POST /api/v1/import). Provide base64 file bytes, filename, and source_type; optional project, output_dir, tags.',
        inputSchema: {
          source_type: z
            .enum(IMPORT_SOURCE_ENUM)
            .describe(`Importer id (same as Hub import). Allowed: ${IMPORT_SOURCE_TYPES.join(', ')}`),
          file_base64: z.string().min(1).describe('File content as standard base64 (decoded size max 100 MiB)'),
          filename: z.string().min(1).describe('Original filename (e.g. export.zip, notes.md)'),
          project: z.string().optional().describe('Optional project slug'),
          output_dir: z.string().optional().describe('Optional vault-relative output folder'),
          tags: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .describe('Optional tags: comma-separated string or array of strings'),
        },
      },
      async (args) => {
        try {
          const data = await hostedBridgeImportFromBase64Args(args);
          return jsonResponse(data);
        } catch (e) {
          const code = /** @type {any} */ (e).code === 'INVALID' ? 'INVALID' : 'UPSTREAM_ERROR';
          return jsonError(e.message || String(e), code);
        }
      }
    );
  }

  if (isToolAllowed('export', role)) {
    server.registerTool(
      'export',
      {
        description:
          'Admin-only: vault notes JSON from the hub canister (GET /api/v1/export). Returns { notes: [...] } when the response is under an MCP-only byte cap; if EXPORT_TOO_LARGE, use the Hub or vault_sync for a full export without this MCP limit.',
      },
      async () => {
        try {
          const data = await canisterGetJsonWithByteLimit(
            `${canisterUrl}/api/v1/export`,
            canisterFetchOpts,
            HOSTED_MCP_EXPORT_MAX_RESPONSE_BYTES
          );
          return jsonResponse(data);
        } catch (e) {
          const code = /** @type {any} */ (e).code === 'EXPORT_TOO_LARGE' ? 'EXPORT_TOO_LARGE' : 'UPSTREAM_ERROR';
          return jsonError(e.message || String(e), code);
        }
      }
    );
  }

  if (isToolAllowed('summarize', role)) {
    server.registerTool(
      'summarize',
      {
        description: 'Summarize notes via the client LLM (sampling) or server fallback.',
        inputSchema: {
          path: z.string().optional(),
          paths: z.array(z.string()).optional(),
          style: z.enum(['brief', 'detailed', 'bullets']).optional(),
        },
      },
      async (args) => {
        try {
          const paths = [];
          if (args.path) paths.push(args.path);
          if (args.paths) paths.push(...args.paths);
          if (!paths.length) return jsonError('Provide path or paths', 'INVALID');

          const bodies = [];
          for (const p of paths.slice(0, 10)) {
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              bodies.push(`## ${p}\n${note.body || ''}`);
            } catch (_) {}
          }

          const combined = bodies.join('\n\n').slice(0, 48000);
          const style = args.style || 'brief';
          const maxWords = style === 'detailed' ? 400 : style === 'bullets' ? 300 : 150;
          const system = `You summarize vault notes faithfully. Output style: ${style}. Max approximately ${maxWords} words.`;

          const { trySampling } = await import('../../mcp/sampling.mjs');
          let summary = await trySampling(server, { system, user: combined, maxTokens: Math.min(1024, maxWords * 2) });
          if (!summary) {
            summary = `(Sampling unavailable — summarize tool requires a client that supports MCP sampling for hosted mode.)`;
          }
          return jsonResponse({ summary, source_paths: paths });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * Hosted MCP prompts (Track B1–B2): same bridge/canister HTTP paths as tools; no local vault reads.
   * Each prompt registers only when {@link isPromptAllowed} and the upstream tools it needs are allowed.
   */
  if (isPromptAllowed('daily-brief', role) && isToolAllowed('list_notes', role)) {
    server.registerPrompt(
      'daily-brief',
      {
        title: 'Daily brief',
        description: 'Notes since a date (default today UTC) with snippets; assistant prefill for summarizing.',
        argsSchema: {
          date: z.string().optional().describe('YYYY-MM-DD; default today (UTC)'),
          project: z.string().optional().describe('Project slug'),
        },
      },
      async (args) => {
        const since = (args.date && String(args.date).trim()) || new Date().toISOString().slice(0, 10);
        const params = new URLSearchParams();
        params.set('since', since);
        if (args.project != null && String(args.project).trim() !== '') {
          params.set('project', normalizeSlug(String(args.project)));
        }
        params.set('limit', '80');
        params.set('offset', '0');
        try {
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(data.notes) ? data.notes : [];
          const lines = notes.length
            ? notes.map((n, i) => {
                const row = /** @type {{ path?: string, frontmatter?: unknown, body?: unknown }} */ (n);
                const title = displayTitleFromHostedNote(row) ?? row.path;
                const fm = materializeListFrontmatter(row.frontmatter);
                const d = dateKeyFromHostedFrontmatter(fm) || '';
                const body = row.body != null ? String(row.body) : '';
                return `${i + 1}. **${title}** (${row.path}, ${d})\n   ${snippet(body, 240)}`;
              })
            : ['(No notes in range.)'];
          return {
            description: `Daily brief for notes since ${since}`,
            messages: [
              {
                role: 'user',
                content: textContent(
                  'You are a personal knowledge assistant. Below are notes captured in the selected range. Summarize themes, decisions, and open threads.'
                ),
              },
              { role: 'user', content: textContent(lines.join('\n\n')) },
              { role: 'assistant', content: textContent('Here is your daily brief:') },
            ],
          };
        } catch (e) {
          return {
            description: 'Daily brief',
            messages: [{ role: 'user', content: textContent(`Error loading notes: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (
    isPromptAllowed('search-and-synthesize', role) &&
    isToolAllowed('search', role) &&
    isToolAllowed('get_note', role)
  ) {
    server.registerPrompt(
      'search-and-synthesize',
      {
        title: 'Search and synthesize',
        description: 'Semantic search then embed top notes for synthesis.',
        argsSchema: {
          query: z.string().describe('Search query'),
          project: z.string().optional().describe('Project slug'),
          limit: z.string().optional().describe('Max notes (default 10)'),
        },
      },
      async (args) => {
        const limit = Math.min(20, Math.max(1, parseIntSafe(args.limit, 10)));
        const searchBody = { query: String(args.query || ''), mode: 'semantic', limit, fields: 'path' };
        if (args.project != null && String(args.project).trim() !== '') {
          searchBody.project = normalizeSlug(String(args.project));
        }
        try {
          const searchOut = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: searchBody,
          });
          const paths = (Array.isArray(searchOut.results) ? searchOut.results : [])
            .map((r) => r.path)
            .filter(Boolean)
            .slice(0, MAX_EMBEDDED_NOTES);
          const messages = [
            {
              role: 'user',
              content: textContent(
                `You have ${paths.length} top-matching vault notes below (semantic search for: "${String(args.query)}"). Synthesize key themes, agreements, and gaps. Cite paths when specific.`
              ),
            },
          ];
          for (const p of paths) {
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              const uri = `knowtation://hosted/note/${String(p).replace(/^\/+/, '')}`;
              messages.push({
                role: 'user',
                content: {
                  type: 'resource',
                  resource: {
                    uri,
                    mimeType: 'text/markdown',
                    text: noteToMarkdown({
                      path: note.path ?? p,
                      frontmatter: note.frontmatter || {},
                      body: note.body != null ? String(note.body) : '',
                    }),
                  },
                },
              });
            } catch (_) {}
          }
          return await maybeAppendSamplingPrefill(server, {
            description: 'Search results embedded as resources',
            messages,
          });
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (
    isPromptAllowed('project-summary', role) &&
    isToolAllowed('list_notes', role) &&
    isToolAllowed('get_note', role)
  ) {
    server.registerPrompt(
      'project-summary',
      {
        title: 'Project summary',
        description: 'Recent project notes embedded for executive-style summary.',
        argsSchema: {
          project: z.string().describe('Project slug'),
          since: z.string().optional().describe('YYYY-MM-DD'),
          format: z.enum(['brief', 'detailed', 'stakeholder']).optional().describe('Summary style'),
        },
      },
      async (args) => {
        const project = normalizeSlug(String(args.project || ''));
        if (!project) {
          return {
            messages: [{ role: 'user', content: textContent('Error: project argument is required.') }],
          };
        }
        const fmt = args.format || 'brief';
        const params = new URLSearchParams();
        params.set('project', project);
        if (args.since != null && String(args.since).trim() !== '') params.set('since', String(args.since).trim());
        params.set('limit', String(PROJECT_SUMMARY_NOTES));
        params.set('offset', '0');
        try {
          const out = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(out.notes) ? out.notes : [];
          const total = typeof out.total === 'number' ? out.total : notes.length;
          const messages = [
            {
              role: 'user',
              content: textContent(
                `Produce a ${fmt} executive summary for project "${project}" using the embedded notes. Note count (sample): ${notes.length} of ${total} total matching filters.`
              ),
            },
          ];
          for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
            const p = n.path;
            if (!p) continue;
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              const uri = `knowtation://hosted/note/${String(p).replace(/^\/+/, '')}`;
              messages.push({
                role: 'user',
                content: {
                  type: 'resource',
                  resource: {
                    uri,
                    mimeType: 'text/markdown',
                    text: noteToMarkdown({
                      path: note.path ?? p,
                      frontmatter: note.frontmatter || {},
                      body: note.body != null ? String(note.body) : '',
                    }),
                  },
                },
              });
            } catch (_) {}
          }
          return await maybeAppendSamplingPrefill(server, {
            description: `Project summary (${project})`,
            messages,
          });
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (isPromptAllowed('temporal-summary', role) && isToolAllowed('list_notes', role)) {
    server.registerPrompt(
      'temporal-summary',
      {
        title: 'Temporal summary',
        description: 'Notes between two dates; optional semantic topic filter.',
        argsSchema: {
          since: z.string().describe('YYYY-MM-DD start'),
          until: z.string().describe('YYYY-MM-DD end'),
          topic: z.string().optional().describe('Optional semantic filter; runs search then intersects dates'),
          project: z.string().optional().describe('Project slug'),
        },
      },
      async (args) => {
        const since = String(args.since || '').slice(0, 10);
        const until = String(args.until || '').slice(0, 10);
        /** @type {Set<string> | null} */
        let pathSet = null;
        if (args.topic && String(args.topic).trim()) {
          if (!isToolAllowed('search', role)) {
            return {
              description: 'Temporal summary',
              messages: [
                {
                  role: 'user',
                  content: textContent(
                    'A topic filter was requested but this session does not allow the search tool; omit topic or use list_notes manually.'
                  ),
                },
              ],
            };
          }
          try {
            const so = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
              ...bridgeFetchOpts,
              method: 'POST',
              body: {
                query: String(args.topic),
                mode: 'semantic',
                limit: 80,
                fields: 'path',
                ...(args.project != null && String(args.project).trim() !== ''
                  ? { project: normalizeSlug(String(args.project)) }
                  : {}),
              },
            });
            pathSet = new Set((Array.isArray(so.results) ? so.results : []).map((r) => r.path).filter(Boolean));
          } catch (e) {
            return {
              description: 'Temporal summary',
              messages: [{ role: 'user', content: textContent(`Topic search failed: ${e.message || String(e)}`) }],
            };
          }
        }
        const params = new URLSearchParams();
        params.set('since', since);
        params.set('until', until);
        if (args.project != null && String(args.project).trim() !== '') {
          params.set('project', normalizeSlug(String(args.project)));
        }
        params.set('limit', '100');
        params.set('offset', '0');
        try {
          const out = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          let notes = Array.isArray(out.notes) ? out.notes : [];
          if (pathSet) {
            notes = notes.filter((n) => n.path && pathSet.has(n.path));
          }
          notes = [...notes].sort((a, b) => {
            const da = dateKeyFromHostedFrontmatter(materializeListFrontmatter(a.frontmatter));
            const db = dateKeyFromHostedFrontmatter(materializeListFrontmatter(b.frontmatter));
            return da.localeCompare(db);
          });
          const lines = notes.map((n, i) => {
            const row = /** @type {{ path?: string, frontmatter?: unknown }} */ (n);
            const fm = materializeListFrontmatter(row.frontmatter);
            const t = displayTitleFromHostedNote(/** @type {any} */ (row)) ?? row.path;
            const d = dateKeyFromHostedFrontmatter(fm) || '';
            const tg = tagsFromFm(fm);
            return `${i + 1}. ${t} (${row.path}, ${d})${tg.length ? ` tags: ${tg.join(',')}` : ''}`;
          });
          return {
            description: `Temporal view ${since} … ${until}`,
            messages: [
              {
                role: 'user',
                content: textContent(
                  `What happened between ${since} and ${until}? What decisions were made? What changed? Use the note list below${args.topic ? ' (filtered by topic search)' : ''}.\n\n${lines.join('\n') || '(No notes in range.)'}`
                ),
              },
            ],
          };
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (
    isPromptAllowed('content-plan', role) &&
    isToolAllowed('list_notes', role) &&
    isToolAllowed('get_note', role)
  ) {
    server.registerPrompt(
      'content-plan',
      {
        title: 'Content plan',
        description: 'Content calendar / plan from recent project notes.',
        argsSchema: {
          project: z.string().describe('Project slug'),
          format: z.enum(['blog', 'podcast', 'newsletter', 'thread']).optional(),
          tone: z.string().optional(),
        },
      },
      async (args) => {
        const project = normalizeSlug(String(args.project || ''));
        if (!project) {
          return {
            messages: [{ role: 'user', content: textContent('Error: project argument is required.') }],
          };
        }
        const fmt = args.format || 'blog';
        const tone = args.tone || 'clear, authoritative';
        const params = new URLSearchParams();
        params.set('project', project);
        params.set('limit', String(CONTENT_PLAN_NOTES));
        params.set('offset', '0');
        try {
          const out = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(out.notes) ? out.notes : [];
          const messages = [
            {
              role: 'user',
              content: textContent(
                `Create a ${fmt} content plan for project "${project}". Tone: ${tone}. Topics, order, angles, and what to write next. Ground in the embedded notes.`
              ),
            },
          ];
          for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
            const p = n.path;
            if (!p) continue;
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              const uri = `knowtation://hosted/note/${String(p).replace(/^\/+/, '')}`;
              messages.push({
                role: 'user',
                content: {
                  type: 'resource',
                  resource: {
                    uri,
                    mimeType: 'text/markdown',
                    text: noteToMarkdown({
                      path: note.path ?? p,
                      frontmatter: note.frontmatter || {},
                      body: note.body != null ? String(note.body) : '',
                    }),
                  },
                },
              });
            } catch (_) {}
          }
          return await maybeAppendSamplingPrefill(server, {
            description: `Content plan (${project})`,
            messages,
          });
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  /**
   * Hosted MCP prompts (Track B2): meeting-notes, knowledge-gap, causal-chain, extract-entities, write-from-capture.
   * Same upstreams as tools; no local vault or capture template files (write-from-capture is text-only instructions).
   */
  if (isPromptAllowed('meeting-notes', role)) {
    server.registerPrompt(
      'meeting-notes',
      {
        title: 'Meeting notes',
        description: 'Transcript → structured meeting note instructions.',
        argsSchema: {
          transcript: z.string().describe('Raw transcript'),
          attendees: z.string().optional().describe('Comma-separated names'),
          project: z.string().optional(),
          date: z.string().optional().describe('YYYY-MM-DD'),
        },
      },
      async (args) => {
        const attendees = String(args.attendees || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const project = args.project != null && String(args.project).trim() !== '' ? normalizeSlug(String(args.project)) : null;
        const date = (args.date && String(args.date).trim().slice(0, 10)) || new Date().toISOString().slice(0, 10);
        const t = String(args.transcript || '').slice(0, 100_000);
        const suggestedPath = project
          ? `projects/${project}/inbox/meeting-${date}.md`
          : `inbox/meeting-${date}.md`;
        return {
          description: 'Meeting note draft prompt',
          messages: [
            {
              role: 'user',
              content: textContent(
                `Convert the transcript into a vault meeting note with YAML frontmatter: title, date: ${date}, attendees: [${attendees.map((a) => `"${a}"`).join(', ')}]${project ? `, project: "${project}"` : ''}, tags. Body: agenda summary, decisions, action items (owners), follow-ups. Suggested path for the write tool: ${suggestedPath}`
              ),
            },
            { role: 'user', content: textContent(`--- Transcript ---\n${t}`) },
          ],
        };
      }
    );
  }

  if (isPromptAllowed('knowledge-gap', role) && isToolAllowed('search', role)) {
    server.registerPrompt(
      'knowledge-gap',
      {
        title: 'Knowledge gap',
        description: 'Given search hits, ask what is missing and what to capture next.',
        argsSchema: {
          query: z.string().describe('Topic / question'),
          project: z.string().optional(),
        },
      },
      async (args) => {
        const searchBody = {
          query: String(args.query || ''),
          mode: 'semantic',
          limit: 15,
          fields: 'path+snippet',
          snippetChars: 200,
        };
        if (args.project != null && String(args.project).trim() !== '') {
          searchBody.project = normalizeSlug(String(args.project));
        }
        try {
          const so = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: searchBody,
          });
          const lines = (Array.isArray(so.results) ? so.results : []).map((r, i) => {
            const row = /** @type {{ path?: string, snippet?: unknown }} */ (r);
            const sn = row.snippet != null ? snippet(String(row.snippet), 200) : '';
            return `${i + 1}. ${row.path}${sn ? `\n   ${sn}` : ''}`;
          });
          return await maybeAppendSamplingPrefill(server, {
            description: 'Knowledge gap analysis',
            messages: [
              {
                role: 'user',
                content: textContent(
                  `Given these vault search results for "${String(args.query)}", what is missing? What questions remain unanswered? What should I capture next?\n\n${lines.join('\n\n') || '(No results.)'}`
                ),
              },
            ],
          });
        } catch (e) {
          return {
            description: 'Knowledge gap',
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (
    isPromptAllowed('causal-chain', role) &&
    isToolAllowed('search', role) &&
    isToolAllowed('get_note', role)
  ) {
    server.registerPrompt(
      'causal-chain',
      {
        title: 'Causal chain',
        description:
          'Notes in a causal_chain_id: bridge semantic search with chain filter, then full notes from the canister (sorted by date). Differs from local graph order when the index omits notes or hits the search limit.',
        argsSchema: {
          chain_id: z.string().describe('Causal chain id / slug'),
          include_summaries: z.string().optional().describe('true to emphasize summarizes edges'),
        },
      },
      async (args) => {
        const chainSlug = normalizeSlug(String(args.chain_id || ''));
        if (!chainSlug) {
          return {
            messages: [{ role: 'user', content: textContent('Error: chain_id is required.') }],
          };
        }
        const inc = String(args.include_summaries || '').toLowerCase() === 'true';
        try {
          const searchOut = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: {
              query: chainSlug,
              mode: 'semantic',
              limit: 80,
              fields: 'path',
              chain: chainSlug,
            },
          });
          const seen = new Set();
          const orderedPaths = [];
          for (const r of Array.isArray(searchOut.results) ? searchOut.results : []) {
            const p = r.path != null ? vaultPathKey(String(r.path)) : '';
            if (!p || seen.has(p)) continue;
            seen.add(p);
            orderedPaths.push(p);
          }
          /** @type {{ path: string, note: Record<string, unknown> }[]} */
          const loaded = [];
          for (const p of orderedPaths) {
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              loaded.push({ path: p, note: /** @type {Record<string, unknown>} */ (note) });
            } catch (_) {}
          }
          loaded.sort((a, b) => {
            const fa = materializeListFrontmatter(a.note.frontmatter);
            const fb = materializeListFrontmatter(b.note.frontmatter);
            const da = dateKeyFromHostedFrontmatter(fa) || '';
            const db = dateKeyFromHostedFrontmatter(fb) || '';
            const c = da.localeCompare(db);
            if (c !== 0) return c;
            return vaultPathKey(a.path).localeCompare(vaultPathKey(b.path));
          });
          const messages = [
            {
              role: 'user',
              content: textContent(
                `Narrate the causal sequence for chain "${chainSlug}". Use follows / summarizes in frontmatter where present.${inc ? ' Pay special attention to summarization relationships.' : ''} Notes are ordered by date then path (hosted: bridge search with chain filter + canister reads; not identical to local filesystem graph ordering).`
              ),
            },
          ];
          for (const { path: p, note } of loaded.slice(0, MAX_EMBEDDED_NOTES)) {
            const uri = `knowtation://hosted/note/${String(p).replace(/^\/+/, '')}`;
            messages.push({
              role: 'user',
              content: {
                type: 'resource',
                resource: {
                  uri,
                  mimeType: 'text/markdown',
                  text: noteToMarkdown({
                    path: note.path ?? p,
                    frontmatter: note.frontmatter || {},
                    body: note.body != null ? String(note.body) : '',
                  }),
                },
              },
            });
          }
          if (loaded.length === 0) {
            messages.push({
              role: 'user',
              content: textContent(
                '(No notes found for this causal_chain_id in the hosted index, or search returned no paths. Confirm frontmatter causal_chain_id matches and the vault is indexed.)'
              ),
            });
          }
          return { description: `Causal chain ${chainSlug}`, messages };
        } catch (e) {
          return {
            description: 'Causal chain',
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (
    isPromptAllowed('extract-entities', role) &&
    isToolAllowed('list_notes', role) &&
    isToolAllowed('get_note', role)
  ) {
    server.registerPrompt(
      'extract-entities',
      {
        title: 'Extract entities',
        description: 'Structured JSON extraction prompt over vault notes in scope.',
        argsSchema: {
          folder: z.string().optional(),
          project: z.string().optional(),
          entity_types: z.enum(['people', 'places', 'decisions', 'goals', 'all']).optional(),
        },
      },
      async (args) => {
        const types = args.entity_types || 'all';
        const params = new URLSearchParams();
        if (args.folder != null && String(args.folder).trim() !== '') params.set('folder', String(args.folder).trim());
        if (args.project != null && String(args.project).trim() !== '') {
          params.set('project', normalizeSlug(String(args.project)));
        }
        params.set('limit', String(MAX_ENTITY_NOTES));
        params.set('offset', '0');
        try {
          const out = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(out.notes) ? out.notes : [];
          const messages = [
            {
              role: 'user',
              content: textContent(
                `Extract entities from the embedded notes. Output a single JSON object: { "people": [], "places": [], "decisions": [], "goals": [] } with short strings. Entity focus: ${types}. If a category is empty, use [].`
              ),
            },
          ];
          for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
            const p = n.path;
            if (!p) continue;
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              const uri = `knowtation://hosted/note/${String(p).replace(/^\/+/, '')}`;
              messages.push({
                role: 'user',
                content: {
                  type: 'resource',
                  resource: {
                    uri,
                    mimeType: 'text/markdown',
                    text: noteToMarkdown({
                      path: note.path ?? p,
                      frontmatter: note.frontmatter || {},
                      body: note.body != null ? String(note.body) : '',
                    }),
                  },
                },
              });
            } catch (_) {}
          }
          return { description: 'Entity extraction', messages };
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (isPromptAllowed('write-from-capture', role)) {
    server.registerPrompt(
      'write-from-capture',
      {
        title: 'Write from capture',
        description:
          'Format raw capture text into a proper vault note (YAML frontmatter). Hosted: no local capture.md template; use capture or write tool after drafting.',
        argsSchema: {
          raw_text: z.string().describe('Raw pasted text'),
          source: z.string().describe('e.g. telegram, whatsapp, email'),
          project: z.string().optional().describe('Project slug'),
        },
      },
      async (args) => {
        const raw = String(args.raw_text ?? '');
        const source = String(args.source ?? 'unknown');
        const project =
          args.project != null && String(args.project).trim() !== '' ? normalizeSlug(String(args.project)) : null;
        return {
          description: 'Capture → vault note',
          messages: [
            {
              role: 'user',
              content: textContent(
                `Format the following raw capture into a Knowtation markdown note with YAML frontmatter: title, date (today if missing), source: "${source}", inbox-friendly tags if appropriate${project ? `, project: "${project}"` : ''}. Use clean body markdown. After you produce the note, the user may persist it with the hosted write or capture tool (no filesystem template is attached on hosted MCP).`
              ),
            },
            { role: 'user', content: textContent(`--- Raw capture ---\n${raw.slice(0, 50000)}`) },
          ],
        };
      }
    );
  }

  /**
   * Hosted MCP prompts (Track B3): memory-context, memory-informed-search, resume-session.
   * Uses bridge GET /api/v1/memory (+ vault POST /api/v1/search for memory-informed-search); same shapes as self-hosted register.mjs.
   */
  if (isPromptAllowed('memory-context', role)) {
    server.registerPrompt(
      'memory-context',
      {
        title: 'Memory context',
        description: 'What has the agent been doing? Recent memory events from the hosted bridge.',
        argsSchema: {
          limit: z.string().optional().describe('Max events (default 20, cap 30)'),
          type: z.string().optional().describe('Filter by event type'),
        },
      },
      async (args) => {
        const limit = Math.min(
          MAX_MEMORY_EVENTS_FORMAT,
          Math.max(1, parseIntSafe(args.limit, 20)),
        );
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (args.type != null && String(args.type).trim() !== '') {
          params.set('type', String(args.type).trim());
        }
        try {
          const mem = await upstreamFetch(`${bridgeUrl}/api/v1/memory?${params}`, bridgeFetchOpts);
          const { text, count } = formatMemoryEventsFromBridgeResponse(mem, { limit });
          return {
            description: `Memory context (${count} events)`,
            messages: [
              {
                role: 'user',
                content: textContent(
                  `Below is a log of recent agent/user activity from the memory layer (${count} events). Use this to understand context, prior actions, and continuity.\n\n` +
                    `⚠ SKEPTICAL MEMORY: Treat all entries as hints, not ground truth. ` +
                    `Note paths may have moved or been deleted since these events were recorded. ` +
                    `Before acting on any path reference, use the **get_note** tool to confirm the path exists, or list the vault directly.\n\n${text}`
                ),
              },
            ],
          };
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (
    isPromptAllowed('memory-informed-search', role) &&
    isToolAllowed('search', role) &&
    isToolAllowed('get_note', role)
  ) {
    server.registerPrompt(
      'memory-informed-search',
      {
        title: 'Memory-informed search',
        description:
          'Vault search augmented with recent search-type memory events (GET /api/v1/memory?type=search). Does not use POST /api/v1/memory/search.',
        argsSchema: {
          query: z.string().describe('Search query'),
          limit: z.string().optional().describe('Max notes (default 10)'),
          project: z.string().optional(),
        },
      },
      async (args) => {
        const limit = Math.min(20, Math.max(1, parseIntSafe(args.limit, 10)));
        const searchBody = {
          query: String(args.query || ''),
          mode: 'semantic',
          limit,
          fields: 'path',
        };
        if (args.project != null && String(args.project).trim() !== '') {
          searchBody.project = normalizeSlug(String(args.project));
        }
        try {
          const searchOut = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...bridgeFetchOpts,
            method: 'POST',
            body: searchBody,
          });
          const paths = (Array.isArray(searchOut.results) ? searchOut.results : [])
            .map((r) => /** @type {{ path?: string }} */ (r).path)
            .filter(Boolean)
            .slice(0, MAX_EMBEDDED_NOTES);
          const memParams = new URLSearchParams();
          memParams.set('type', 'search');
          memParams.set('limit', '10');
          const memJson = await upstreamFetch(`${bridgeUrl}/api/v1/memory?${memParams}`, bridgeFetchOpts);
          const { text: memText, count: memCount } = formatMemoryEventsFromBridgeResponse(memJson, { limit: 10 });
          const messages = [
            {
              role: 'user',
              content: textContent(
                `Search query: "${String(args.query)}"\n\n**Previous searches from memory** (${memCount} recent):\n${memText}\n\n**Current search results** (${paths.length} notes embedded below). Compare with past searches — highlight what is new or changed, and synthesize findings.\n\n` +
                  `⚠ SKEPTICAL MEMORY: Treat memory lines as hints; confirm paths with **get_note** before acting.`
              ),
            },
          ];
          for (const p of paths) {
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                canisterFetchOpts
              );
              const uri = `knowtation://hosted/note/${String(p).replace(/^\/+/, '')}`;
              messages.push({
                role: 'user',
                content: {
                  type: 'resource',
                  resource: {
                    uri,
                    mimeType: 'text/markdown',
                    text: noteToMarkdown({
                      path: note.path ?? p,
                      frontmatter: note.frontmatter || {},
                      body: note.body != null ? String(note.body) : '',
                    }),
                  },
                },
              });
            } catch (_) {}
          }
          return await maybeAppendSamplingPrefill(server, {
            description: 'Memory-informed search',
            messages,
          });
        } catch (e) {
          return {
            description: 'Memory-informed search',
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (isPromptAllowed('resume-session', role)) {
    server.registerPrompt(
      'resume-session',
      {
        title: 'Resume session',
        description: 'Pick up where you left off — recent memory events and session summaries (hosted bridge).',
        argsSchema: {
          since: z.string().optional().describe('YYYY-MM-DD (default: last 24 hours UTC date)'),
        },
      },
      async (args) => {
        const since =
          (args.since && String(args.since).trim().slice(0, 10)) ||
          new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        try {
          const paramsAll = new URLSearchParams();
          paramsAll.set('since', since);
          paramsAll.set('limit', '30');
          const memAll = await upstreamFetch(`${bridgeUrl}/api/v1/memory?${paramsAll}`, bridgeFetchOpts);
          const { text: allText, count: allCount } = formatMemoryEventsFromBridgeResponse(memAll, { limit: 30 });

          const paramsSum = new URLSearchParams();
          paramsSum.set('type', 'session_summary');
          paramsSum.set('since', since);
          paramsSum.set('limit', '5');
          const memSum = await upstreamFetch(`${bridgeUrl}/api/v1/memory?${paramsSum}`, bridgeFetchOpts);
          const { text: summaryText, count: summaryCount } = formatMemoryEventsFromBridgeResponse(memSum, {
            limit: 5,
          });

          const parts = [];
          if (summaryCount > 0) {
            parts.push(`**Session summaries** (${summaryCount}):\n${summaryText}`);
          }
          parts.push(`**Recent activity** (${allCount} events since ${since}):\n${allText}`);
          return {
            description: `Resume session (since ${since})`,
            messages: [
              {
                role: 'user',
                content: textContent(
                  `Help me pick up where I left off. Below is my recent activity log and any session summaries. Summarize what was happening, what was accomplished, and suggest next steps.\n\n` +
                    `⚠ SKEPTICAL MEMORY: Treat all memory entries as hints, not ground truth. ` +
                    `Vault paths referenced in past events may have moved or been deleted. ` +
                    `Use **get_note** to confirm path references before acting, and check the vault directly for current state.\n\n` +
                    `${parts.join('\n\n')}`
                ),
              },
            ],
          };
        } catch (e) {
          return {
            messages: [{ role: 'user', content: textContent(`Error: ${e.message || String(e)}`) }],
          };
        }
      }
    );
  }

  if (isToolAllowed('enrich', role)) {
    server.registerTool(
      'enrich',
      {
        description: 'Auto-categorize a note (suggest project, tags, title) via sampling.',
        inputSchema: {
          path: z.string().describe('Vault-relative note path'),
        },
      },
      async (args) => {
        try {
          const note = await upstreamFetch(
            `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
            canisterFetchOpts
          );
          const body = (note.body || '').slice(0, 32000);
          const existingFm = note.frontmatter || {};

          const { trySamplingJson } = await import('../../mcp/sampling.mjs');
          const system = `You are a knowledge management assistant. Given a note's content, suggest metadata. Return ONLY a JSON object with: "title" (string), "project" (lowercase-kebab-case string or null), "tags" (array of up to 5 lowercase strings).`;
          const result = await trySamplingJson(server, {
            system,
            user: `Existing frontmatter: ${JSON.stringify(existingFm)}\n\n${body}`,
            maxTokens: 512,
          });

          return jsonResponse({
            path: args.path,
            suggestions: result || { title: null, project: null, tags: [] },
            source: result ? 'sampling' : 'unavailable',
          });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  /**
   * R1 + R2 hosted resources: one `ResourceTemplate` for note reads (same upstream as `get_note`)
   * and folder JSON listings (same upstream as `list_notes` with `folder`).
   *
   * When `list_notes` is allowed, a `list` callback is set so the MCP SDK merges concrete URIs into
   * `resources/list` (see `@modelcontextprotocol/sdk` McpServer `setResourceRequestHandlers`). Cursor’s
   * “N resources” UI counts that list; templates without `list` only appear under `resourceTemplates/list`.
   */
  if (isToolAllowed('get_note', role)) {
    /**
     * R3 embedded image fetch (shared). Some MCP clients match `knowtation://hosted/vault/{+path}` with a greedy
     * `{+path}` so `…/note.md/image/0` is **not** routed to the narrower image template — `path` then does not end
     * in `.md` and was mis-handled as a folder listing. We also handle that shape in `hosted-vault-note` below.
     */
    async function hostedReadVaultEmbeddedImage(uri, notePath, idx) {
      if (notePath.includes('..') || !notePath.endsWith('.md')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid note path');
      }
      if (isNaN(idx) || idx < 0) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid image index');
      }
      try {
        const data = await upstreamFetch(
          `${canisterUrl}/api/v1/notes/${encodeURIComponent(notePath)}`,
          canisterFetchOpts
        );
        const body = data.body != null ? String(data.body) : '';
        const images = extractImageUrls(body);
        if (idx >= images.length) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Image index ${idx} out of range (note has ${images.length} embedded images)`,
          );
        }
        const img = images[idx];
        const result = await fetchImageAsBase64(img.url, {
          maxBytes: 5 * 1024 * 1024,
          timeoutMs: 10000,
        });
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: result.mimeType,
              blob: result.blob,
            },
          ],
        };
      } catch (e) {
        if (e instanceof McpError) throw e;
        throw new McpError(ErrorCode.InternalError, e.message || String(e));
      }
    }

    /**
     * R3: embedded images — use **`vault-image`** (not `vault/.../image/…`) so the URI does not share a prefix with
     * `knowtation://hosted/vault/{+path}`; some MCP clients fail template match or treat reads as “not found” when
     * the same scheme/host overlaps the generic vault template. Legacy `…/vault/…/note.md/image/n` is still read
     * via the `hosted-vault-note` handler (regex branch).
     * Video URLs stay in markdown only (no binary video resource; hosted MVP product choice).
     */
    const hostedNoteImageTemplate = new ResourceTemplate('knowtation://hosted/vault-image/{+notePath}/{index}', {
      list:
        isToolAllowed('list_notes', role) ?
          async () => {
            const resources = [];
            let offset = 0;
            let notesScanned = 0;
            while (
              resources.length < HOSTED_IMAGE_RESOURCE_LIST_MAX &&
              notesScanned < HOSTED_IMAGE_LIST_MAX_NOTES_SCANNED
            ) {
              const params = new URLSearchParams();
              params.set('limit', String(HOSTED_IMAGE_LIST_NOTES_PAGE_SIZE));
              params.set('offset', String(offset));
              const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
              const notes = Array.isArray(data?.notes) ? data.notes : [];
              if (notes.length === 0) break;
              for (const n of notes) {
                if (notesScanned >= HOSTED_IMAGE_LIST_MAX_NOTES_SCANNED) break;
                notesScanned += 1;
                const p = n?.path != null ? String(n.path) : '';
                if (!p || !p.endsWith('.md')) continue;
                let body = n.body != null ? String(n.body) : '';
                if (!body.trim()) {
                  try {
                    const full = await upstreamFetch(
                      `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                      canisterFetchOpts
                    );
                    body = full.body != null ? String(full.body) : '';
                  } catch (_) {
                    continue;
                  }
                }
                const images = extractImageUrls(body);
                for (let i = 0; i < images.length; i++) {
                  if (resources.length >= HOSTED_IMAGE_RESOURCE_LIST_MAX) break;
                  const img = images[i];
                  const name = img.alt || img.url.split('/').pop().split('?')[0] || `image-${i}`;
                  resources.push({
                    uri: `knowtation://hosted/vault-image/${p}/${i}`,
                    name,
                    mimeType: img.mimeType,
                    description: `Image in ${p}`,
                  });
                }
                if (resources.length >= HOSTED_IMAGE_RESOURCE_LIST_MAX) break;
              }
              offset += notes.length;
              if (notes.length < HOSTED_IMAGE_LIST_NOTES_PAGE_SIZE) break;
            }
            return { resources };
          }
        : async () => ({ resources: [] }),
    });
    server.registerResource(
      'hosted-vault-note-image',
      hostedNoteImageTemplate,
      {
        title: 'Hosted note embedded image',
        description:
          'Image URL in note markdown (![](url)), fetched with SSRF-safe HTTPS-only rules (mcp/resources/image-fetch.mjs).',
      },
      async (uri, variables) => {
        let notePath = variables.notePath;
        if (Array.isArray(notePath)) notePath = notePath[0];
        notePath = decodeURIComponent(String(notePath || '').replace(/\\/g, '/'));
        let idx = variables.index;
        if (Array.isArray(idx)) idx = idx[0];
        idx = parseInt(String(idx), 10);
        return hostedReadVaultEmbeddedImage(uri, notePath, idx);
      }
    );

    const templateCallbacks =
      isToolAllowed('list_notes', role) ?
        {
          list: async () => {
            const params = new URLSearchParams();
            params.set('limit', String(HOSTED_VAULT_RESOURCE_LIST_MAX));
            params.set('offset', '0');
            const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
            const notes = Array.isArray(data?.notes) ? data.notes : [];
            const resources = [];
            for (const n of notes) {
              const p = n?.path != null ? String(n.path) : '';
              if (!p || !p.endsWith('.md')) continue;
              const uri = `knowtation://hosted/vault/${p}`;
              const fm = materializeListFrontmatter(n.frontmatter);
              const bodyStr = n.body != null ? String(n.body) : '';
              const title = displayTitleFromHostedNote({ path: p, frontmatter: fm, body: bodyStr }) || p.split('/').pop() || p;
              const description = bodyStr.slice(0, 160).replace(/\s+/g, ' ').trim();
              resources.push({
                uri,
                name: title,
                mimeType: 'text/markdown',
                description: description || undefined,
              });
            }
            return { resources };
          },
        }
      : {};
    const hostedVaultNoteTemplate = new ResourceTemplate('knowtation://hosted/vault/{+path}', templateCallbacks);
    server.registerResource(
      'hosted-vault-note',
      hostedVaultNoteTemplate,
      {
        title: 'Hosted vault note or folder',
        description:
          'Markdown note if path ends with .md (same canister GET as get_note); otherwise JSON folder listing (GET /api/v1/notes?folder=…, same as list_notes).',
      },
      async (uri, variables) => {
        let rel = variables.path;
        if (Array.isArray(rel)) rel = rel[0];
        rel = decodeURIComponent(String(rel || '').replace(/\\/g, '/')).trim();
        if (rel.includes('..')) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid path');
        }
        const embeddedImg = rel.match(/^(.+\.md)\/image\/(\d+)$/);
        if (embeddedImg) {
          const notePath = embeddedImg[1];
          const imageIdx = parseInt(embeddedImg[2], 10);
          return hostedReadVaultEmbeddedImage(uri, notePath, imageIdx);
        }
        const isNote = rel.endsWith('.md');
        if (isNote && !rel) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid path');
        }
        if (isNote) {
          try {
            const data = await upstreamFetch(
              `${canisterUrl}/api/v1/notes/${encodeURIComponent(rel)}`,
              canisterFetchOpts
            );
            const path = data.path != null ? String(data.path) : rel;
            const markdown = noteToMarkdown({
              path,
              frontmatter: data.frontmatter && typeof data.frontmatter === 'object' ? data.frontmatter : {},
              body: data.body != null ? String(data.body) : '',
            });
            const title = displayTitleFromHostedNote(data) || path.split('/').pop() || path;
            const desc = String(data.body || '').slice(0, 160).replace(/\s+/g, ' ').trim();
            return {
              contents: [
                {
                  uri: uri.toString(),
                  mimeType: 'text/markdown',
                  text: markdown,
                  _meta: { title, description: desc || undefined },
                },
              ],
            };
          } catch (e) {
            const msg = e.message || String(e);
            throw new McpError(ErrorCode.InternalError, msg);
          }
        }

        if (!isToolAllowed('list_notes', role)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Folder listing requires list_notes to be allowed for this session.',
          );
        }
        const folderNorm = rel.replace(/\/+$/, '');
        try {
          const params = new URLSearchParams();
          params.set('limit', String(HOSTED_VAULT_LISTING_RESOURCE_LIMIT));
          params.set('offset', '0');
          if (folderNorm) params.set('folder', folderNorm);
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(data?.notes) ? data.notes : [];
          const total = typeof data?.total === 'number' ? data.total : notes.length;
          const limit = HOSTED_VAULT_LISTING_RESOURCE_LIMIT;
          const folderLabel = folderNorm ? `/${folderNorm.replace(/^\/+/, '')}` : '/';
          const payload = {
            folder: folderLabel,
            notes,
            total,
            limit,
            truncated: total > limit,
          };
          return {
            contents: [
              {
                uri: uri.toString(),
                mimeType: 'application/json',
                text: JSON.stringify(payload),
              },
            ],
          };
        } catch (e) {
          const msg = e.message || String(e);
          throw new McpError(ErrorCode.InternalError, msg);
        }
      }
    );

    /**
     * R3: vault markdown templates under `templates/` (same canister reads as get_note; index via list_notes folder=).
     */
    if (isToolAllowed('list_notes', role)) {
      server.registerResource(
        'hosted-templates-index',
        'knowtation://hosted/templates-index',
        {
          title: 'Hosted vault template paths',
          description: `JSON listing of notes under templates/ (GET /api/v1/notes?folder=templates&limit=${HOSTED_TEMPLATES_LIST_LIMIT}).`,
        },
        async () => {
          const params = new URLSearchParams();
          params.set('limit', String(HOSTED_TEMPLATES_LIST_LIMIT));
          params.set('offset', '0');
          params.set('folder', 'templates');
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(data?.notes) ? data.notes : [];
          const relPaths = notes
            .map((n) => (n?.path != null ? String(n.path) : ''))
            .filter((p) => p.startsWith('templates/') && p.endsWith('.md'));
          return {
            contents: [
              {
                uri: 'knowtation://hosted/templates-index',
                mimeType: 'application/json',
                text: JSON.stringify({ templates: relPaths, total: relPaths.length }),
              },
            ],
          };
        }
      );

      const hostedTemplateFileTemplate = new ResourceTemplate('knowtation://hosted/template/{+name}', {
        list: async () => {
          const params = new URLSearchParams();
          params.set('limit', String(HOSTED_TEMPLATES_LIST_LIMIT));
          params.set('offset', '0');
          params.set('folder', 'templates');
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
          const notes = Array.isArray(data?.notes) ? data.notes : [];
          const resources = [];
          for (const n of notes) {
            const p = n?.path != null ? String(n.path) : '';
            if (!p.startsWith('templates/') || !p.endsWith('.md')) continue;
            const name = p.replace(/^templates\//, '');
            resources.push({
              uri: `knowtation://hosted/template/${name}`,
              name: name.split('/').pop() || name,
              mimeType: 'text/markdown',
              description: `Template: ${name}`,
            });
          }
          return { resources };
        },
      });
      server.registerResource(
        'hosted-template-file',
        hostedTemplateFileTemplate,
        {
          title: 'Hosted vault template',
          description: 'Markdown file under vault templates/ (same bytes as get_note).',
        },
        async (uri, variables) => {
          let name = variables.name;
          if (Array.isArray(name)) name = name[0];
          name = decodeURIComponent(String(name || '').replace(/\\/g, '/'));
          if (!name || name.includes('..')) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid template name');
          }
          let rel = `templates/${name}`;
          if (!rel.endsWith('.md')) rel = `${rel}.md`;
          try {
            const data = await upstreamFetch(
              `${canisterUrl}/api/v1/notes/${encodeURIComponent(rel)}`,
              canisterFetchOpts
            );
            const path = data.path != null ? String(data.path) : rel;
            const markdown = noteToMarkdown({
              path,
              frontmatter: data.frontmatter && typeof data.frontmatter === 'object' ? data.frontmatter : {},
              body: data.body != null ? String(data.body) : '',
            });
            return {
              contents: [
                {
                  uri: uri.toString(),
                  mimeType: 'text/markdown',
                  text: markdown,
                },
              ],
            };
          } catch (e) {
            const msg = e.message || String(e);
            throw new McpError(ErrorCode.InternalError, msg);
          }
        }
      );
    }
  }

  /**
   * R2 (initial): static JSON listing resource — first page only; filters/pagination remain on `list_notes`.
   */
  if (isToolAllowed('list_notes', role)) {
    server.registerResource(
      'hosted-vault-listing',
      'knowtation://hosted/vault-listing',
      {
        title: 'Hosted vault listing (first page)',
        description: `JSON from GET /api/v1/notes?limit=${HOSTED_VAULT_LISTING_RESOURCE_LIMIT}&offset=0 (same upstream as list_notes).`,
      },
      async () => {
        const params = new URLSearchParams();
        params.set('limit', String(HOSTED_VAULT_LISTING_RESOURCE_LIMIT));
        params.set('offset', '0');
        const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, canisterFetchOpts);
        return {
          contents: [
            {
              uri: 'knowtation://hosted/vault-listing',
              mimeType: 'application/json',
              text: JSON.stringify(data),
            },
          ],
        };
      }
    );
  }

  server.registerResource(
    'vault-info',
    'knowtation://hosted/vault-info',
    { description: 'Current vault context (user, vault, role, scope)' },
    async () => ({
      contents: [{
        uri: 'knowtation://hosted/vault-info',
        mimeType: 'application/json',
        text: JSON.stringify({ userId, canisterUserId, vaultId, role, scope }),
      }],
    })
  );

  server.registerResource(
    'hosted-prime',
    'knowtation://hosted/prime',
    {
      title: 'Hosted MCP bootstrap (prime)',
      description:
        'Compact JSON after auth: vault partition, role, MCP prompt names registered for this session, and suggested resource URIs. No secrets.',
    },
    async () => {
      const mcp_prompts_registered_for_role = [...allowedPromptsForRole(role)].sort();
      const payload = {
        schema: 'knowtation.prime/v1',
        surface: 'hosted',
        prime_uri: 'knowtation://hosted/prime',
        session: { userId, canisterUserId, vaultId, role, scope },
        mcp_prompts_registered_for_role,
        suggested_next_resources: [
          'knowtation://hosted/vault-info',
          'knowtation://hosted/vault-listing',
        ],
        docs: {
          why_knowtation: 'docs/TOKEN-SAVINGS.md',
          agent_integration: 'docs/AGENT-INTEGRATION.md',
          parity_matrix: 'docs/PARITY-MATRIX-HOSTED.md',
        },
        token_layers: {
          vault_retrieval:
            'Vault MCP tools (search, list_notes, get_note, …) pull snippets with limits — primary token savings.',
          terminal_tooling:
            'Terminal log compaction is optional on your dev host; Knowtation does not execute shell hooks inside hosted canisters.',
        },
      };
      return {
        contents: [
          {
            uri: 'knowtation://hosted/prime',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  /**
   * R3: memory topic JSON — same event shapes as `GET /api/v1/memory`, filtered by `extractTopicFromEvent`
   * (parity with self-hosted `knowtation://memory/topic/{slug}`). Topic list is derived from the latest bridge window only.
   * Hosted product guardrail: no video **file** resource; video stays as URLs in note bodies (§1b).
   */
  if (isPromptAllowed('memory-context', role)) {
    const memoryTopicTemplate = new ResourceTemplate('knowtation://hosted/memory/topic/{slug}', {
      list: async () => {
        const params = new URLSearchParams();
        params.set('limit', String(HOSTED_MEMORY_TOPIC_BRIDGE_LIMIT));
        const memJson = await upstreamFetch(`${bridgeUrl}/api/v1/memory?${params}`, bridgeFetchOpts);
        const raw = Array.isArray(memJson?.events) ? memJson.events : [];
        const topics = uniqueHostedMemoryTopicSlugs(raw);
        return {
          resources: topics.map((t) => ({
            uri: `knowtation://hosted/memory/topic/${encodeURIComponent(t)}`,
            name: t,
            mimeType: 'application/json',
            description: `Memory events for topic: ${t}`,
          })),
        };
      },
    });
    server.registerResource(
      'hosted-memory-topic',
      memoryTopicTemplate,
      {
        title: 'Hosted memory topic',
        description:
          'Memory events for a topic slug (heuristic partition). Upstream: GET /api/v1/memory with client-side filter; window size follows bridge limit.',
      },
      async (uri, variables) => {
        let slug = variables.slug;
        if (Array.isArray(slug)) slug = slug[0];
        slug = decodeURIComponent(String(slug || ''));
        if (!slug || slug.includes('..')) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid topic slug');
        }
        try {
          const params = new URLSearchParams();
          params.set('limit', String(HOSTED_MEMORY_TOPIC_BRIDGE_LIMIT));
          const memJson = await upstreamFetch(`${bridgeUrl}/api/v1/memory?${params}`, bridgeFetchOpts);
          const raw = Array.isArray(memJson?.events) ? memJson.events : [];
          const events = filterHostedMemoryEventsByTopic(raw, slug);
          const payload = {
            topic: slugify(slug),
            events,
            count: events.length,
            window_limit: HOSTED_MEMORY_TOPIC_BRIDGE_LIMIT,
            note:
              'Topics use the same slug rules as self-hosted MemoryManager.extractTopicFromEvent. Events are the subset of the latest bridge list (max 100) matching this slug.',
          };
          return {
            contents: [
              {
                uri: uri.toString(),
                mimeType: 'application/json',
                text: JSON.stringify(payload, null, 2),
              },
            ],
          };
        } catch (e) {
          const msg = e.message || String(e);
          throw new McpError(ErrorCode.InternalError, msg);
        }
      }
    );
  }

  return server;
}
