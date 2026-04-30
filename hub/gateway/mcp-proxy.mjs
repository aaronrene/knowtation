/**
 * Issue #1 Phase D2 — MCP gateway proxy for hosted MCP.
 * Express router that handles /mcp with JWT auth, session pool, rate limiting, and cleanup.
 */

import { randomUUID } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHostedMcpServer } from './mcp-hosted-server.mjs';

const DEFAULT_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Default idle TTL for hosted MCP HTTP sessions (gateway RAM). Longer than the
 * historical 30m default so Cursor does not lose tools/resources after a coffee break.
 * Override with **`MCP_SESSION_TTL_MS`** (milliseconds), clamped 5m–24h.
 */
const DEFAULT_MCP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MIN_MCP_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_MCP_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Max concurrent MCP sessions per user id before the oldest is evicted.
 * Override with **`MCP_MAX_SESSIONS_PER_USER`**, clamped 2–20.
 */
const DEFAULT_MCP_MAX_SESSIONS_PER_USER = 8;
const MIN_MCP_MAX_SESSIONS_PER_USER = 2;
const MAX_MCP_MAX_SESSIONS_PER_USER = 20;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function parseMcpSessionTtlMs(env = process.env) {
  const raw = env.MCP_SESSION_TTL_MS;
  if (raw == null || String(raw).trim() === '') return DEFAULT_MCP_SESSION_TTL_MS;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_MCP_SESSION_TTL_MS;
  return Math.min(MAX_MCP_SESSION_TTL_MS, Math.max(MIN_MCP_SESSION_TTL_MS, n));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function parseMcpMaxSessionsPerUser(env = process.env) {
  const raw = env.MCP_MAX_SESSIONS_PER_USER;
  if (raw == null || String(raw).trim() === '') return DEFAULT_MCP_MAX_SESSIONS_PER_USER;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_MCP_MAX_SESSIONS_PER_USER;
  return Math.min(MAX_MCP_MAX_SESSIONS_PER_USER, Math.max(MIN_MCP_MAX_SESSIONS_PER_USER, n));
}

/**
 * @typedef {{
 *   transport: StreamableHTTPServerTransport,
 *   server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
 *   userId: string,
 *   vaultId: string,
 *   lastActive: number,
 * }} McpSession
 */

/**
 * Simple sliding-window rate limiter per user.
 */
function createRateLimiter(maxReqs = DEFAULT_RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  return (userId) => {
    const now = Date.now();
    const cutoff = now - windowMs;
    let userHits = hits.get(userId) || [];
    userHits = userHits.filter((t) => t > cutoff);
    if (userHits.length >= maxReqs) return false;
    userHits.push(now);
    hits.set(userId, userHits);
    return true;
  };
}

/**
 * Create the MCP proxy Express router.
 *
 * @param {{
 *   getUserId: (req: import('express').Request) => string | null,
 *   getHostedAccessContext: (req: import('express').Request) => Promise<Record<string, unknown> | null>,
 *   canisterUrl: string,
 *   canisterAuthSecret?: string,
 *   bridgeUrl: string,
 *   gatewayApiBaseUrl: (string|undefined) — public gateway base (no path), e.g. HUB_BASE_URL; enables hub_create_proposal.
 *   sessionSecret: string,
 *   rateLimit?: number,
 *   sessionTtlMs?: number,
 *   maxSessionsPerUser?: number,
 * }} deps
 * @returns {import('express').Router}
 */
export function createMcpProxyRouter(deps) {
  const {
    getUserId,
    getHostedAccessContext,
    canisterUrl,
    canisterAuthSecret,
    bridgeUrl,
    gatewayApiBaseUrl,
    rateLimit = DEFAULT_RATE_LIMIT,
    sessionTtlMs = parseMcpSessionTtlMs(),
    maxSessionsPerUser = parseMcpMaxSessionsPerUser(),
  } = deps;

  const router = express.Router();

  /** @type {Map<string, McpSession>} */
  const sessions = new Map();

  /** @type {Map<string, Set<string>>} */
  const userSessions = new Map();

  const checkRate = createRateLimiter(rateLimit);

  router.use((req, res, next) => {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Unauthorized' } });
    if (!checkRate(uid)) {
      return res.status(429).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Rate limit exceeded' } });
    }
    req.mcpUserId = uid;
    next();
  });

  async function getOrCreateSession(req, res) {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) {
      const existing = sessions.get(String(sessionId));
      if (existing && existing.userId === req.mcpUserId) {
        existing.lastActive = Date.now();
        return existing;
      }
    }

    const uid = req.mcpUserId;
    const userSessionIds = userSessions.get(uid) || new Set();
    if (userSessionIds.size >= maxSessionsPerUser) {
      let oldest = null;
      let oldestTime = Infinity;
      for (const sid of userSessionIds) {
        const s = sessions.get(sid);
        if (s && s.lastActive < oldestTime) {
          oldest = sid;
          oldestTime = s.lastActive;
        }
      }
      if (oldest) destroySession(oldest);
    }

    const ctx = await getHostedAccessContext(req);
    if (!ctx) {
      res.status(403).json({ jsonrpc: '2.0', error: { code: -32600, message: 'No hosted access' } });
      return null;
    }

    const vaultId = String(req.headers['x-vault-id'] || 'default');
    const role = ctx.role || 'viewer';
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    /** Match `gatewayProxyGetNotesList` / `proxyToCanister`: canister reads use effective workspace user when set. */
    const canisterUserId =
      typeof ctx.effective_canister_user_id === 'string' && ctx.effective_canister_user_id.trim() !== ''
        ? ctx.effective_canister_user_id.trim()
        : uid;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const session = {
          transport,
          server: mcpServer,
          userId: uid,
          vaultId,
          lastActive: Date.now(),
        };
        sessions.set(id, session);
        const set = userSessions.get(uid) || new Set();
        set.add(id);
        userSessions.set(uid, set);
      },
    });

    const mcpServer = createHostedMcpServer({
      userId: uid,
      canisterUserId,
      vaultId,
      role,
      token,
      canisterUrl,
      canisterAuthSecret: canisterAuthSecret || '',
      bridgeUrl,
      scope: ctx.scope || {},
      ...(gatewayApiBaseUrl && String(gatewayApiBaseUrl).trim()
        ? { gatewayApiBaseUrl: String(gatewayApiBaseUrl).trim().replace(/\/$/, '') }
        : {}),
    });

    await mcpServer.connect(transport);

    return { transport, server: mcpServer, userId: uid, vaultId, lastActive: Date.now(), _pending: true };
  }

  function destroySession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    try {
      session.transport.close?.();
    } catch (_) {}
    sessions.delete(sessionId);
    const set = userSessions.get(session.userId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) userSessions.delete(session.userId);
    }
  }

  router.post('/', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      const existing = sessionId ? sessions.get(String(sessionId)) : null;

      if (existing && existing.userId === req.mcpUserId) {
        existing.lastActive = Date.now();
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }

      const session = await getOrCreateSession(req, res);
      if (!session) return;
      await session.transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message || 'Internal error' } });
      }
    }
  });

  router.get('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId ? sessions.get(String(sessionId)) : null;
    if (!session || session.userId !== req.mcpUserId) {
      return res.status(404).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Session not found' } });
    }
    session.lastActive = Date.now();
    await session.transport.handleRequest(req, res, req.body);
  });

  router.delete('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) {
      const session = sessions.get(String(sessionId));
      if (session && session.userId === req.mcpUserId) {
        destroySession(String(sessionId));
      }
    }
    res.status(200).json({ ok: true });
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActive > sessionTtlMs) {
        destroySession(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanup.unref?.();

  router._sessions = sessions;
  router._userSessions = userSessions;
  router._destroySession = destroySession;
  router._cleanup = cleanup;

  return router;
}
