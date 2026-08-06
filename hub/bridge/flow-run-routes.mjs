/**
 * Hosted bridge REST routes for Flow run / consent surfaces
 * (SITE-FINISH-FLOW-RUN-KN-b — §FR.0.4 parity with FLOW-CAPTURE-LIVE-KN-b).
 *
 * Gated by FLOW_RUN_WRITES_ENABLED / FLOW_AUTOMATABLE_EXECUTION_ENABLED
 * (both default OFF → 403 FLOW_RUN_WRITES_DISABLED /
 * FLOW_AUTOMATABLE_EXECUTION_DISABLED). Does NOT flip those envs.
 *
 * Mutating routes and list/get reads use withExternalProtocolBlobSync /
 * hydrateExternalProtocolStoresFromBlob so hub_flow_store.json survives
 * Netlify lambda recycle (runs[] already merged in mergeFlowStoreJson).
 * Consent ledger files stay process-local this slice (ops choice).
 *
 * @see ~/scooling/docs/SITE-FINISH-FLOW-RUN-FREEZE.md §FR.0.4
 * @see hub/bridge/flow-capture-routes.mjs
 * @see lib/flow/flow-execution.mjs
 */

import {
  handleFlowRunListRequest,
  handleFlowRunGetRequest,
  handleFlowRunStartRequest,
  handleFlowRunAdvanceRequest,
  handleFlowRunEvidenceRequest,
  handleFlowRunExecuteAutomatableRequest,
  handleFlowRunSubmitReviewRequest,
  handleFlowExecutionConsentMintRequest,
} from '../../lib/flow/flow-execution.mjs';
import { FLOW_PROPOSAL_SOURCE } from '../../lib/flow/flow-authoring.mjs';
import {
  withExternalProtocolBlobSync,
  hydrateExternalProtocolStoresFromBlob,
} from './external-agent-blob-store.mjs';
import { isSessionBoundActor } from '../gateway/access-token-authz.mjs';
import { verifyJwtWithSecretRotation } from '../lib/session-secret-rotation.mjs';

/**
 * Map bridge role to flow-run handler role (member → editor, matching self-hosted hub).
 *
 * @param {string} role
 * @returns {string}
 */
export function bridgeFlowRunHandlerRole(role) {
  const r = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return r === 'member' || !r ? 'editor' : r;
}

/**
 * POST a run-outcome proposal to the canister (hosted submit-review path).
 *
 * @param {{
 *   canisterUrl: string,
 *   headers: Record<string, string>,
 *   input: {
 *     path?: string,
 *     body?: string,
 *     intent?: string,
 *     frontmatter?: Record<string, unknown>,
 *     external_ref?: string,
 *     review_queue?: string,
 *     source?: string,
 *     vault_id?: string,
 *     proposed_by?: string,
 *   },
 * }} opts
 * @returns {Promise<{ proposal_id: string }>}
 */
export async function createRunOutcomeProposalOnCanister(opts) {
  const base = String(opts.canisterUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CANISTER_URL required for hosted run outcome proposals');
    err.status = 503;
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  const input = opts.input;
  const frontmatter = {
    ...(input.frontmatter && typeof input.frontmatter === 'object' ? input.frontmatter : {}),
    knowtation_proposal_source: FLOW_PROPOSAL_SOURCE,
  };
  const path =
    typeof input.path === 'string' && input.path.trim()
      ? input.path.trim()
      : `inbox/flow-run-outcome-${Date.now()}.md`;

  /** @type {Record<string, unknown>} */
  const payload = {
    path,
    body: input.body ?? '',
    intent: input.intent ?? '',
    frontmatter,
  };
  if (input.external_ref) payload.external_ref = input.external_ref;
  if (input.review_queue) payload.review_queue = input.review_queue;

  const res = await fetch(`${base}/api/v1/proposals`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = new Error(
      typeof json.error === 'string' ? json.error : text || `Canister proposal create ${res.status}`,
    );
    err.status = res.status;
    err.code = typeof json.code === 'string' ? json.code : 'UPSTREAM_ERROR';
    throw err;
  }

  const proposalId = typeof json.proposal_id === 'string' ? json.proposal_id : '';
  if (!proposalId) {
    const err = new Error('Canister proposal create missing proposal_id');
    err.status = 502;
    err.code = 'BAD_GATEWAY';
    throw err;
  }

  return { proposal_id: proposalId };
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
export function registerBridgeFlowRunRoutes(app, deps) {
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
  async function runHandlerContext(req) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return hctx;
    const roles = await loadRoles(req.blobStore);
    const role = bridgeFlowRunHandlerRole(effectiveRole(req.uid, roles));
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
   * }} ctx
   */
  function hostedCreateProposal(ctx) {
    return async function createProposal(_dataDir, input) {
      return createRunOutcomeProposalOnCanister({
        canisterUrl,
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

  // Static /flow-runs before /flows/:id/runs so "flow-runs" is never a flow id.
  app.get('/api/v1/flow-runs/:run_id', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const runId =
      typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
    try {
      await hydrateExternalProtocolStoresFromBlob(req.blobStore ?? null, dataDir);
      const result = handleFlowRunGetRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        runId,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.get('/api/v1/flows/:id/runs', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const flowId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    try {
      await hydrateExternalProtocolStoresFromBlob(req.blobStore ?? null, dataDir);
      const result = handleFlowRunListRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        flowId,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post('/api/v1/flows/:id/runs', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const flowId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowRunStartRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            flowId,
            flowVersion: body.flow_version,
            taskRef: body.task_ref,
            externalRef: body.external_ref,
            harness: 'hub',
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

  app.post('/api/v1/flows/:id/runs/:run_id/advance', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const runId =
      typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowRunAdvanceRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            runId,
            stepId: body.step_id,
            toStatus: body.to_status,
            skipReason: body.skip_reason,
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

  app.post('/api/v1/flows/:id/runs/:run_id/evidence', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const runId =
      typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowRunEvidenceRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            runId,
            stepId: body.step_id,
            evidenceRef: body.evidence_ref,
            pointerKind: body.pointer_kind,
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

  app.post(
    '/api/v1/flows/:id/runs/:run_id/execute-automatable',
    requireBridgeAuth,
    async (req, res) => {
      const ctx = await runHandlerContext(req);
      if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

      const runId =
        typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      try {
        const result = await withExternalProtocolBlobSync({
          blobStore: req.blobStore ?? null,
          dataDir,
          run: () =>
            handleFlowRunExecuteAutomatableRequest({
              dataDir,
              vaultId: ctx.hctx.vaultId,
              userId: req.uid,
              role: ctx.role,
              runId,
              stepId: body.step_id,
              consentId: body.consent_id,
              modelLane: body.model_lane,
              dryRun: body.dry_run,
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

  app.post('/api/v1/flows/:id/runs/:run_id/submit-review', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const runId =
      typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowRunSubmitReviewRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            runId,
            intent: body.intent,
            createProposal: hostedCreateProposal({
              effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
              actorUid: req.uid,
              vaultId: ctx.hctx.vaultId,
            }),
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

  app.post('/api/v1/flows/:id/runs/:run_id/consent', requireBridgeAuth, async (req, res) => {
    const ctx = await runHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const runId =
      typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Consent ledger is process-local this slice; still blob-sync the run store
    // so unknown_run checks see hosted runs.
    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleFlowExecutionConsentMintRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            runId,
            allowedLanes: body.allowed_lanes,
            costCapUnits: body.cost_cap_units,
            ttlSeconds: body.ttl_seconds,
            actorLabel: sessionBoundFromReq(req) ? req.uid : undefined,
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
