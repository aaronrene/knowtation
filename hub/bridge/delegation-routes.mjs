/**
 * Hosted bridge REST routes for agent delegation (Phase 7C-L1 hosted parity).
 *
 * Mirrors self-hosted `hub/server.mjs` delegation handlers against bridge `DATA_DIR`
 * with JWT auth and hosted vault context resolution.
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
import { createProposal } from '../proposals-store.mjs';

/**
 * @param {import('express').Express} app
 * @param {{
 *   dataDir: string,
 *   requireBridgeAuth: import('express').RequestHandler,
 *   resolveHostedBridgeContext: (req: import('express').Request, actorUid: string) => Promise<{
 *     ok: boolean,
 *     status?: number,
 *     error?: string,
 *     code?: string,
 *     vaultId?: string,
 *   }>,
 * }} deps
 */
export function registerBridgeDelegationRoutes(app, deps) {
  const { dataDir, requireBridgeAuth, resolveHostedBridgeContext } = deps;

  /**
   * @param {import('express').Request} req
   */
  async function vaultContext(req) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    return hctx;
  }

  app.post('/api/v1/agents/identities', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = handleAgentIdentityRegisterProposeRequest({
      dataDir,
      vaultId: hctx.vaultId,
      userId: req.uid,
      kind: body.kind,
      agentId: body.agent_id,
      label: body.label,
      scopeCeiling: body.scope_ceiling,
      createProposal,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  });

  app.get('/api/v1/agents/identities', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
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
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = handleDelegationConsentProposeRequest({
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
      createProposal,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  });

  app.delete('/api/v1/delegation/consents/:consent_id', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const consentId =
      typeof req.params.consent_id === 'string' ? decodeURIComponent(req.params.consent_id).trim() : '';
    const result = handleDelegationConsentRevokeRequest({
      dataDir,
      vaultId: hctx.vaultId,
      consentId,
      userId: req.uid,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.post('/api/v1/delegation/grants', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = handleDelegationGrantMintRequest({
      dataDir,
      vaultId: hctx.vaultId,
      consentId: body.consent_id,
      actorAgentId: body.actor_agent_id,
      taskRef: body.task_ref,
      runRef: body.run_ref,
      flowId: body.flow_id,
      flowVersion: body.flow_version,
      ttlSeconds: body.ttl_seconds,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  });

  app.get('/api/v1/delegation/grants', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });
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
    const result = handleDelegationGrantRevokeRequest({
      dataDir,
      vaultId: hctx.vaultId,
      grantId,
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
    const result = handleDelegationAuditAppendRequest({
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
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  });
}
