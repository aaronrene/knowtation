/**
 * Hosted bridge REST routes for Flow capture flywheel
 * (FLOW-CAPTURE-LIVE-KN-b — FCL-C10 parity with FLOW-WRITE-LIVE-GATEWAY-PROXY).
 *
 * Gated by FLOW_CAPTURE_DETECTION_ENABLED / FLOW_CAPTURE_WRITES_ENABLED
 * (both default OFF → empty observe / 403 FLOW_CAPTURE_*_DISABLED).
 * Does NOT flip those envs. Does NOT admit T5 self-apply for flow_capture.
 *
 * Every mutating route runs inside withExternalProtocolBlobSync and every read
 * hydrates from Blobs first: hosted Netlify lambdas have ephemeral DATA_DIR, so
 * a candidate written by observe/propose on one instance must survive to the
 * approve-time apply on another (CAPTURE-STORE-BLOB-PERSIST fix — without this,
 * apply refuses with FLOW_CANDIDATE_NOT_PROMOTABLE once the warm lambda recycles).
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
import { applyApprovedCaptureProposalFromCanister } from '../../lib/flow/flow-capture-hosted-apply.mjs';
import { handleFlowListRequest, handleFlowGetRequest } from '../../lib/flow/flow-handlers.mjs';
import {
  withExternalProtocolBlobSync,
  hydrateExternalProtocolStoresFromBlob,
} from './external-agent-blob-store.mjs';
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
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowCaptureObserveRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            sessionMeta: body,
            includeLowConfidence: body.include_low_confidence === true,
            harness: body.harness,
          }),
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
      await hydrateExternalProtocolStoresFromBlob(req.blobStore ?? null, dataDir);
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
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowCaptureProposeRequest({
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
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowCaptureDismissRequest({
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

  // Hub-complete capture apply (CAPTURE-HOSTED-APPLY-KN-b / CHA-C2).
  // Called by the gateway post-approve hook; also re-callable by ops after fixing
  // store state while the proposal is still `approved` (CHA-C11 recovery).
  // withExternalProtocolBlobSync hydrates hub_flow_store.json before precheck so a
  // cold lambda sees pending_review candidates (CHA-C3) and persists after apply.
  app.post(
    '/api/v1/flows/capture/proposals/:proposal_id/apply-approved',
    requireBridgeAuth,
    async (req, res) => {
      const hctx = await resolveHostedBridgeContext(req, req.uid);
      if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });

      const proposalId =
        typeof req.params.proposal_id === 'string'
          ? decodeURIComponent(req.params.proposal_id).trim()
          : '';
      if (!proposalId) {
        return res.status(400).json({ error: 'proposal_id required', code: 'BAD_REQUEST' });
      }

      try {
        const result = await withExternalProtocolBlobSync({
          blobStore: req.blobStore ?? null,
          dataDir,
          run: () =>
            applyApprovedCaptureProposalFromCanister({
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
      } catch (err) {
        return sendRouteError(res, err);
      }
    },
  );

  // Hosted Flow list/get exposure (CHA-C5) — same handlers as self-hosted hub/server.mjs
  // so a promote apply is observable via Scooling listFlows. Blob hydrate before read.
  app.get('/api/v1/flows', requireBridgeAuth, async (req, res) => {
    const ctx = await captureHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    try {
      await hydrateExternalProtocolStoresFromBlob(req.blobStore ?? null, dataDir);
      const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
      const result = handleFlowListRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
        tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
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

  // MUST stay registered after GET /api/v1/flows/candidates (above) so 'candidates'
  // is never treated as a flow id — CHA-C5 static-path ordering.
  app.get('/api/v1/flows/:id', requireBridgeAuth, async (req, res) => {
    const ctx = await captureHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const flowId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    try {
      await hydrateExternalProtocolStoresFromBlob(req.blobStore ?? null, dataDir);
      const result = handleFlowGetRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        flowId,
        userId: req.uid,
        role: ctx.role,
        version: typeof req.query.version === 'string' ? req.query.version : undefined,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });
}
