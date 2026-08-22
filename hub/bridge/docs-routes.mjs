/**
 * Hosted bridge REST routes for docs connectors (KN-DOCS-SYNC-b).
 *
 * DOCS_OAUTH_GOOGLE_AUTHORIZED flipped true 2026-08-17 (Tier 3).
 * DOCS_NOTION_HUB_KEY_AUTHORIZED flipped true 2026-08-22 (Tier 3).
 * Production never passes authorizedOverride.
 * Blob hydrate/persist uses strong consistency for pending OAuth state (D17).
 *
 * @see docs/KN-DOCS-SYNC-FREEZE.md
 * @see hub/bridge/calendar-blob-store.mjs (pattern sibling)
 */

import path from 'path';
import fs from 'fs';
import { createProposal } from '../proposals-store.mjs';
import {
  createProductionGoogleDriveClient,
  createProductionNotionClient,
  handleBeginDocsProvider,
  handleDocsConnectorAction,
  handleDocsConnectorCallbackUnified,
  handleListAllDocsConnectors,
} from '../../lib/docs/docs-api.mjs';
import { withDocsBlobSync } from './docs-blob-store.mjs';

/**
 * Resolve a writable vault path for docs import proposals on the bridge.
 * Hosted lambdas use DATA_DIR/vaults/{vaultId}; self-tests may inject vaultPath.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {string}
 */
export function bridgeDocsVaultPath(dataDir, vaultId) {
  const safe = typeof vaultId === 'string' && vaultId.trim() ? vaultId.trim() : 'default';
  const dir = path.join(dataDir, 'vaults', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   dataDir: string,
 *   requireBridgeAuth: import('express').RequestHandler,
 *   requireBridgeEditorOrAdmin: import('express').RequestHandler,
 *   resolveHostedBridgeContext: (req: import('express').Request, actorUid: string) => Promise<{
 *     ok: boolean,
 *     status?: number,
 *     error?: string,
 *     code?: string,
 *     vaultId?: string,
 *   }>,
 *   resolveHostedBridgeSettingsContext: (req: import('express').Request, actorUid: string) => {
 *     allowedVaultIds: string[],
 *   },
 *   sanitizeVaultId: (raw: unknown) => string,
 * }} deps
 */
export function registerBridgeDocsRoutes(app, deps) {
  const {
    dataDir,
    requireBridgeAuth,
    requireBridgeEditorOrAdmin,
    resolveHostedBridgeContext,
    resolveHostedBridgeSettingsContext,
    sanitizeVaultId,
  } = deps;

  app.get('/api/v1/docs/connectors/callback', async (req, res) => {
    try {
      const result = await withDocsBlobSync({
        blobStore: req.blobStore,
        dataDir,
        run: async () => {
          const googleClient = createProductionGoogleDriveClient();
          return handleDocsConnectorCallbackUnified({
            dataDir,
            query: req.query,
            googleClient,
            env: process.env,
          });
        },
      });
      if (result.redirect) {
        return res.redirect(result.status, result.redirect);
      }
      return res.status(result.status).json({ code: result.code });
    } catch {
      return res.status(500).json({ error: 'Callback failed', code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/docs/connectors', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const result = await withDocsBlobSync({
      blobStore: req.blobStore,
      dataDir,
      run: () =>
        handleBeginDocsProvider({
          dataDir,
          vaultId: hctx.vaultId,
          body: req.body,
          env: process.env,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error ?? 'Not authorized', code: result.code });
    }
    return res.status(result.status).json(result.payload);
  });

  app.get('/api/v1/docs/connectors', requireBridgeAuth, async (req, res) => {
    const hctx = await resolveHostedBridgeSettingsContext(req, req.uid);
    const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
    if (!hctx.allowedVaultIds.includes(vaultId)) {
      return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
    }
    const result = await withDocsBlobSync({
      blobStore: req.blobStore,
      dataDir,
      persist: false,
      run: () =>
        handleListAllDocsConnectors({
          dataDir,
          vaultId,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error ?? 'Not authorized', code: result.code });
    }
    return res.json(result.payload);
  });

  app.get('/api/v1/docs/connectors/:id/files', requireBridgeAuth, async (req, res) => {
    const hctx = await resolveHostedBridgeSettingsContext(req, req.uid);
    const vaultId = sanitizeVaultId(req.headers['x-vault-id']);
    if (!hctx.allowedVaultIds.includes(vaultId)) {
      return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
    }
    const connectorId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    try {
      const result = await withDocsBlobSync({
        blobStore: req.blobStore,
        dataDir,
        run: async () =>
          handleDocsConnectorAction('list', {
            dataDir,
            vaultId,
            connectorId,
            query: req.query,
            env: process.env,
            googleClient: createProductionGoogleDriveClient(),
            notionClient: createProductionNotionClient(),
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ code: result.code });
      }
      return res.status(result.status).json(result.payload);
    } catch (e) {
      return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/docs/connectors/:id/import', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const connectorId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const vaultPath = bridgeDocsVaultPath(dataDir, hctx.vaultId);
    try {
      const result = await withDocsBlobSync({
        blobStore: req.blobStore,
        dataDir,
        run: async () =>
          handleDocsConnectorAction('import', {
            dataDir,
            vaultPath,
            vaultId: hctx.vaultId,
            connectorId,
            body: req.body,
            env: process.env,
            googleClient: createProductionGoogleDriveClient(),
            notionClient: createProductionNotionClient(),
            createProposalFn: createProposal,
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ code: result.code });
      }
      return res.status(result.status).json(result.payload);
    } catch (e) {
      return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/docs/connectors/:id/sync', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const connectorId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const vaultPath = bridgeDocsVaultPath(dataDir, hctx.vaultId);
    try {
      const result = await withDocsBlobSync({
        blobStore: req.blobStore,
        dataDir,
        run: async () =>
          handleDocsConnectorAction('sync', {
            dataDir,
            vaultPath,
            vaultId: hctx.vaultId,
            connectorId,
            env: process.env,
            googleClient: createProductionGoogleDriveClient(),
            notionClient: createProductionNotionClient(),
            createProposalFn: createProposal,
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ code: result.code });
      }
      return res.status(result.status).json(result.payload);
    } catch (e) {
      return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    }
  });

  app.delete('/api/v1/docs/connectors/:id', requireBridgeAuth, requireBridgeEditorOrAdmin, async (req, res) => {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const connectorId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    try {
      const result = await withDocsBlobSync({
        blobStore: req.blobStore,
        dataDir,
        run: async () =>
          handleDocsConnectorAction('revoke', {
            dataDir,
            vaultId: hctx.vaultId,
            connectorId,
            env: process.env,
            googleClient: createProductionGoogleDriveClient(),
            notionClient: createProductionNotionClient(),
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ code: result.code });
      }
      return res.status(result.status).json(result.payload);
    } catch (e) {
      return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    }
  });
}
