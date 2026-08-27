/**
 * Hosted bridge REST routes for agent delegation (Phase 7C-L1 hosted parity).
 *
 * L1b: identity/consent proposals POST to the canister (Hub-visible); approve apply
 * runs via POST …/delegation/proposals/:id/apply-approved (gateway hook after approve).
 *
 * @see docs/AGENT-DELEGATION-V0-SPEC.md §4
 */

import {
  handleAgentIdentityRegisterProposeRequest,
  handleAgentIdentityListRequest,
  handleDelegationConsentProposeRequest,
  handleDelegationConsentRevokeRequest,
  handleDelegationGrantMintRequest,
  handleDelegationGrantListRequest,
  handleDelegationGrantRevokeRequest,
  handleDelegationAuditAppendRequest,
  hashPrincipalRef,
} from '../../lib/agent/delegation.mjs';
import { createDelegationProposalOnCanister, applyApprovedDelegationProposalFromCanister } from '../../lib/agent/delegation-hosted-proposal.mjs';
import {
  createDelegationAuthorityStore,
  DELEGATION_ERROR_SCHEMA,
  DELEGATION_REQUEST_INVALID,
  DELEGATION_SESSION_REQUIRED,
  DELEGATION_HELPER_ACTOR_DENIED,
  DELEGATION_AUTHORITY_CONFLICT,
  DELEGATION_AUTHORITY_UNAVAILABLE,
  RETAIL_ACTOR_ID,
} from '../../lib/agent/delegation-authority-store.mjs';
import {
  hydrateDelegationStoresFromBlob,
  withDelegationBlobSync,
} from './delegation-blob-store.mjs';
import { verifyJwtWithSecretRotation, resolveSessionSecretPrevious } from '../lib/session-secret-rotation.mjs';
import { isSessionBoundActor, resolveActorTokenClass } from '../gateway/access-token-authz.mjs';

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
 * }} deps
 */
export function registerBridgeDelegationRoutes(app, deps) {
  const { dataDir, canisterUrl, canisterHeaders, requireBridgeAuth, resolveHostedBridgeContext } = deps;
  const sessionSecretPrevious = resolveSessionSecretPrevious();

  /**
   * @param {import('express').Request} req
   */
  async function vaultContext(req) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    return hctx;
  }

  /**
   * RHF-b-KN0 — generic Bridge grant mint rejects human session tokens before catalog/store work.
   *
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  function humanSessionTokenFromReq(req) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = process.env.SESSION_SECRET;
    if (!token || !secret) return false;
    const payload = verifyJwtWithSecretRotation(token, secret, sessionSecretPrevious);
    if (!payload) return false;
    const tokenClass = resolveActorTokenClass(payload);
    return tokenClass === 'session' || tokenClass === 'legacy_session';
  }

  /**
   * RHF-b-KN1 — renew-personal / helper-access / validate accept only type:session.
   *
   * @param {import('express').Request} req
   * @returns {{ ok: true, payload: object } | { ok: false, status: number, code: string, error: string }}
   */
  function requireStrictSessionToken(req) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = process.env.SESSION_SECRET;
    if (!token || !secret) {
      return { ok: false, status: 401, code: DELEGATION_SESSION_REQUIRED, error: 'Session required' };
    }
    const payload = verifyJwtWithSecretRotation(token, secret, sessionSecretPrevious);
    if (!payload || resolveActorTokenClass(payload) !== 'session') {
      return { ok: false, status: 401, code: DELEGATION_SESSION_REQUIRED, error: 'Session required' };
    }
    return { ok: true, payload };
  }

  /**
   * @param {import('express').Response} res
   * @param {{ status: number, code: string, error?: string }} result
   */
  function sendDelegationError(res, result) {
    return res.status(result.status).json({
      schema: DELEGATION_ERROR_SCHEMA,
      code: result.code,
      error: result.error || result.code,
    });
  }

  /**
   * @param {import('express').Request} req
   * @param {string} vaultId
   */
  function authorityStoreFor(req, vaultId) {
    return createDelegationAuthorityStore({
      dataDir,
      vaultId,
      blobStore: blobStoreFromReq(req),
      sessionSecret: process.env.SESSION_SECRET || '',
      sessionSecretPrevious,
      operatorAuthorizedMarker: false,
    });
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
    const payload = verifyJwtWithSecretRotation(token, secret, sessionSecretPrevious);
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
      return createDelegationProposalOnCanister({
        canisterUrl,
        dataDir,
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
   * @param {import('express').Request} req
   */
  function blobStoreFromReq(req) {
    return /** @type {{ blobStore?: import('./delegation-blob-store.mjs').BlobStore | null }} */ (req).blobStore ?? null;
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
    console.error('[bridge] delegation route error', { status, code, message });
    return res.status(status).json({ error: message, code });
  }

  app.post('/api/v1/agents/identities', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withDelegationBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () =>
          handleAgentIdentityRegisterProposeRequest({
            dataDir,
            vaultId: hctx.vaultId,
            userId: req.uid,
            kind: body.kind,
            agentId: body.agent_id,
            label: body.label,
            scopeCeiling: body.scope_ceiling,
            createProposal: hostedCreateProposal({
              effectiveCanisterUid: hctx.effectiveCanisterUid,
              actorUid: req.uid,
              vaultId: hctx.vaultId,
              sessionBound: sessionBoundFromReq(req),
            }),
          }),
      });
      if (!result.ok) {
        console.error('[bridge] POST /api/v1/agents/identities/propose', {
          status: result.status,
          code: result.code,
          error: result.error,
        });
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.get('/api/v1/agents/identities', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    await hydrateDelegationStoresFromBlob(blobStoreFromReq(req), dataDir);
    const result = handleAgentIdentityListRequest({
      dataDir,
      vaultId: hctx.vaultId,
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.post('/api/v1/delegation/consents', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) {
      console.error('[bridge] POST /api/v1/delegation/consents vault context denied', {
        status: hctx.status,
        code: hctx.code,
        error: hctx.error,
        actorUid: req.uid,
        vaultId: req.headers['x-vault-id'],
      });
      return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withDelegationBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () =>
          handleDelegationConsentProposeRequest({
            dataDir,
            vaultId: hctx.vaultId,
            userId: req.uid,
            delegateAgentId: body.delegate_agent_id,
            scope: body.scope,
            workspaceId: body.workspace_id,
            allowedFlowIds: body.allowed_flow_ids,
            allowedTaskKinds: body.allowed_task_kinds,
            allowedTaskIds: body.allowed_task_ids,
            expiresAt: body.expires_at,
            createProposal: hostedCreateProposal({
              effectiveCanisterUid: hctx.effectiveCanisterUid,
              actorUid: req.uid,
              vaultId: hctx.vaultId,
              sessionBound: sessionBoundFromReq(req),
            }),
          }),
      });
      if (!result.ok) {
        console.error('[bridge] POST /api/v1/delegation/consents', {
          status: result.status,
          code: result.code,
          error: result.error,
          vaultId: hctx.vaultId,
          actorUid: req.uid,
        });
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.post('/api/v1/delegation/proposals/:proposal_id/apply-approved', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const proposalId =
      typeof req.params.proposal_id === 'string' ? decodeURIComponent(req.params.proposal_id).trim() : '';
    if (!proposalId) {
      return res.status(400).json({ error: 'proposal_id required', code: 'BAD_REQUEST' });
    }
    const result = await withDelegationBlobSync({
      blobStore: blobStoreFromReq(req),
      dataDir,
      run: () =>
        applyApprovedDelegationProposalFromCanister({
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
  });

  app.delete('/api/v1/delegation/consents/:consent_id', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const consentId =
      typeof req.params.consent_id === 'string' ? decodeURIComponent(req.params.consent_id).trim() : '';
    const result = await withDelegationBlobSync({
      blobStore: blobStoreFromReq(req),
      dataDir,
      run: () =>
        handleDelegationConsentRevokeRequest({
          dataDir,
          vaultId: hctx.vaultId,
          consentId,
          userId: req.uid,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.post('/api/v1/delegation/grants', requireBridgeAuth, async (req, res) => {
    if (humanSessionTokenFromReq(req)) {
      return res.status(403).json({
        schema: 'knowtation.delegation_error/v1',
        code: 'DELEGATION_HELPER_ACTOR_DENIED',
        error: 'Generic grant mint is not available for session tokens',
      });
    }
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await withDelegationBlobSync({
      blobStore: blobStoreFromReq(req),
      dataDir,
      run: () =>
        handleDelegationGrantMintRequest({
          dataDir,
          vaultId: hctx.vaultId,
          consentId: body.consent_id,
          actorAgentId: body.actor_agent_id,
          taskRef: body.task_ref,
          runRef: body.run_ref,
          flowId: body.flow_id,
          flowVersion: body.flow_version,
          ttlSeconds: body.ttl_seconds,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  });

  app.get('/api/v1/delegation/grants', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    await hydrateDelegationStoresFromBlob(blobStoreFromReq(req), dataDir);
    const result = handleDelegationGrantListRequest({
      dataDir,
      vaultId: hctx.vaultId,
      actorAgentId: typeof req.query.actor_agent_id === 'string' ? req.query.actor_agent_id : undefined,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.delete('/api/v1/delegation/grants/:grant_id', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const grantId =
      typeof req.params.grant_id === 'string' ? decodeURIComponent(req.params.grant_id).trim() : '';
    const result = await withDelegationBlobSync({
      blobStore: blobStoreFromReq(req),
      dataDir,
      run: () =>
        handleDelegationGrantRevokeRequest({
          dataDir,
          vaultId: hctx.vaultId,
          grantId,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.post('/api/v1/delegation/audit', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const principalRef =
      typeof body.principal_ref === 'string' && body.principal_ref.trim()
        ? body.principal_ref.trim()
        : hashPrincipalRef(req.uid);
    const result = await withDelegationBlobSync({
      blobStore: blobStoreFromReq(req),
      dataDir,
      run: () =>
        handleDelegationAuditAppendRequest({
          dataDir,
          vaultId: hctx.vaultId,
          grantId: body.grant_id,
          actorAgentId: body.actor_agent_id,
          principalRef,
          action: body.action,
          evidenceRefs: body.evidence_refs,
          taskRef: body.task_ref,
          runRef: body.run_ref,
          flowId: body.flow_id,
          flowVersion: body.flow_version,
          stepId: body.step_id,
          executionLocation: body.execution_location,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  });

  /**
   * @param {unknown} hctx
   * @returns {{ status: number, code: string, error: string }}
   */
  function mapVaultDenial(hctx) {
    const status = typeof hctx?.status === 'number' ? hctx.status : 503;
    if (status === 401) {
      return { status: 401, code: DELEGATION_SESSION_REQUIRED, error: 'Session required' };
    }
    if (status === 403) {
      return { status: 403, code: DELEGATION_HELPER_ACTOR_DENIED, error: 'Helper actor denied' };
    }
    if (status === 409) {
      return { status: 409, code: DELEGATION_AUTHORITY_CONFLICT, error: 'Authority conflict' };
    }
    return {
      status: 503,
      code: DELEGATION_AUTHORITY_UNAVAILABLE,
      error: 'Authority unavailable',
    };
  }

  /**
   * Session-first auth for KN1 retail routes (allowlisted 401 before bridge UNAUTHORIZED).
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  function requireRetailSession(req, res, next) {
    const session = requireStrictSessionToken(req);
    if (!session.ok) return sendDelegationError(res, session);
    const sub = typeof session.payload.sub === 'string' ? session.payload.sub.trim() : '';
    if (!sub) {
      return sendDelegationError(res, {
        status: 401,
        code: DELEGATION_SESSION_REQUIRED,
        error: 'Session required',
      });
    }
    req.uid = sub;
    return next();
  }

  /**
   * @param {import('express').Response} res
   * @param {unknown} err
   */
  function sendAuthorityUnavailable(res, err) {
    console.error('[bridge] delegation authority route error', {
      code: DELEGATION_AUTHORITY_UNAVAILABLE,
      message: err && typeof err === 'object' && 'message' in err ? String(err.message) : 'error',
    });
    return res.status(503).json({
      schema: DELEGATION_ERROR_SCHEMA,
      code: DELEGATION_AUTHORITY_UNAVAILABLE,
      error: 'Authority unavailable',
    });
  }

  // --- RHF-b-KN1 retail authority routes (session-only; envelope CAS) ---

  app.post('/api/v1/delegation/grants/renew-personal', requireRetailSession, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return sendDelegationError(res, mapVaultDenial(hctx));
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor =
      typeof body.actor_agent_id === 'string' ? body.actor_agent_id.trim() : RETAIL_ACTOR_ID;
    if (actor !== RETAIL_ACTOR_ID) {
      return sendDelegationError(res, {
        status: 403,
        code: DELEGATION_HELPER_ACTOR_DENIED,
        error: 'Helper actor denied',
      });
    }
    try {
      const store = authorityStoreFor(req, hctx.vaultId);
      const result = await store.renewPersonal(req.uid, actor);
      if (!result.ok) return sendDelegationError(res, result);
      res.set('Cache-Control', 'no-store');
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendAuthorityUnavailable(res, err);
    }
  });

  app.post('/api/v1/delegation/grants/validate', requireRetailSession, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return sendDelegationError(res, mapVaultDenial(hctx));
    const bearerHeader = req.headers['x-delegation-bearer'];
    const actorHeader = req.headers['x-delegation-actor'];
    const visitHeader = req.headers['x-retail-visit'];
    const bearer = typeof bearerHeader === 'string' ? bearerHeader.trim() : '';
    const actor = typeof actorHeader === 'string' ? actorHeader.trim() : '';
    const visitHandle = typeof visitHeader === 'string' ? visitHeader.trim() : '';
    if (!bearer || !actor || !visitHandle) {
      return sendDelegationError(res, {
        status: 400,
        code: DELEGATION_REQUEST_INVALID,
        error: 'Invalid validation request',
      });
    }
    try {
      const store = authorityStoreFor(req, hctx.vaultId);
      const result = await store.validateAndConsume({
        uid: req.uid,
        bearer,
        actorId: actor,
        visitHandle,
      });
      if (!result.ok) return sendDelegationError(res, result);
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result.payload);
    } catch (err) {
      return sendAuthorityUnavailable(res, err);
    }
  });

  app.get('/api/v1/delegation/helper-access', requireRetailSession, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return sendDelegationError(res, mapVaultDenial(hctx));
    const actor =
      typeof req.query.actor_agent_id === 'string' ? req.query.actor_agent_id.trim() : '';
    if (!actor) {
      return sendDelegationError(res, {
        status: 400,
        code: DELEGATION_REQUEST_INVALID,
        error: 'actor_agent_id required',
      });
    }
    try {
      const store = authorityStoreFor(req, hctx.vaultId);
      const result = await store.readHelperAccess(req.uid, actor);
      if (!result.ok) return sendDelegationError(res, result);
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result.payload);
    } catch (err) {
      return sendAuthorityUnavailable(res, err);
    }
  });
}
