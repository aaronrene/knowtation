/**
 * Phase C — Hub REST agent credential routes (Netlify-mounted).
 * Paths under api/v1/auth/agent/*
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import {
  AGENT_ACCESS_TTL_SECONDS,
  AGENT_ACCESS_TYPE,
  AGENT_ACCESS_TYP,
  AGENT_ACCESS_AUD,
  AGENT_CREDENTIAL_PREFIX,
  DEFAULT_AGENT_SCOPES,
  applyScopeCeiling,
  normalizeScopes,
  normalizeVaultIds,
} from '../lib/agent-credential-core.mjs';
import { createAgentCredentialStore } from './agent-credential-store.mjs';
import {
  isMcpAccessPayload,
  isAgentAccessPayload,
  resolveActorTokenClass,
} from './access-token-authz.mjs';

const exchangeBuckets = new Map();
const EXCHANGE_WINDOW_MS = 60 * 1000;
const EXCHANGE_MAX = 60;

/**
 * @param {string} key
 * @returns {boolean}
 */
function allowExchange(key) {
  const now = Date.now();
  let bucket = exchangeBuckets.get(key);
  if (!bucket || now - bucket.start > EXCHANGE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    exchangeBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= EXCHANGE_MAX;
}

/**
 * @param {{
 *   sessionSecret: string,
 *   getSessionSub: (req: import('express').Request) => string | null,
 *   getSessionPayload?: (req: import('express').Request) => object | null,
 *   grantedScopes: (sub: string) => string[],
 *   offlineLockedActive?: boolean,
 *   store?: ReturnType<typeof createAgentCredentialStore>,
 * }} opts
 */
export function createAgentCredentialRouter(opts) {
  const {
    sessionSecret,
    getSessionSub,
    getSessionPayload,
    grantedScopes,
    offlineLockedActive = false,
    store = createAgentCredentialStore(),
  } = opts;

  if (!sessionSecret) throw new Error('createAgentCredentialRouter requires sessionSecret');

  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  router.use((req, res, next) => {
    if (offlineLockedActive) {
      return res.status(503).json({
        error: 'Agent credentials unsupported while offline-locked',
        code: 'AGENT_CREDENTIALS_UNSUPPORTED_OFFLINE_LOCKED',
      });
    }
    return next();
  });

  function requireHumanSession(req, res) {
    const payload = typeof getSessionPayload === 'function' ? getSessionPayload(req) : null;
    const sub = getSessionSub(req);
    if (!sub) {
      res.status(401).json({ error: 'unauthorized', code: 'UNAUTHORIZED' });
      return null;
    }
    if (payload) {
      const cls = resolveActorTokenClass(payload);
      if (cls === 'mcp_access' || cls === 'agent_access' || isMcpAccessPayload(payload) || isAgentAccessPayload(payload)) {
        res.status(403).json({ error: 'session required', code: 'AGENT_MINT_SESSION_REQUIRED' });
        return null;
      }
    }
    return sub;
  }

  router.post('/credentials', async (req, res) => {
    const sub = requireHumanSession(req, res);
    if (!sub) return;
    try {
      const name = String(req.body?.name || '').trim();
      const vault_ids = normalizeVaultIds(req.body?.vault_ids ?? req.body?.vaultIds);
      let scopes = normalizeScopes(req.body?.scopes ?? [...DEFAULT_AGENT_SCOPES]);
      scopes = applyScopeCeiling(scopes, grantedScopes(sub));
      let ttlMs;
      if (req.body?.ttl_seconds != null || req.body?.ttlSeconds != null) {
        const sec = Number(req.body.ttl_seconds ?? req.body.ttlSeconds);
        if (!Number.isFinite(sec)) {
          return res.status(400).json({ error: 'invalid ttl_seconds', code: 'AGENT_TTL_INVALID' });
        }
        ttlMs = Math.floor(sec * 1000);
      }
      const minted = await store.mint({ sub, name, vault_ids, scopes, ttlMs });
      return res.status(201).json(minted);
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      if (code === 'AGENT_CREDENTIAL_LIMIT') {
        return res.status(409).json({ error: 'credential limit', code });
      }
      if (code.startsWith('AGENT_')) {
        return res.status(400).json({ error: e.message || 'bad request', code });
      }
      console.error('[agent-credentials] mint failed:', e && e.message ? e.message : e);
      return res.status(503).json({
        error: 'credential store unavailable',
        code: 'AGENT_CREDENTIAL_STORE_UNAVAILABLE',
      });
    }
  });

  router.get('/credentials', async (req, res) => {
    const sub = requireHumanSession(req, res);
    if (!sub) return;
    try {
      const credentials = await store.list(sub);
      return res.status(200).json({ credentials });
    } catch (e) {
      console.error('[agent-credentials] list failed:', e && e.message ? e.message : e);
      return res.status(503).json({
        error: 'credential store unavailable',
        code: 'AGENT_CREDENTIAL_STORE_UNAVAILABLE',
      });
    }
  });

  router.delete('/credentials/:id', async (req, res) => {
    const sub = requireHumanSession(req, res);
    if (!sub) return;
    try {
      await store.revoke(String(req.params.id || ''), sub);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[agent-credentials] revoke failed:', e && e.message ? e.message : e);
      return res.status(503).json({
        error: 'credential store unavailable',
        code: 'AGENT_CREDENTIAL_STORE_UNAVAILABLE',
      });
    }
  });

  router.post('/credentials/:id/rotate', async (req, res) => {
    const sub = requireHumanSession(req, res);
    if (!sub) return;
    try {
      const rotated = await store.rotate(String(req.params.id || ''), sub);
      return res.status(200).json(rotated);
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      if (code === 'AGENT_CREDENTIAL_NOT_FOUND' || code === 'AGENT_CREDENTIAL_EXPIRED') {
        return res.status(404).json({ error: e.message || 'not found', code });
      }
      console.error('[agent-credentials] rotate failed:', e && e.message ? e.message : e);
      return res.status(503).json({
        error: 'credential store unavailable',
        code: 'AGENT_CREDENTIAL_STORE_UNAVAILABLE',
      });
    }
  });

  router.post('/token', async (req, res) => {
    let presented = '';
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const raw = auth.slice(7).trim();
      if (raw.startsWith(AGENT_CREDENTIAL_PREFIX)) {
        presented = raw;
      } else {
        return res.status(401).json({ error: 'invalid credential', code: 'AGENT_CREDENTIAL_INVALID' });
      }
    }
    if (!presented) {
      presented = String(req.body?.credential || '').trim();
    }
    if (!presented.startsWith(AGENT_CREDENTIAL_PREFIX)) {
      return res.status(401).json({ error: 'invalid credential', code: 'AGENT_CREDENTIAL_INVALID' });
    }

    let result;
    try {
      result = await store.verify(presented);
    } catch (e) {
      console.error('[agent-credentials] verify failed:', e && e.message ? e.message : e);
      return res.status(503).json({
        error: 'credential store unavailable',
        code: 'AGENT_CREDENTIAL_STORE_UNAVAILABLE',
      });
    }
    if (!result.ok) {
      return res.status(401).json({ error: 'invalid credential', code: 'AGENT_CREDENTIAL_INVALID' });
    }
    if (!allowExchange(result.id)) {
      return res.status(429).json({ error: 'rate limited', code: 'AGENT_CREDENTIAL_RATE_LIMIT' });
    }

    const ceiling = grantedScopes(result.sub);
    let scopes;
    try {
      scopes = applyScopeCeiling(result.scopes, ceiling);
    } catch (_) {
      return res.status(401).json({ error: 'invalid credential', code: 'AGENT_CREDENTIAL_INVALID' });
    }

    const accessToken = jwt.sign(
      {
        sub: result.sub,
        type: AGENT_ACCESS_TYPE,
        typ: AGENT_ACCESS_TYP,
        aud: AGENT_ACCESS_AUD,
        scopes,
        vault_ids: result.vault_ids,
        cid: result.id,
        agent: String(result.name || '').slice(0, 128),
      },
      sessionSecret,
      {
        expiresIn: AGENT_ACCESS_TTL_SECONDS,
        header: { typ: AGENT_ACCESS_TYP },
      }
    );

    return res.status(200).json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: AGENT_ACCESS_TTL_SECONDS,
      scopes,
      vault_ids: result.vault_ids,
    });
  });

  return { router, store };
}
