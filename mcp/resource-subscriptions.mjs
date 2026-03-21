/**
 * Issue #1 Phase E — resource subscriptions + vault watcher.
 * Tracks resources/subscribe URIs and emits notifications/resources/updated when allowed.
 */

import path from 'path';
import chokidar from 'chokidar';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** @type {Set<string>} */
const subscribedUris = new Set();

const FLUSH_MS = 150;

/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;
/** @type {Set<string>} */
const pendingUpdatedUris = new Set();
let pendingListChanged = false;

function normalizeUri(u) {
  return String(u || '').trim();
}

/**
 * True if a subscription to `subscriberUri` should receive updates for `changedUri`.
 * @param {string} subscriberUri
 * @param {string} changedUri
 */
export function subscriptionCoversUri(subscriberUri, changedUri) {
  const sub = normalizeUri(subscriberUri);
  const ch = normalizeUri(changedUri);
  if (!sub || !ch) return false;
  if (sub === ch) return true;
  const base = sub.replace(/\/+$/, '') || sub;
  return ch.startsWith(`${base}/`);
}

function shouldNotifyUpdated(changedUri) {
  const ch = normalizeUri(changedUri);
  for (const sub of subscribedUris) {
    if (subscriptionCoversUri(sub, ch)) return true;
  }
  return false;
}

async function emitResourceUpdated(mcpServer, uri) {
  if (!mcpServer.isConnected() || !shouldNotifyUpdated(uri)) return;
  try {
    await mcpServer.server.sendResourceUpdated({ uri });
  } catch (_) {
    /* transport may be closing */
  }
}

async function flushPending(mcpServer) {
  if (pendingListChanged) {
    mcpServer.sendResourceListChanged();
    pendingListChanged = false;
  }
  const batch = [...pendingUpdatedUris];
  pendingUpdatedUris.clear();
  for (const u of batch) {
    await emitResourceUpdated(mcpServer, u);
  }
}

function scheduleFlush(mcpServer) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending(mcpServer);
  }, FLUSH_MS);
}

/**
 * Listing resources that may need refresh when a vault-relative path changes.
 * @param {string} relPosix vault-relative path with forward slashes
 * @returns {string[]}
 */
export function listingUrisForRelPath(relPosix) {
  const uris = new Set(['knowtation://vault/']);
  if (!relPosix) return [...uris];
  const seg = relPosix.split('/');
  if (seg[0] === 'inbox') uris.add('knowtation://vault/inbox');
  if (seg[0] === 'captures') uris.add('knowtation://vault/captures');
  if (seg[0] === 'imports') uris.add('knowtation://vault/imports');
  if (seg[0] === 'templates' || relPosix.startsWith('templates/')) uris.add('knowtation://vault/templates');
  if (seg[0] === 'media' && seg[1] === 'audio') uris.add('knowtation://vault/media/audio');
  if (seg[0] === 'media' && seg[1] === 'video') uris.add('knowtation://vault/media/video');
  if (seg[0] === 'projects' && seg[1]) {
    uris.add(`knowtation://vault/projects/${seg[1]}`);
  }
  return [...uris];
}

/**
 * @param {string} vaultPath absolute
 * @param {string} absPath absolute path from watcher
 * @returns {string | null} vault-relative posix path
 */
export function vaultRelativePosix(vaultPath, absPath) {
  const rel = path.relative(vaultPath, absPath);
  if (!rel || rel.startsWith('..')) return null;
  return rel.split(path.sep).join('/');
}

function queueVaultFsChange(mcpServer, event, absFilePath, vaultPath) {
  const rel = vaultRelativePosix(vaultPath, absFilePath);
  if (rel === null) return;

  if (event === 'unlink' || event === 'unlinkDir') {
    pendingListChanged = true;
    if (rel.endsWith('.md')) {
      pendingUpdatedUris.add(`knowtation://vault/${rel}`);
    }
    for (const u of listingUrisForRelPath(rel)) pendingUpdatedUris.add(u);
    scheduleFlush(mcpServer);
    return;
  }

  if (event === 'add' || event === 'change' || event === 'addDir') {
    if (rel.endsWith('.md')) {
      pendingUpdatedUris.add(`knowtation://vault/${rel}`);
      for (const u of listingUrisForRelPath(rel)) pendingUpdatedUris.add(u);
    } else {
      for (const u of listingUrisForRelPath(rel)) pendingUpdatedUris.add(u);
    }
    scheduleFlush(mcpServer);
  }
}

const INDEX_METADATA_URIS = [
  'knowtation://index/stats',
  'knowtation://tags',
  'knowtation://projects',
  'knowtation://index/graph',
];

/**
 * After indexer run: notify metadata resources if clients subscribed (Issue #1 E3).
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 */
export async function notifyIndexMetadataResources(mcpServer) {
  if (!mcpServer.isConnected()) return;
  for (const uri of INDEX_METADATA_URIS) {
    await emitResourceUpdated(mcpServer, uri);
  }
}

/**
 * Register resources/subscribe and resources/unsubscribe on the underlying Server.
 * Call after resources are registered, before connect().
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 */
export function registerResourceSubscriptionHandlers(mcpServer) {
  const srv = mcpServer.server;

  srv.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = normalizeUri(request.params?.uri);
    if (!uri.startsWith('knowtation://')) {
      return {};
    }
    subscribedUris.add(uri);
    return {};
  });

  srv.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    const uri = normalizeUri(request.params?.uri);
    subscribedUris.delete(uri);
    return {};
  });
}

/**
 * Start watching the vault; emit debounced list/updated notifications.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {string} vaultPath absolute
 * @returns {{ close: () => Promise<void> }}
 */
export function startVaultResourceWatcher(mcpServer, vaultPath) {
  if (process.env.KNOWTATION_MCP_NO_WATCH === '1') {
    return { close: async () => {} };
  }

  const watcher = chokidar.watch(vaultPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ignored: (fp) => {
      const rel = path.relative(vaultPath, fp);
      return rel.split(path.sep).includes('.git');
    },
  });

  watcher.on('all', (event, fp) => {
    if (typeof fp !== 'string') return;
    queueVaultFsChange(mcpServer, event, path.resolve(fp), vaultPath);
  });

  return {
    close: async () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
        await flushPending(mcpServer);
      }
      await watcher.close();
    },
  };
}
