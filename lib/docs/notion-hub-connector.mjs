/**
 * Process-wide Hub-key Notion connector.
 *
 * Gated by DOCS_NOTION_HUB_KEY_AUTHORIZED (compile-time; Tier 3 flip 2026-08-22).
 * There is no OAuth flow and connector records never contain NOTION_API_KEY.
 */

import { fetchNotionPageMarkdown } from '../importers/notion.mjs';
import {
  connectorForClient,
  getConnector,
  listConnectors,
  newConnectorId,
  saveConnector,
} from './docs-connector-store.mjs';
import { proposeDocsImports } from './docs-import-propose.mjs';

export const DOCS_NOTION_HUB_KEY_AUTHORIZED = true;
export const NOTION_PAGE_ID_RE = /^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/;
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const activeSyncs = new Set();

export function isDocsNotionHubKeyEnabled({ authorizedOverride } = {}) {
  if (authorizedOverride === true) return true;
  if (authorizedOverride === false) return false;
  return DOCS_NOTION_HUB_KEY_AUTHORIZED === true;
}

function result(status, code) {
  return { ok: false, status, code };
}

function notAuthorized() {
  return result(501, 'NOT_AUTHORIZED');
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithBackoff(ctx, client, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await client.search(params);
    if (response?.status !== 429) return response;
    if (attempt < 2) {
      const wait = Number.isFinite(response.retryAfterMs)
        ? Math.max(0, Math.min(response.retryAfterMs, 60_000))
        : 0;
      await (ctx.sleepFn ?? sleep)(wait);
    }
  }
  return { status: 429 };
}

function apiKeyFrom(env = process.env) {
  return typeof env?.NOTION_API_KEY === 'string' ? env.NOTION_API_KEY.trim() : '';
}

function titleFromPage(page) {
  const properties = page?.properties && typeof page.properties === 'object' ? page.properties : {};
  for (const property of Object.values(properties)) {
    if (property?.type !== 'title' || !Array.isArray(property.title)) continue;
    const title = property.title.map((part) => part?.plain_text ?? '').join('').trim();
    if (title) return title.slice(0, 512);
  }
  return 'Untitled Notion page';
}

function normalizeNotionResult(row) {
  return {
    file_id: typeof row?.id === 'string' ? row.id : '',
    name: row?.object === 'page' ? titleFromPage(row) : 'Notion database',
    mime: row?.object === 'page' ? 'application/vnd.notion.page' : 'application/vnd.notion.database',
    modified: typeof row?.last_edited_time === 'string' ? row.last_edited_time : null,
    size: 0,
    importable: row?.object === 'page',
  };
}

export function handleBeginNotionConnector(ctx) {
  if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : null;
  if (!body || Object.keys(body).some((key) => !['provider', 'display_name', 'return_url'].includes(key))) {
    return result(400, 'BAD_REQUEST');
  }
  if (body.provider !== 'notion') return result(400, 'PROVIDER_DENIED');
  const connector = {
    connector_id: newConnectorId(),
    provider: 'notion',
    display_name: typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim().slice(0, 128)
      : 'Notion',
    status: apiKeyFrom(ctx.env) ? 'connected' : 'needs_reauth',
    account_sub: null,
    oauth_ref: null,
    sync_cursor: null,
    last_sync_at: null,
    last_sync_error: 'none',
    file_count: 0,
    revoked_at: null,
    oauth_pending: null,
  };
  saveConnector(ctx.dataDir, ctx.vaultId, connector);
  return {
    ok: true,
    status: 200,
    payload: { connector_id: connector.connector_id, status: connector.status },
  };
}

export function handleListNotionConnectors(ctx) {
  if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  return {
    ok: true,
    status: 200,
    payload: {
      schema: 'knowtation.docs_connectors/v0',
      connectors: listConnectors(ctx.dataDir, ctx.vaultId)
        .filter((connector) => connector.provider === 'notion')
        .map(connectorForClient),
    },
  };
}

function connectedNotion(ctx) {
  const connector = getConnector(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  if (!connector || connector.status === 'revoked') return { response: result(404, 'CONNECTOR_NOT_FOUND') };
  if (connector.provider !== 'notion') return { response: result(400, 'PROVIDER_DENIED') };
  const key = apiKeyFrom(ctx.env);
  if (!key || connector.status === 'needs_reauth') {
    if (connector.status !== 'needs_reauth') {
      connector.status = 'needs_reauth';
      connector.last_sync_error = 'auth_expired';
      saveConnector(ctx.dataDir, ctx.vaultId, connector);
    }
    return { response: result(409, 'NEEDS_REAUTH') };
  }
  if (connector.status !== 'connected') return { response: result(400, 'BAD_REQUEST') };
  return { connector, apiKey: key };
}

export function createProductionNotionClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const headers = (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  return {
    search: async ({ apiKey, startCursor }) => {
      const response = await fetchImpl(`${NOTION_API_BASE}/search`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({
          page_size: 50,
          ...(startCursor ? { start_cursor: startCursor } : {}),
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
        }),
      });
      const body = await response.json();
      const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');
      return {
        ...body,
        status: response.status,
        ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1000 } : {}),
      };
    },
    fetchPageMarkdown: ({ pageId, apiKey }) => fetchNotionPageMarkdown(pageId, { apiKey, fetchImpl }),
  };
}

export function createFakeNotionClient(fixtures = {}) {
  return {
    search: async (args) => typeof fixtures.search === 'function'
      ? fixtures.search(args)
      : { results: fixtures.results ?? [], next_cursor: fixtures.next_cursor ?? null, has_more: false, status: 200 },
    fetchPageMarkdown: async (args) => typeof fixtures.fetchPageMarkdown === 'function'
      ? fixtures.fetchPageMarkdown(args)
      : fixtures.markdownByPage?.[args.pageId] ?? '',
  };
}

function notionClient(ctx) {
  return ctx.notionClient ?? createProductionNotionClient({ fetchImpl: ctx.fetchImpl });
}

export async function handleListNotionConnectorFiles(ctx) {
  if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const found = connectedNotion(ctx);
  if (found.response) return found.response;
  const pageToken = ctx.query?.page_token;
  if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 2048)) {
    return result(400, 'BAD_REQUEST');
  }
  const client = notionClient(ctx);
  const response = await searchWithBackoff(
    ctx,
    client,
    { apiKey: found.apiKey, ...(pageToken ? { startCursor: pageToken } : {}) },
  );
  if (response.status === 429) return result(429, 'RATE_LIMITED');
  if (response.status && response.status >= 400) return result(502, 'PROVIDER_ERROR');
  const files = (Array.isArray(response.results) ? response.results : []).slice(0, 50).map(normalizeNotionResult);
  found.connector.file_count = files.length;
  found.connector.last_sync_error = 'none';
  saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
  return {
    ok: true,
    status: 200,
    payload: {
      files,
      ...(typeof response.next_cursor === 'string' && response.next_cursor
        ? { next_page_token: response.next_cursor }
        : {}),
    },
  };
}

async function fetchNotionItems(ctx, found, pageIds) {
  const client = notionClient(ctx);
  const items = [];
  const skips = [];
  let batchBytes = 0;
  for (const pageId of pageIds) {
    let markdown;
    try {
      markdown = await client.fetchPageMarkdown({ pageId, apiKey: found.apiKey });
    } catch {
      skips.push({ source_id: pageId, reason: 'not_found' });
      continue;
    }
    const size = Buffer.byteLength(typeof markdown === 'string' ? markdown : '', 'utf8');
    if (size > 25_000_000) {
      skips.push({ source_id: pageId, reason: 'too_large' });
      continue;
    }
    if (!markdown.trim()) {
      skips.push({ source_id: pageId, reason: 'empty_extract' });
      continue;
    }
    batchBytes += size;
    if (batchBytes > 80_000_000) throw Object.assign(new TypeError('import batch exceeds byte cap'), { code: 'BAD_REQUEST' });
    items.push({ source_id: pageId, name: pageId, markdown, size });
  }
  return { items, skips };
}

export async function handleImportNotionConnectorFiles(ctx) {
  if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const found = connectedNotion(ctx);
  if (found.response) return found.response;
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : null;
  if (!body || Object.keys(body).some((key) => key !== 'file_ids')) return result(400, 'BAD_REQUEST');
  const pageIds = body.file_ids;
  if (!Array.isArray(pageIds) || pageIds.length < 1 || pageIds.length > 20 || !pageIds.every((id) => NOTION_PAGE_ID_RE.test(id))) {
    return result(400, 'BAD_REQUEST');
  }
  let fetched;
  try {
    fetched = await fetchNotionItems(ctx, found, pageIds);
  } catch (error) {
    return error?.code === 'BAD_REQUEST' ? result(400, 'BAD_REQUEST') : result(502, 'PROVIDER_ERROR');
  }
  const proposed = fetched.items.length
    ? proposeDocsImports({
        dataDir: ctx.dataDir,
        vaultPath: ctx.vaultPath,
        vaultId: ctx.vaultId,
        connectorId: ctx.connectorId,
        provider: 'notion',
        items: fetched.items,
        now: ctx.now,
        createProposalFn: ctx.createProposalFn,
        loadProposalsFn: ctx.loadProposalsFn,
        listMarkdownFilesFn: ctx.listMarkdownFilesFn,
        readNoteFn: ctx.readNoteFn,
      })
    : { proposed: 0, skipped: 0, proposal_ids: [], skip_details: [] };
  const skipDetails = [...fetched.skips, ...proposed.skip_details];
  return {
    ok: true,
    status: 200,
    payload: {
      proposed: proposed.proposed,
      skipped: skipDetails.length,
      proposal_ids: proposed.proposal_ids,
      skip_details: skipDetails,
    },
  };
}

export async function handleSyncNotionConnector(ctx) {
  if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const found = connectedNotion(ctx);
  if (found.response) return found.response;
  const now = ctx.now ?? Date.now();
  const last = found.connector.last_sync_at ? Date.parse(found.connector.last_sync_at) : 0;
  if (activeSyncs.has(ctx.connectorId) || (Number.isFinite(last) && now - last < 60_000)) {
    return result(429, 'RATE_LIMITED');
  }
  activeSyncs.add(ctx.connectorId);
  try {
    const client = notionClient(ctx);
    const response = await searchWithBackoff(ctx, client, {
      apiKey: found.apiKey,
      ...(found.connector.sync_cursor ? { startCursor: found.connector.sync_cursor } : {}),
    });
    if (response.status === 429) return result(429, 'RATE_LIMITED');
    if (response.status && response.status >= 400) return result(502, 'PROVIDER_ERROR');
    const pages = (response.results ?? []).filter((row) => row?.object === 'page').slice(0, 20);
    const ids = pages.map((row) => row.id).filter((id) => NOTION_PAGE_ID_RE.test(id));
    const fetched = await fetchNotionItems(ctx, found, ids);
    const proposed = fetched.items.length
      ? proposeDocsImports({
          dataDir: ctx.dataDir,
          vaultPath: ctx.vaultPath,
          vaultId: ctx.vaultId,
          connectorId: ctx.connectorId,
          provider: 'notion',
          items: fetched.items,
          now,
          createProposalFn: ctx.createProposalFn,
          loadProposalsFn: ctx.loadProposalsFn,
          listMarkdownFilesFn: ctx.listMarkdownFilesFn,
          readNoteFn: ctx.readNoteFn,
        })
      : { proposed: 0, skipped: 0 };
    found.connector.sync_cursor = typeof response.next_cursor === 'string' ? response.next_cursor : null;
    found.connector.last_sync_at = new Date(now).toISOString();
    found.connector.last_sync_error = 'none';
    found.connector.file_count = pages.length;
    saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
    return {
      ok: true,
      status: 200,
      payload: {
        proposed: proposed.proposed,
        skipped: fetched.skips.length + proposed.skipped,
        last_sync_at: found.connector.last_sync_at,
      },
    };
  } catch {
    found.connector.last_sync_error = 'network_error';
    saveConnector(ctx.dataDir, ctx.vaultId, found.connector);
    return result(502, 'PROVIDER_ERROR');
  } finally {
    activeSyncs.delete(ctx.connectorId);
  }
}

export function handleRevokeNotionConnector(ctx) {
  if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) return notAuthorized();
  const connector = getConnector(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  if (!connector || connector.status === 'revoked') return result(404, 'CONNECTOR_NOT_FOUND');
  if (connector.provider !== 'notion') return result(400, 'PROVIDER_DENIED');
  connector.status = 'revoked';
  connector.revoked_at = new Date(ctx.now ?? Date.now()).toISOString();
  connector.sync_cursor = null;
  connector.oauth_ref = null;
  connector.oauth_pending = null;
  saveConnector(ctx.dataDir, ctx.vaultId, connector);
  return { ok: true, status: 200, payload: { revoked: true } };
}

export const handleListNotionConnectorPages = handleListNotionConnectorFiles;
export const handleImportNotionConnectorPages = handleImportNotionConnectorFiles;
