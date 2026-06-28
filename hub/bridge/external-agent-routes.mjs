/**
 * Hosted bridge REST routes for external agent protocol.
 */

import {
  handleGetTasks,
  handleClaimTask,
  handleCompleteTask,
  handleNeedsInputTask,
  handleHeartbeatTask,
} from '../../lib/agent/external-agent-protocol.mjs';
import { withExternalProtocolBlobSync } from './external-agent-blob-store.mjs';

const PROTOCOL_ERRORS = {
  task_not_claimable: { status: 409, message: "Task is not in a claimable state" },
  task_already_claimed: { status: 409, message: "Task was claimed by another agent" },
  assignee_mismatch: { status: 403, message: "Caller is not the assignee of this task" },
  lease_expired: { status: 410, message: "Claim lease has expired" },
  delegation_revoked: { status: 403, message: "Delegation grant has been revoked" },
  delegation_chain_invalid: { status: 403, message: "Delegation chain failed validation" },
  delegation_task_pin_mismatch: { status: 403, message: "Grant does not pin this task" },
  boundary_violation_prevented: { status: 422, message: "Action would violate the task boundary policy" },
  rate_limited: { status: 429, message: "Rate limit exceeded" },
  vault_mismatch: { status: 403, message: "Vault identifier mismatch" },
  scope_ceiling_exceeded: { status: 403, message: "Scope ceiling exceeded for this provider kind" },
  idempotency_key_conflict: { status: 409, message: "Idempotency key conflicts with a prior mutation" },
  provider_session_stale: { status: 401, message: "Provider session is stale" },
  receipt_content_rejected: { status: 400, message: "Receipt content failed critical validation" },
  external_protocol_not_authorized: { status: 501, message: "External agent protocol is not enabled" },
  invalid_idempotency_key: { status: 400, message: "Idempotency key missing or invalid" },
  invalid_request: { status: 400, message: "Request body failed validation" },
};

/**
 * @param {import('express').Response} res
 * @param {string} code
 */
function sendExternalProtocolError(res, code) {
  const err = PROTOCOL_ERRORS[code] || PROTOCOL_ERRORS.invalid_request;
  return res.status(err.status).json({ code, error: err.message });
}

/**
 * @param {import('express').Response} res
 * @param {{ ok: boolean, status?: number, code?: string, payload?: unknown } & Record<string, unknown>} result
 * @param {number} [defaultStatus]
 */
function sendProtocolSuccess(res, result, defaultStatus = 200) {
  const status = typeof result.status === 'number' ? result.status : defaultStatus;
  if (result.payload !== undefined) {
    return res.status(status).json(result.payload);
  }
  const { ok: _ok, status: _status, code: _code, error: _error, payload: _payload, ...body } = result;
  return res.status(status).json(body);
}

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
 *     effectiveCanisterUid?: string,
 *     actorUid?: string,
 *   }>,
 * }} deps
 */
export function registerBridgeExternalAgentRoutes(app, deps) {
  const { dataDir, requireBridgeAuth, resolveHostedBridgeContext } = deps;

  /**
   * @param {import('express').Request} req
   */
  async function vaultContext(req) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    return hctx;
  }

  /**
   * @param {import('express').Request} req
   */
  function blobStoreFromReq(req) {
    return /** @type {{ blobStore?: import('./external-agent-blob-store.mjs').BlobStore | null }} */ (req).blobStore ?? null;
  }

  /**
   * @param {import('express').Request} req
   */
  function extractBearerToken(req) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }

  app.get('/api/v1/agent-protocol/tasks', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status || 403).json({ error: hctx.error, code: hctx.code });
    const bearerToken = extractBearerToken(req);

    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () => handleGetTasks({
          dataDir,
          vaultId: hctx.vaultId,
          userId: req.uid,
          bearerToken,
          query: req.query
        }),
      });

      if (!result.ok) {
        return sendExternalProtocolError(res, result.code);
      }
      return sendProtocolSuccess(res, result);
    } catch (err) {
      return res.status(500).json({ error: String(err), code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/agent-protocol/tasks/:taskId/claim', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status || 403).json({ error: hctx.error, code: hctx.code });
    const bearerToken = extractBearerToken(req);
    const taskId = req.params.taskId;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () => handleClaimTask({
          dataDir,
          vaultId: hctx.vaultId,
          userId: req.uid,
          bearerToken,
          taskId,
          body
        }),
      });

      if (!result.ok) {
        return sendExternalProtocolError(res, result.code);
      }
      return sendProtocolSuccess(res, result);
    } catch (err) {
      return res.status(500).json({ error: String(err), code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/agent-protocol/tasks/:taskId/complete', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status || 403).json({ error: hctx.error, code: hctx.code });
    const bearerToken = extractBearerToken(req);
    const taskId = req.params.taskId;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () => handleCompleteTask({
          dataDir,
          vaultId: hctx.vaultId,
          userId: req.uid,
          bearerToken,
          taskId,
          body
        }),
      });

      if (!result.ok) {
        return sendExternalProtocolError(res, result.code);
      }
      return sendProtocolSuccess(res, result);
    } catch (err) {
      return res.status(500).json({ error: String(err), code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/agent-protocol/tasks/:taskId/needs-input', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status || 403).json({ error: hctx.error, code: hctx.code });
    const bearerToken = extractBearerToken(req);
    const taskId = req.params.taskId;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () => handleNeedsInputTask({
          dataDir,
          vaultId: hctx.vaultId,
          userId: req.uid,
          bearerToken,
          taskId,
          body
        }),
      });

      if (!result.ok) {
        return sendExternalProtocolError(res, result.code);
      }
      return sendProtocolSuccess(res, result);
    } catch (err) {
      return res.status(500).json({ error: String(err), code: 'RUNTIME_ERROR' });
    }
  });

  app.post('/api/v1/agent-protocol/tasks/:taskId/heartbeat', requireBridgeAuth, async (req, res) => {
    const hctx = await vaultContext(req);
    if (!hctx.ok) return res.status(hctx.status || 403).json({ error: hctx.error, code: hctx.code });
    const bearerToken = extractBearerToken(req);
    const taskId = req.params.taskId;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    try {
      const result = await withExternalProtocolBlobSync({
        blobStore: blobStoreFromReq(req),
        dataDir,
        run: () => handleHeartbeatTask({
          dataDir,
          vaultId: hctx.vaultId,
          userId: req.uid,
          bearerToken,
          taskId,
          body
        }),
      });

      if (!result.ok) {
        return sendExternalProtocolError(res, result.code);
      }
      return sendProtocolSuccess(res, result);
    } catch (err) {
      return res.status(500).json({ error: String(err), code: 'RUNTIME_ERROR' });
    }
  });
}
