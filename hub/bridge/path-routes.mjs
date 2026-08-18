/**
 * Hosted bridge REST routes for learning-path list/get + gated propose/apply (KN-WORK-PATH-LIST-b).
 *
 * Mutating routes wrap withExternalProtocolBlobSync (same hub_flow_store.json — no new blob file).
 *
 * @see docs/KN-WORK-PATH-LIST-FREEZE.md
 */

import { handlePathListRequest, handlePathGetRequest, parsePathListLimit } from '../../lib/path/path-handlers.mjs';
import { handlePathProposeRequest } from '../../lib/path/path-write.mjs';
import {
  createPathProposalOnCanister,
  applyApprovedPathProposalFromCanister,
} from '../../lib/path/path-hosted-proposal.mjs';
import { withExternalProtocolBlobSync } from './external-agent-blob-store.mjs';
import { isSessionBoundActor } from '../gateway/access-token-authz.mjs';
import { verifyJwtWithSecretRotation } from '../lib/session-secret-rotation.mjs';
import { bridgeTaskHandlerRole } from './task-routes.mjs';

/**
 * @param {import('express').Express} app
 * @param {{
 *   dataDir: string,
 *   canisterUrl: string,
 *   canisterHeaders: (extra?: Record<string, string>) => Record<string, string>,
 *   requireBridgeAuth: import('express').RequestHandler,
 *   resolveHostedBridgeContext: (req: import('express').Request, actorUid: string) => Promise<{
 *     ok: boolean,
 *     status?: number,
 *     error?: string,
 *     code?: string,
 *     vaultId?: string,
 *     effectiveCanisterUid?: string,
 *     actorUid?: string,
 *   }>,
 *   effectiveRole: (uid: string, storedRoles: Record<string, string>) => string,
 *   loadRoles: (blobStore: unknown) => Promise<Record<string, string>>,
 * }} deps
 */
export function registerBridgePathRoutes(app, deps) {
  const {
    dataDir,
    canisterUrl,
    canisterHeaders,
    requireBridgeAuth,
    resolveHostedBridgeContext,
    effectiveRole,
    loadRoles,
  } = deps;

  /**
   * @param {import('express').Request} req
   */
  async function vaultContext(req) {
    return resolveHostedBridgeContext(req, req.uid);
  }

  /**
   * @param {import('express').Request} req
   */
  async function pathHandlerContext(req) {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return hctx;
    const roles = await loadRoles(req.blobStore);
    const role = bridgeTaskHandlerRole(effectiveRole(req.uid, roles));
    return { ok: true, hctx, role };
  }

  /**
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  function sessionBoundFromReq(req) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = process.env.SESSION_SECRET;
    if (!token || !secret) return false;
    const payload = verifyJwtWithSecretRotation(token, secret, process.env.SESSION_SECRET_PREVIOUS);
    return payload ? isSessionBoundActor(payload) : false;
  }

  /**
   * @param {{
   *   effectiveCanisterUid: string,
   *   actorUid: string,
   *   vaultId: string,
   *   sessionBound?: boolean,
   * }} ctx
   */
  function hostedCreateProposal(ctx) {
    return async function createProposal(_dataDir, input) {
      return createPathProposalOnCanister({
        canisterUrl,
        sessionBound: ctx.sessionBound === true,
        headers: canisterHeaders({
          'X-User-Id': ctx.effectiveCanisterUid,
          'X-Actor-Id': ctx.actorUid,
          'X-Vault-Id': ctx.vaultId,
        }),
        input: {
          ...input,
          vault_id: ctx.vaultId,
          proposed_by: ctx.actorUid,
        },
      });
    };
  }

  /**
   * @param {import('express').Response} res
   * @param {unknown} err
   */
  function sendRouteError(res, err) {
    const e = err && typeof err === 'object' ? /** @type {{ status?: number, code?: string, message?: string }} */ (err) : {};
    const status = typeof e.status === 'number' ? e.status : 500;
    const code = typeof e.code === 'string' ? e.code : 'RUNTIME_ERROR';
    const message = typeof e.message === 'string' ? e.message : String(err);
    return res.status(status).json({ error: message, code });
  }

  app.get('/api/v1/learning-paths', requireBridgeAuth, async (req, res) => {
    const ctx = await pathHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const result = await withExternalProtocolBlobSync({
      blobStore: req.blobStore ?? null,
      dataDir,
      run: () =>
        handlePathListRequest({
          dataDir,
          vaultId: ctx.hctx.vaultId,
          userId: req.uid,
          role: ctx.role,
          scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
          workspace_id: typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          limit: parsePathListLimit(req.query.limit),
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.get('/api/v1/learning-paths/:path_id', requireBridgeAuth, async (req, res) => {
    const ctx = await pathHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const pathId =
      typeof req.params.path_id === 'string' ? decodeURIComponent(req.params.path_id).trim() : '';
    const result = await withExternalProtocolBlobSync({
      blobStore: req.blobStore ?? null,
      dataDir,
      run: () =>
        handlePathGetRequest({
          dataDir,
          vaultId: ctx.hctx.vaultId,
          pathId,
          userId: req.uid,
          role: ctx.role,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.post('/api/v1/learning-paths/proposals', requireBridgeAuth, async (req, res) => {
    const ctx = await pathHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const proposalKind =
      typeof body.proposal_kind === 'string' && body.proposal_kind.trim()
        ? body.proposal_kind.trim()
        : 'path_create';
    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handlePathProposeRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            proposalKind,
            body,
            intent: body.intent,
            sessionBound: sessionBoundFromReq(req),
            createProposal: hostedCreateProposal({
              effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
              actorUid: req.uid,
              vaultId: ctx.hctx.vaultId,
              sessionBound: sessionBoundFromReq(req),
            }),
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post(
    '/api/v1/learning-paths/proposals/:proposal_id/apply-approved',
    requireBridgeAuth,
    async (req, res) => {
      const hctx = await vaultContext(req);
      if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });

      const proposalId =
        typeof req.params.proposal_id === 'string' ? decodeURIComponent(req.params.proposal_id).trim() : '';
      if (!proposalId) {
        return res.status(400).json({ error: 'proposal_id required', code: 'BAD_REQUEST' });
      }

      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          applyApprovedPathProposalFromCanister({
            dataDir,
            canisterUrl,
            headers: canisterHeaders({
              'X-User-Id': hctx.effectiveCanisterUid,
              'X-Actor-Id': req.uid,
              'X-Vault-Id': hctx.vaultId,
            }),
            proposalId,
            requireApproved: true,
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    },
  );
}
