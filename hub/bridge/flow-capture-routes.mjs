/**
 * Hosted bridge REST routes for Flow capture flywheel
 * (FLOW-CAPTURE-LIVE-KN-b — FCL-C10 parity with FLOW-WRITE-LIVE-GATEWAY-PROXY).
 *
 * Gated by FLOW_CAPTURE_DETECTION_ENABLED / FLOW_CAPTURE_WRITES_ENABLED
 * (both default OFF → empty observe / 403 FLOW_CAPTURE_*_DISABLED).
 * Does NOT flip those envs. Does NOT admit T5 self-apply for flow_capture.
 *
 * @see docs/FLOW-CAPTURE-FLYWHEEL-CONTRACT-7A-L4.md
 * @see hub/bridge/flow-routes.mjs
 */

import {
  handleFlowCaptureObserveRequest,
  handleFlowCaptureListRequest,
  handleFlowCaptureProposeRequest,
  handleFlowCaptureDismissRequest,
} from '../../lib/flow/flow-capture.mjs';
import { createCaptureProposalOnCanister } from '../../lib/flow/flow-capture-hosted-proposal.mjs';
import { isSessionBoundActor } from '../gateway/access-token-authz.mjs';
import jwt from 'jsonwebtoken';

/**
 * Map bridge role to capture handler role (member → editor, matching self-hosted hub).
 *
 * @param {string} role
 * @returns {string}
 */
export function bridgeFlowCaptureHandlerRole(role) {
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
export function registerBridgeFlowCaptureRoutes(app, deps) {
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
  async function captureHandlerContext(req) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return hctx;
    const roles = await loadRoles(req.blobStore);
    const role = bridgeFlowCaptureHandlerRole(effectiveRole(req.uid, roles));
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
      return createCaptureProposalOnCanister({
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

  app.post('/api/v1/flows/capture/observe', requireBridgeAuth, async (req, res) => {
    const ctx = await captureHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = handleFlowCaptureObserveRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        sessionMeta: body,
        includeLowConfidence: body.include_low_confidence === true,
        harness: body.harness,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.get('/api/v1/flows/candidates', requireBridgeAuth, async (req, res) => {
    const ctx = await captureHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
    try {
      const result = handleFlowCaptureListRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
        includeLowConfidence: req.query.include_low_confidence === 'true',
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post('/api/v1/flows/candidates/:id/propose', requireBridgeAuth, async (req, res) => {
    const ctx = await captureHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const candidateId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await handleFlowCaptureProposeRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        candidateId,
        confirmedScope: body.confirmed_scope,
        scopeWidenAcknowledged: body.scope_widen_acknowledged === true,
        allowLowConfidence: body.allow_low_confidence === true,
        forceNewFlow: body.force_new_flow === true,
        mergeIntoFlowId: body.merge_into_flow_id,
        intent: body.intent,
        createProposal: hostedCreateProposal({
          effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
          actorUid: req.uid,
          vaultId: ctx.hctx.vaultId,
          sessionBound: sessionBoundFromReq(req),
        }),
      });
      if (!result.ok) {
        const payload = { error: result.error, code: result.code };
        if (result.merge_into_flow_id) payload.merge_into_flow_id = result.merge_into_flow_id;
        if (result.overlap != null) payload.overlap = result.overlap;
        return res.status(result.status).json(payload);
      }
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post('/api/v1/flows/candidates/:id/dismiss', requireBridgeAuth, async (req, res) => {
    const ctx = await captureHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const candidateId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await handleFlowCaptureDismissRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        candidateId,
        intent: body.intent,
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
  });
}
