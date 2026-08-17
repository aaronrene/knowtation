/**
 * Unified docs connector route handlers (Drive + Notion).
 *
 * Dispatches by provider / connector.provider. Drive gate is live
 * (`DOCS_OAUTH_GOOGLE_AUTHORIZED=true`); Notion stays off. Tests may pass
 * authorizedOverride via opts (routes never do in prod).
 *
 * @see docs/KN-DOCS-SYNC-FREEZE.md §4.2
 */

import {
  connectorForClient,
  getConnector,
  listConnectors,
} from './docs-connector-store.mjs';
import {
  createProductionGoogleDriveClient,
  handleBeginDocsConnector,
  handleDocsConnectorCallback,
  handleImportDocsConnectorFiles,
  handleListDocsConnectorFiles,
  handleRevokeDocsConnector,
  handleSyncDocsConnector,
  isDocsGoogleOAuthEnabled,
} from './google-drive-connector.mjs';
import {
  createProductionNotionClient,
  handleBeginNotionConnector,
  handleImportNotionConnectorFiles,
  handleListNotionConnectorFiles,
  handleRevokeNotionConnector,
  handleSyncNotionConnector,
  isDocsNotionHubKeyEnabled,
} from './notion-hub-connector.mjs';

/**
 * @param {{ authorizedOverride?: boolean, googleOverride?: boolean, notionOverride?: boolean }} [opts]
 */
export function isAnyDocsConnectorEnabled(opts = {}) {
  const googleOpts = opts.googleOverride !== undefined
    ? { authorizedOverride: opts.googleOverride }
    : opts.authorizedOverride !== undefined
      ? { authorizedOverride: opts.authorizedOverride }
      : {};
  const notionOpts = opts.notionOverride !== undefined
    ? { authorizedOverride: opts.notionOverride }
    : opts.authorizedOverride !== undefined
      ? { authorizedOverride: opts.authorizedOverride }
      : {};
  return isDocsGoogleOAuthEnabled(googleOpts) || isDocsNotionHubKeyEnabled(notionOpts);
}

function notAuthorized() {
  return { ok: false, status: 501, code: 'NOT_AUTHORIZED' };
}

/**
 * POST api/v1/docs/connectors — begin Drive OAuth or Notion Hub-key connector.
 * @param {object} ctx
 */
export function handleBeginDocsProvider(ctx) {
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : null;
  const provider = body && typeof body.provider === 'string' ? body.provider : '';
  if (provider === 'google-drive') {
    return handleBeginDocsConnector(ctx);
  }
  if (provider === 'notion') {
    return handleBeginNotionConnector(ctx);
  }
  if (!isAnyDocsConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorized();
  }
  return { ok: false, status: 400, code: 'PROVIDER_DENIED' };
}

/**
 * GET api/v1/docs/connectors — list client-safe connectors (both providers).
 * @param {object} ctx
 */
export function handleListAllDocsConnectors(ctx) {
  if (!isAnyDocsConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorized();
  }
  return {
    ok: true,
    status: 200,
    payload: {
      schema: 'knowtation.docs_connectors/v0',
      connectors: listConnectors(ctx.dataDir, ctx.vaultId).map(connectorForClient),
    },
  };
}

/**
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function handleDocsConnectorCallbackUnified(ctx) {
  return handleDocsConnectorCallback(ctx);
}

/**
 * Dispatch list/import/sync/revoke by stored connector provider.
 * @param {'list'|'import'|'sync'|'revoke'} action
 * @param {object} ctx
 */
export async function handleDocsConnectorAction(action, ctx) {
  if (!isAnyDocsConnectorEnabled({ authorizedOverride: ctx.authorizedOverride })) {
    return notAuthorized();
  }
  const connector = getConnector(ctx.dataDir, ctx.vaultId, ctx.connectorId);
  if (!connector || connector.status === 'revoked') {
    return { ok: false, status: 404, code: 'CONNECTOR_NOT_FOUND' };
  }
  if (connector.provider === 'google-drive') {
    if (!isDocsGoogleOAuthEnabled({ authorizedOverride: ctx.authorizedOverride })) {
      return notAuthorized();
    }
    if (action === 'list') return handleListDocsConnectorFiles(ctx);
    if (action === 'import') return handleImportDocsConnectorFiles(ctx);
    if (action === 'sync') return handleSyncDocsConnector(ctx);
    if (action === 'revoke') return handleRevokeDocsConnector(ctx);
  }
  if (connector.provider === 'notion') {
    if (!isDocsNotionHubKeyEnabled({ authorizedOverride: ctx.authorizedOverride })) {
      return notAuthorized();
    }
    if (action === 'list') return handleListNotionConnectorFiles(ctx);
    if (action === 'import') return handleImportNotionConnectorFiles(ctx);
    if (action === 'sync') return handleSyncNotionConnector(ctx);
    if (action === 'revoke') return handleRevokeNotionConnector(ctx);
  }
  return { ok: false, status: 400, code: 'PROVIDER_DENIED' };
}

export {
  createProductionGoogleDriveClient,
  createProductionNotionClient,
};
