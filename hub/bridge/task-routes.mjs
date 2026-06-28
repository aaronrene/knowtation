/**
 * Hosted bridge REST routes for task read + write propose (Phase 2G hosted parity).
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md
 * @see docs/TASK-WRITE-PROPOSAL-CONTRACT-2G-d.md
 */

import { handleTaskListRequest, handleTaskGetRequest } from '../../lib/task/task-handlers.mjs';
import {
  handleTaskProposeRequest,
  handleTaskLoopProposeRequest,
  handleTaskInstanceMaterializeRequest,
} from '../../lib/task/task-write.mjs';
import {
  handleTaskLoopListRequest,
  handleTaskLoopGetRequest,
} from '../../lib/task/task-loop-handlers.mjs';
import { handleLoopPassAuditAppendRequest } from '../../lib/task/loop-pass-audit.mjs';
import { createTaskProposalOnCanister, applyApprovedTaskProposalFromCanister } from '../../lib/task/task-hosted-proposal.mjs';
import { resolveStarterTasksDir } from '../../lib/task/task-store.mjs';
import {
  resolveStarterTaskLoopsDir,
  resolveStarterOrchestratorGraphsDir,
  resolveStarterLoopInstancesDir,
} from '../../lib/task/task-loop-store.mjs';
import { withLoopPassAuditBlobSync } from './loop-pass-audit-blob-store.mjs';
import { persistExternalProtocolStoresToBlob } from './external-agent-blob-store.mjs';

const BRIDGE_STARTER_TASKS_DIR = resolveStarterTasksDir(import.meta.url);
const BRIDGE_STARTER_LOOPS_DIR = resolveStarterTaskLoopsDir(import.meta.url);
const BRIDGE_STARTER_GRAPHS_DIR = resolveStarterOrchestratorGraphsDir(import.meta.url);
const BRIDGE_STARTER_INSTANCES_DIR = resolveStarterLoopInstancesDir(import.meta.url);

/**
 * Map bridge role to task handler role (member → editor, matching self-hosted hub/server.mjs).
 *
 * @param {string} role
 * @returns {string}
 */
export function bridgeTaskHandlerRole(role) {
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
export function registerBridgeTaskRoutes(app, deps) {
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
  async function taskHandlerContext(req) {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return hctx;
    const roles = await loadRoles(req.blobStore);
    const role = bridgeTaskHandlerRole(effectiveRole(req.uid, roles));
    return { ok: true, hctx, role };
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
      return createTaskProposalOnCanister({
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
    const e = err && typeof err === 'object' ? /** @type {{ status?: number, code?: string, message?: string }} */ (err) : {};
    const status = typeof e.status === 'number' ? e.status : 500;
    const code = typeof e.code === 'string' ? e.code : 'RUNTIME_ERROR';
    const message = typeof e.message === 'string' ? e.message : String(err);
    return res.status(status).json({ error: message, code });
  }

  app.get('/api/v1/tasks', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const limitRaw = req.query.limit;
    let limit;
    if (limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '') {
      limit = parseInt(String(limitRaw), 10);
    }

    const result = handleTaskListRequest({
      dataDir,
      vaultId: ctx.hctx.vaultId,
      userId: req.uid,
      role: ctx.role,
      starterDir: BRIDGE_STARTER_TASKS_DIR,
      scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
      workspace_id: typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
      limit,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.get('/api/v1/tasks/:id', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const taskId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const result = handleTaskGetRequest({
      dataDir,
      vaultId: ctx.hctx.vaultId,
      taskId,
      userId: req.uid,
      role: ctx.role,
      starterDir: BRIDGE_STARTER_TASKS_DIR,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.get('/api/v1/task-loops', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const limitRaw = req.query.limit;
    let limit;
    if (limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '') {
      limit = parseInt(String(limitRaw), 10);
    }

    const result = handleTaskLoopListRequest({
      dataDir,
      vaultId: ctx.hctx.vaultId,
      userId: req.uid,
      role: ctx.role,
      starterDir: BRIDGE_STARTER_LOOPS_DIR,
      graphsDir: BRIDGE_STARTER_GRAPHS_DIR,
      instancesDir: BRIDGE_STARTER_INSTANCES_DIR,
      scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
      workspace_id: typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
      limit,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.get('/api/v1/task-loops/:loop_id', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const loopId =
      typeof req.params.loop_id === 'string' ? decodeURIComponent(req.params.loop_id).trim() : '';
    const result = handleTaskLoopGetRequest({
      dataDir,
      vaultId: ctx.hctx.vaultId,
      loopId,
      userId: req.uid,
      role: ctx.role,
      starterDir: BRIDGE_STARTER_LOOPS_DIR,
      graphsDir: BRIDGE_STARTER_GRAPHS_DIR,
      instancesDir: BRIDGE_STARTER_INSTANCES_DIR,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  });

  app.post('/api/v1/loop-pass-audit', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await withLoopPassAuditBlobSync({
      blobStore: req.blobStore ?? null,
      dataDir,
      run: () =>
        handleLoopPassAuditAppendRequest({
          dataDir,
          vaultId: hctx.vaultId,
          body,
        }),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(result.idempotent ? 200 : 201).json(result.payload);
  });

  app.post('/api/v1/tasks/proposals', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const proposalKind =
      typeof body.proposal_kind === 'string' && body.proposal_kind.trim()
        ? body.proposal_kind.trim()
        : 'task_create';
    try {
      const result = await handleTaskProposeRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        proposalKind,
        body,
        intent: body.intent,
        starterDir: BRIDGE_STARTER_TASKS_DIR,
        createProposal: hostedCreateProposal({
          effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
          actorUid: req.uid,
          vaultId: ctx.hctx.vaultId,
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

  app.post('/api/v1/task-loops/proposals', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const proposalKind =
      typeof body.proposal_kind === 'string' && body.proposal_kind.trim()
        ? body.proposal_kind.trim()
        : 'task_loop_create';
    try {
      const result = await handleTaskLoopProposeRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        proposalKind,
        body,
        intent: body.intent,
        starterDir: BRIDGE_STARTER_TASKS_DIR,
        createProposal: hostedCreateProposal({
          effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
          actorUid: req.uid,
          vaultId: ctx.hctx.vaultId,
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

  app.post('/api/v1/task-loops/:loop_id/instances/proposals', requireBridgeAuth, async (req, res) => {
    const ctx = await taskHandlerContext(req);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const loopId =
      typeof req.params.loop_id === 'string' ? decodeURIComponent(req.params.loop_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await handleTaskInstanceMaterializeRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        loopId,
        body: { ...body, loop_id: loopId },
        intent: body.intent,
        starterDir: BRIDGE_STARTER_TASKS_DIR,
        createProposal: hostedCreateProposal({
          effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
          actorUid: req.uid,
          vaultId: ctx.hctx.vaultId,
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

  app.post('/api/v1/tasks/proposals/:proposal_id/apply-approved', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });

    const proposalId =
      typeof req.params.proposal_id === 'string' ? decodeURIComponent(req.params.proposal_id).trim() : '';
    if (!proposalId) {
      return res.status(400).json({ error: 'proposal_id required', code: 'BAD_REQUEST' });
    }

    const result = await applyApprovedTaskProposalFromCanister({
      dataDir,
      canisterUrl,
      headers: canisterHeaders({
        'X-User-Id': hctx.effectiveCanisterUid,
        'X-Actor-Id': req.uid,
        'X-Vault-Id': hctx.vaultId,
      }),
      proposalId,
      requireApproved: true,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    await persistExternalProtocolStoresToBlob(req.blobStore ?? null, dataDir);
    return res.json(result.payload);
  });
}
