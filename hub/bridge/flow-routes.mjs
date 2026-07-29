/**
 * Hosted bridge REST routes for Flow authoring write propose
 * (FLOW-WRITE-LIVE-GATEWAY-PROXY — parity with task-routes 2G).
 *
 * Gated by FLOW_AUTHORING_WRITES (default OFF → 403 FLOW_AUTHORING_DISABLED).
 * Does NOT mount capture/run/Delegation write routes.
 *
 * @see docs/FLOW-AUTHORING-WRITEBACK-CONTRACT-7A-L1.md
 * @see hub/bridge/task-routes.mjs
 */

import { handleFlowProposeRequest } from '../../lib/flow/flow-authoring.mjs';
import { createFlowProposalOnCanister } from '../../lib/flow/flow-hosted-proposal.mjs';
import { isSessionBoundActor } from '../gateway/access-token-authz.mjs';
import jwt from 'jsonwebtoken';

/**
 * Map bridge role to flow handler role (member → editor, matching self-hosted hub/server.mjs).
 *
 * @param {string} role
 * @returns {string}
 */
export function bridgeFlowHandlerRole(role) {
  const r = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return r === 'member' || !r ? 'editor' : r;
}

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
export function registerBridgeFlowRoutes(app, deps) {
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
  async function flowHandlerContext(req) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return hctx;
    const roles = await loadRoles(req.blobStore);
    const role = bridgeFlowHandlerRole(effectiveRole(req.uid, roles));
    return { ok: true, hctx, role };
  }

  /**
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  function sessionBoundFromReq(req) {
    try {
      const auth = req.headers.authorization;
      const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const secret = process.env.SESSION_SECRET;
      if (!token || !secret) return false;
      const payload = jwt.verify(token, secret);
      return isSessionBoundActor(payload);
    } catch {
      return false;
    }
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
      return createFlowProposalOnCanister({
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
    const e =
      err && typeof err === 'object'
        ? /** @type {{ status?: number, code?: string, message?: string }} */ (err)
        : {};
    const status = typeof e.status === 'number' ? e.status : 500;
    const code = typeof e.code === 'string' ? e.code : 'RUNTIME_ERROR';
    const message = typeof e.message === 'string' ? e.message : String(err);
    return res.status(status).json({ error: message, code });
  }

  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {'new'|'edit'|'import'} kind
   * @param {{ flowId?: string }} [extra]
   */
  async function runFlowPropose(req, res, kind, extra = {}) {
    const ctx = await flowHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await handleFlowProposeRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        kind,
        flow: body.flow,
        steps: body.steps,
        bundle: kind === 'import' ? body.bundle ?? { flow: body.flow, steps: body.steps } : undefined,
        intent: body.intent,
        flowId: extra.flowId,
        baseVersion: body.base_version,
        baseStateId: body.base_state_id,
        externalRef: body.external_ref,
        sourceVaultHint: body.source_vault_hint,
        sessionBound: sessionBoundFromReq(req),
        createProposal: hostedCreateProposal({
          effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
          actorUid: req.uid,
          vaultId: ctx.hctx.vaultId,
          sessionBound: sessionBoundFromReq(req),
        }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  }

  // Static path before :id — import must not be captured as a flow id.
  app.post('/api/v1/flows/import', requireBridgeAuth, async (req, res) => {
    return runFlowPropose(req, res, 'import');
  });

  app.post('/api/v1/flows', requireBridgeAuth, async (req, res) => {
    return runFlowPropose(req, res, 'new');
  });

  app.post('/api/v1/flows/:id/proposals', requireBridgeAuth, async (req, res) => {
    const flowId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    return runFlowPropose(req, res, 'edit', { flowId });
  });
}
