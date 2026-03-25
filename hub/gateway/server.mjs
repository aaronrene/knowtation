/**
 * Knowtation Hub Gateway — OAuth (Google/GitHub) + proxy to ICP canister with X-User-Id.
 * For hosted product: user logs in here; all /api/* requests are proxied to canister with proof.
 * Run: node server.mjs
 * Env: SESSION_SECRET, CANISTER_URL, HUB_BASE_URL; optional GOOGLE_*, GITHUB_*, HUB_UI_ORIGIN, GATEWAY_PORT.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { stripeWebhookHandler } from './billing-stripe.mjs';
import { handleBillingSummary } from './billing-http.mjs';
import { runBillingGate } from './billing-middleware.mjs';
import { mergeHostedNoteBodyForCanister, isPostApiV1Notes } from './apply-note-provenance.mjs';
import { deriveFacetsFromCanisterNotes, materializeListFrontmatter } from './note-facets.mjs';
import { applyGatewayCors } from './cors-middleware.mjs';
import { upstreamPathAndQuery, pathPartNoQuery, effectiveRequestPath } from './request-path.mjs';
import { applyScopeFilterToNotes } from '../lib/scope-filter.mjs';
import { filterUpstreamResponseHeadersForDecodedBody } from './upstream-response-headers.mjs';

// Safe when bundled (e.g. Netlify Functions CJS) where import.meta may be undefined
let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const PORT = parseInt(process.env.GATEWAY_PORT || process.env.PORT || '3340', 10);
const BASE_URL = process.env.HUB_BASE_URL || `http://localhost:${PORT}`;
const CANISTER_URL = (process.env.CANISTER_URL || '').replace(/\/$/, '');
const BRIDGE_URL = (process.env.BRIDGE_URL || '').replace(/\/$/, '');
if (BRIDGE_URL) {
  try {
    const u = new URL(BRIDGE_URL);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('BRIDGE_URL must use http: or https:');
    }
  } catch (e) {
    console.error(
      '[gateway] BRIDGE_URL must be an absolute URL with scheme (no path after host), e.g. https://your-bridge.netlify.app. Got:',
      JSON.stringify(BRIDGE_URL),
      e.message || e,
    );
    process.exit(1);
  }
}
const HUB_UI_ORIGIN = (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.HUB_JWT_SECRET;
const JWT_EXPIRY = process.env.HUB_JWT_EXPIRY || '7d';

// Optional: comma-separated list of user IDs (e.g. google:123,github:456) who get role admin on hosted. Others get member.
const HUB_ADMIN_USER_IDS = (process.env.HUB_ADMIN_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const adminUserIdsSet = new Set(HUB_ADMIN_USER_IDS);

function roleForSub(sub) {
  return sub && adminUserIdsSet.has(sub) ? 'admin' : 'member';
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/callback/google`,
      },
      (_accessToken, _refreshToken, profile, done) => {
        return done(null, { provider: 'google', id: profile.id, displayName: profile.displayName ?? '' });
      }
    )
  );
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/callback/github`,
      },
      (_accessToken, _refreshToken, profile, done) => {
        return done(null, { provider: 'github', id: profile.id, displayName: profile.displayName ?? profile.username ?? '' });
      }
    )
  );
}

function userId(user) {
  if (!user || !user.provider || !user.id) return null;
  return `${user.provider}:${user.id}`;
}

function issueToken(user) {
  const sub = userId(user);
  if (!sub) return null;
  const role = roleForSub(sub);
  return jwt.sign(
    {
      sub,
      provider: user.provider,
      id: user.id,
      name: user.displayName ?? '',
      role,
    },
    SESSION_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    return payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

const app = express();

// Netlify rewrites /* -> /.netlify/functions/gateway/:splat, so the function may receive
// a path like /.netlify/functions/gateway/api/v1/notes. Express would not match /api/v1/* routes.
const NETLIFY_GW_PREFIX = '/.netlify/functions/gateway';
app.use((req, _res, next) => {
  const raw = req.url || '/';
  const q = raw.indexOf('?');
  const pathPart = q >= 0 ? raw.slice(0, q) : raw;
  const queryPart = q >= 0 ? raw.slice(q) : '';
  if (pathPart === NETLIFY_GW_PREFIX || pathPart.startsWith(`${NETLIFY_GW_PREFIX}/`)) {
    const rest =
      pathPart === NETLIFY_GW_PREFIX ? '/' : pathPart.slice(NETLIFY_GW_PREFIX.length) || '/';
    const nextUrl = rest + queryPart;
    req.url = nextUrl;
    // Express may set originalUrl to the internal function path; keep it aligned with req.path.
    req.originalUrl = nextUrl;
    delete req._parsedUrl;
    delete req._parsedOriginalUrl;
  }
  next();
});

app.use(cookieParser());
app.post('/api/v1/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  stripeWebhookHandler(req, res);
});
app.use(express.json({ limit: '10mb' }));
app.use(passport.initialize());

// CORS: production MUST set HUB_CORS_ORIGIN (apex + www) for credentialed-style responses.
// If unset, we use * and omit Allow-Credentials — otherwise browsers block (* + credentials = Failed to fetch).
// See hub/gateway/cors-middleware.mjs and docs/CORS-WWW-AND-APEX.md.
const corsOrigins = process.env.HUB_CORS_ORIGIN
  ? process.env.HUB_CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [];
app.use((req, res, next) => {
  applyGatewayCors(res, req.get('Origin'), corsOrigins);
  next();
});

// Authenticated Hub JSON must not be cached (browser 304 / CDN reuse shows stale frontmatter).
app.use('/api/v1', (req, res, next) => {
  res.set('Cache-Control', 'private, no-store, must-revalidate');
  next();
});

// Health (no auth) — returns { ok: true }. If a CDN or host wrapper returns usage_exceeded, that is outside this app (check Netlify site / account limits and which commit is deployed).
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));

// Which OAuth providers are configured (no auth)
app.get('/api/v1/auth/providers', (_req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  });
});

// Auth: login redirect — plan routes GET /auth/login, GET /auth/callback/google|github. Preserve invite in state for post-login redirect.
app.get('/auth/login', (req, res, next) => {
  const provider = (req.query.provider || 'google').toLowerCase();
  const invite = typeof req.query.invite === 'string' ? req.query.invite.trim() : '';
  const state = invite || undefined;
  if (provider === 'google' && process.env.GOOGLE_CLIENT_ID) {
    return passport.authenticate('google', { scope: ['profile'], state })(req, res, next);
  }
  if (provider === 'github' && process.env.GITHUB_CLIENT_ID) {
    return passport.authenticate('github', { scope: ['user:email'], state })(req, res, next);
  }
  return res.status(400).json({ error: `Unknown or disabled provider: ${provider}`, code: 'BAD_REQUEST' });
});

function postLoginRedirect(token, req) {
  if (!token) return HUB_UI_ORIGIN + '/hub/?auth_error=1';
  let url = `${HUB_UI_ORIGIN}/hub/?token=${encodeURIComponent(token)}`;
  const invite = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  if (invite && invite.length > 0) url += '&invite=' + encodeURIComponent(invite);
  return url;
}

app.get(
  '/auth/callback/google',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const token = issueToken(req.user);
    res.redirect(postLoginRedirect(token, req));
  }
);
app.get(
  '/auth/callback/github',
  passport.authenticate('github', { session: false }),
  (req, res) => {
    const token = issueToken(req.user);
    res.redirect(postLoginRedirect(token, req));
  }
);

// Hub UI may call login under /api/v1/auth for consistency — redirect to /auth (preserve invite for post-login consume)
app.get('/api/v1/auth/login', (req, res) => {
  const provider = (req.query.provider || 'google').toLowerCase();
  let url = `${BASE_URL}/auth/login?provider=${encodeURIComponent(provider)}`;
  const invite = typeof req.query.invite === 'string' ? req.query.invite.trim() : '';
  if (invite) url += '&invite=' + encodeURIComponent(invite);
  res.redirect(url);
});

// Connect GitHub + Back up now: proxy to bridge when BRIDGE_URL is set (single origin for UI)
if (BRIDGE_URL) {
  app.get('/api/v1/auth/github-connect', (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    res.redirect(`${BRIDGE_URL}/auth/github-connect${q ? '?' + q : ''}`);
  });
  app.all('/api/v1/vault/sync', async (req, res) => {
    const url = BRIDGE_URL + '/api/v1/vault/sync' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    await proxyTo(BRIDGE_URL, url, req, res);
  });
  app.get('/api/v1/vault/github-status', async (req, res) => {
    const url = BRIDGE_URL + '/api/v1/vault/github-status' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    await proxyTo(BRIDGE_URL, url, req, res);
  });
  app.post('/api/v1/search', async (req, res) => {
    if (!(await runBillingGate(req, res, getUserId))) return;
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/search', req, res);
  });
  app.post('/api/v1/index', async (req, res) => {
    if (!(await runBillingGate(req, res, getUserId))) return;
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/index', req, res);
  });
  // Roles & invites: proxy to bridge (bridge has persistent storage)
  app.get('/api/v1/roles', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + req.originalUrl, req, res);
  });
  app.post('/api/v1/roles', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/roles', req, res);
  });
  app.get('/api/v1/invites', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + req.originalUrl, req, res);
  });
  app.post('/api/v1/invites', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/invites', req, res);
  });
  app.delete('/api/v1/invites/:token', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/invites/' + encodeURIComponent(req.params.token), req, res);
  });
  app.post('/api/v1/invites/consume', (req, res, next) => {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    next();
  }, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/invites/consume', req, res);
  });
  app.get('/api/v1/workspace', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/workspace', req, res);
  });
  app.post('/api/v1/workspace', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/workspace', req, res);
  });
  app.get('/api/v1/vault-access', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/vault-access', req, res);
  });
  app.post('/api/v1/vault-access', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/vault-access', req, res);
  });
  app.get('/api/v1/scope', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/scope', req, res);
  });
  app.post('/api/v1/scope', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/scope', req, res);
  });
  app.get('/api/v1/hosted-context', async (req, res, next) => {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    next();
  }, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/hosted-context', req, res);
  });
}

/**
 * Incoming headers describe the *client* body. We often re-serialize JSON (provenance merge), so
 * length and transfer-related headers must not be forwarded: Undici can hang or mis-send if
 * Content-Length still matches the old, shorter body.
 */
function stripStaleOutboundBodyHeaders(headers) {
  for (const k of Object.keys(headers)) {
    const l = k.toLowerCase();
    if (
      l === 'content-length' ||
      l === 'transfer-encoding' ||
      l === 'content-encoding'
    ) {
      delete headers[k];
    }
  }
}

async function proxyTo(baseUrl, url, req, res) {
  const headers = { ...req.headers, host: new URL(baseUrl).host };
  delete headers.origin;
  delete headers.referer;
  const opts = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
    opts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    stripStaleOutboundBodyHeaders(headers);
  }
  try {
    const upstream = await fetch(url, opts);
    const body = await upstream.text();
    const hop = filterUpstreamResponseHeadersForDecodedBody(upstream.headers.entries());
    res.status(upstream.status).set(Object.fromEntries(hop));
    res.send(body);
  } catch (e) {
    console.error('Gateway proxy (bridge) error:', e.message);
    res.status(502).json({ error: 'Bad Gateway', code: 'BAD_GATEWAY' });
  }
}

// Proxy /api/* to canister with X-User-Id from JWT
function getUserId(req) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return token ? verifyToken(token) : null;
}

const hostedCtxCache = new Map();
const HOSTED_CTX_TTL_MS = 5000;

/**
 * Bridge-hosted team context (vault allowlist + scope + effective canister user). Cached briefly per (sub, vaultId).
 * @param {import('express').Request} req
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function getHostedAccessContext(req) {
  if (!BRIDGE_URL) return null;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const sub = getUserId(req);
  if (!sub) return null;
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const cacheKey = `${sub}\0${vaultId}`;
  const now = Date.now();
  const hit = hostedCtxCache.get(cacheKey);
  if (hit && hit.expires > now) return hit.data;
  try {
    const r = await fetch(BRIDGE_URL + '/api/v1/hosted-context', {
      method: 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'X-Vault-Id': vaultId,
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data && data.error && !data.effective_canister_user_id) return null;
    hostedCtxCache.set(cacheKey, { expires: now + HOSTED_CTX_TTL_MS, data });
    return data;
  } catch (_) {
    return null;
  }
}

app.get('/api/v1/billing/summary', (req, res) => handleBillingSummary(req, res, getUserId));

// GET /api/v1/settings and GET /api/v1/setup — hosted: vault_list from canister; bridge fields when BRIDGE_URL set
app.get('/api/v1/settings', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  let vault_list = [{ id: 'default', label: 'Default' }];
  let allowed_vault_ids = ['default'];
  let canisterVaultUserId = uid;
  /** @type {string|null} */
  let workspace_owner_id = null;
  let hosted_delegating = false;
  /** @type {string[]|null} */
  let allowedFromBridge = null;
  if (BRIDGE_URL && req.headers.authorization) {
    try {
      const hRes = await fetch(BRIDGE_URL + '/api/v1/hosted-context', {
        method: 'GET',
        headers: {
          Authorization: req.headers.authorization,
          Accept: 'application/json',
          'X-Vault-Id': 'default',
        },
      });
      if (hRes.ok) {
        const hc = await hRes.json();
        if (hc.effective_canister_user_id && typeof hc.effective_canister_user_id === 'string') {
          canisterVaultUserId = hc.effective_canister_user_id;
        }
        if (Array.isArray(hc.allowed_vault_ids) && hc.allowed_vault_ids.length > 0) {
          allowedFromBridge = hc.allowed_vault_ids.map((x) => String(x));
        }
        if (hc.workspace_owner_id != null && String(hc.workspace_owner_id).trim() !== '') {
          workspace_owner_id = String(hc.workspace_owner_id).trim();
        }
        if (hc.delegating === true) hosted_delegating = true;
      }
    } catch (_) {
      /* use uid-only fallback */
    }
  }
  if (CANISTER_URL) {
    try {
      const vRes = await fetch(CANISTER_URL + '/api/v1/vaults', {
        method: 'GET',
        headers: { 'X-User-Id': canisterVaultUserId, Accept: 'application/json' },
      });
      if (vRes.ok) {
        const data = await vRes.json();
        const vaults = Array.isArray(data.vaults) ? data.vaults : [];
        if (vaults.length > 0) {
          const mapped = vaults.map((v) => ({
            id: String(v.id || 'default'),
            label: String(v.label != null && v.label !== '' ? v.label : v.id || 'default'),
          }));
          if (allowedFromBridge && allowedFromBridge.length > 0) {
            allowed_vault_ids = allowedFromBridge.filter((id) => mapped.some((m) => m.id === id));
            vault_list = allowed_vault_ids.map((id) => {
              const m = mapped.find((x) => x.id === id);
              return m || { id, label: id };
            });
          } else {
            vault_list = mapped;
            allowed_vault_ids = vault_list.map((v) => v.id);
          }
        } else if (allowedFromBridge && allowedFromBridge.length > 0) {
          allowed_vault_ids = [...allowedFromBridge];
          vault_list = allowedFromBridge.map((id) => ({ id, label: id }));
        }
      } else {
        console.warn('[gateway] canister vaults non-ok', vRes.status);
      }
    } catch (e) {
      console.warn('[gateway] canister vaults unreachable', e?.message || String(e));
    }
  }
  let github_connected = false;
  let github_repo = null;
  let role = roleForSub(uid);
  if (BRIDGE_URL && req.headers.authorization) {
    try {
      const ghRes = await fetch(BRIDGE_URL + '/api/v1/vault/github-status', {
        method: 'GET',
        headers: { Authorization: req.headers.authorization, Accept: 'application/json' },
      });
      if (ghRes.ok) {
        const data = await ghRes.json();
        github_connected = Boolean(data.github_connected);
        github_repo = data.repo || null;
      } else {
        console.warn('[gateway] bridge github-status non-ok', ghRes.status);
      }
      const roleRes = await fetch(BRIDGE_URL + '/api/v1/role', {
        method: 'GET',
        headers: { Authorization: req.headers.authorization, Accept: 'application/json' },
      });
      if (roleRes.ok) {
        const data = await roleRes.json();
        if (data.role) role = data.role;
      }
    } catch (e) {
      console.warn('[gateway] bridge unreachable', e?.message || String(e));
    }
  }
  const vault_git = {
    enabled: github_connected,
    has_remote: Boolean(github_repo),
    auto_commit: false,
    auto_push: false,
  };
  res.json({
    role,
    user_id: uid,
    vault_id: 'default',
    vault_list,
    allowed_vault_ids,
    vault_path_display: 'Canister',
    vault_git,
    github_connect_available: Boolean(BRIDGE_URL),
    github_connected,
    repo: github_repo,
    workspace_owner_id,
    hosted_delegating,
    embedding_display: { provider: '—', model: '—', ollama_url: '—' },
  });
});

app.get('/api/v1/setup', (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  res.json({
    vault_path: '',
    vault_git: { enabled: false, remote: '' },
  });
});

// --- Parity (Phase 1): roles, invites — stubs; admin from HUB_ADMIN_USER_IDS, full Team/invites need storage (Phase 2) ---
function requireAdmin(req, res, next) {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  if (roleForSub(uid) !== 'admin') return res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
  next();
}

if (!BRIDGE_URL) {
  app.get('/api/v1/workspace', requireAdmin, (_req, res) => {
    res.json({ owner_user_id: null });
  });
  app.post('/api/v1/workspace', requireAdmin, (_req, res) => {
    res.status(503).json({ error: 'Workspace owner requires bridge (BRIDGE_URL).', code: 'NOT_AVAILABLE' });
  });
  app.get('/api/v1/vault-access', requireAdmin, (_req, res) => {
    res.json({ access: {} });
  });
  app.post('/api/v1/vault-access', requireAdmin, (_req, res) => {
    res.status(503).json({ error: 'Vault access requires bridge (BRIDGE_URL).', code: 'NOT_AVAILABLE' });
  });
  app.get('/api/v1/scope', requireAdmin, (_req, res) => {
    res.json({ scope: {} });
  });
  app.post('/api/v1/scope', requireAdmin, (_req, res) => {
    res.status(503).json({ error: 'Scope requires bridge (BRIDGE_URL).', code: 'NOT_AVAILABLE' });
  });
  app.get('/api/v1/hosted-context', (req, res) => {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    res.status(503).json({ error: 'Hosted context requires bridge (BRIDGE_URL).', code: 'NOT_AVAILABLE' });
  });
}

// Hosted: vault list is derived from the canister; YAML vault editor is self-hosted only
app.post('/api/v1/vaults', requireAdmin, (_req, res) => {
  res.status(501).json({
    error:
      'Editing the vault list in Settings is not available on hosted. Vaults appear when you add notes; use the vault switcher or API with X-Vault-Id.',
    code: 'NOT_AVAILABLE',
  });
});

// GET /api/v1/roles — hosted stub: no role store; admin sees empty list (parity: only admins can open Team)
app.get('/api/v1/roles', requireAdmin, (_req, res) => {
  res.json({ roles: [] });
});

// POST /api/v1/roles — no-op on hosted (no persistent role store yet)
app.post('/api/v1/roles', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

// GET /api/v1/invites — hosted stub: no invite store
app.get('/api/v1/invites', requireAdmin, (_req, res) => {
  res.json({ invites: [] });
});

// POST /api/v1/invites — not supported on hosted (no invite store; full parity in Phase 2)
app.post('/api/v1/invites', requireAdmin, (_req, res) => {
  res.status(400).json({
    error: 'Invites are not supported on hosted yet. Use self-hosted Hub for team invites, or wait for Phase 2.',
    code: 'NOT_SUPPORTED',
  });
});

// DELETE /api/v1/invites/:token — no-op on hosted
app.delete('/api/v1/invites/:token', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

// POST /api/v1/setup — no-op on hosted (vault is canister; nothing to persist)
app.post('/api/v1/setup', (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  res.json({ ok: true });
});

// POST /api/v1/import — not yet available on hosted (canister does not implement)
app.post('/api/v1/import', (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  res.status(501).json({
    error: 'Import is not yet available on hosted.',
    code: 'NOT_AVAILABLE',
  });
});

// GET /api/v1/notes/facets — aggregate from canister list (Hub filter dropdowns / overview parity)
app.get('/api/v1/notes/facets', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  if (!CANISTER_URL) {
    return res.json({ projects: [], tags: [], folders: [] });
  }
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const hctx = await getHostedAccessContext(req);
  const effective = (hctx && hctx.effective_canister_user_id) || uid;
  if (hctx && Array.isArray(hctx.allowed_vault_ids) && !hctx.allowed_vault_ids.includes(vaultId)) {
    return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
  }
  try {
    const url = `${CANISTER_URL}/api/v1/notes`;
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-user-id': effective,
        'x-actor-id': uid,
        'x-vault-id': vaultId,
      },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      console.warn('[gateway] facets canister list non-ok', upstream.status);
      return res.json({ projects: [], tags: [], folders: [] });
    }
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      console.warn('[gateway] facets canister list JSON parse', e?.message || String(e));
      return res.json({ projects: [], tags: [], folders: [] });
    }
    const rows = Array.isArray(data.notes) ? data.notes : [];
    let notesForFacets = rows;
    const scope = hctx && hctx.scope && typeof hctx.scope === 'object' ? hctx.scope : null;
    if (scope && (scope.projects?.length || scope.folders?.length)) {
      const withProj = rows.map((n) => ({
        path: n.path,
        project: materializeListFrontmatter(n.frontmatter).project ?? null,
      }));
      const scoped = applyScopeFilterToNotes(withProj, scope);
      const pathSet = new Set(scoped.map((n) => n.path).filter(Boolean));
      notesForFacets = rows.filter((n) => pathSet.has(n.path));
    }
    const facets = deriveFacetsFromCanisterNotes(notesForFacets);
    res.json(facets);
  } catch (e) {
    console.warn('[gateway] facets error', e?.message || String(e));
    res.json({ projects: [], tags: [], folders: [] });
  }
});

/**
 * @param {Record<string, unknown>|null} hctx
 */
function scopeActiveForGateway(hctx) {
  const s = hctx && hctx.scope && typeof hctx.scope === 'object' ? hctx.scope : null;
  return Boolean(s && (s.projects?.length || s.folders?.length));
}

async function gatewayProxyGetNotesList(req, res, uid, effective, hctx) {
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const raw = upstreamPathAndQuery(req);
  const qIdx = raw.indexOf('?');
  const searchPart = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
  const params = new URLSearchParams(searchPart);
  const limit = Math.min(100, Math.max(0, parseInt(params.get('limit') || '20', 10) || 20));
  const offset = Math.max(0, parseInt(params.get('offset') || '0', 10) || 0);
  const scope = scopeActiveForGateway(hctx) ? hctx.scope : null;
  if (scope) {
    params.set('limit', '10000');
    params.set('offset', '0');
  }
  const fetchUrl = `${CANISTER_URL}/api/v1/notes${params.toString() ? `?${params.toString()}` : ''}`;
  try {
    const upstream = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-user-id': effective,
        'x-actor-id': uid,
        'x-vault-id': vaultId,
      },
    });
    const text = await upstream.text();
    const hop = filterUpstreamResponseHeadersForDecodedBody(upstream.headers.entries()).filter(
      ([k]) => !['cache-control', 'etag', 'last-modified'].includes(k.toLowerCase()),
    );
    res.status(upstream.status).set(Object.fromEntries(hop));
    res.set('Cache-Control', 'private, no-store, must-revalidate');
    if (!upstream.ok || !text) {
      res.send(text);
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      res.send(text);
      return;
    }
    if (scope && Array.isArray(data.notes)) {
      const withProj = data.notes.map((n) => ({
        path: n.path,
        project: materializeListFrontmatter(n.frontmatter).project ?? null,
      }));
      const filteredIdx = new Set();
      const kept = applyScopeFilterToNotes(withProj, scope);
      for (const row of kept) {
        if (row.path) filteredIdx.add(row.path);
      }
      const all = data.notes.filter((n) => n.path && filteredIdx.has(n.path));
      const total = all.length;
      const page = all.slice(offset, offset + limit);
      res.json({ notes: page, total });
      return;
    }
    res.send(text);
  } catch (e) {
    console.error('Gateway GET notes list error:', e.message);
    res.status(502).json({ error: 'Bad Gateway', code: 'BAD_GATEWAY' });
  }
}

async function gatewayProxyGetNoteOne(req, res, uid, effective, hctx) {
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const url = CANISTER_URL + upstreamPathAndQuery(req);
  const scope = scopeActiveForGateway(hctx) ? hctx.scope : null;
  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-user-id': effective,
        'x-actor-id': uid,
        'x-vault-id': vaultId,
      },
    });
    const body = await upstream.text();
    if (upstream.status >= 400) {
      console.warn('[gateway] canister GET note:', upstream.status, 'url:', url.slice(0, 120));
    }
    const hop = filterUpstreamResponseHeadersForDecodedBody(upstream.headers.entries()).filter(
      ([k]) => !['cache-control', 'etag', 'last-modified'].includes(k.toLowerCase()),
    );
    res.status(upstream.status).set(Object.fromEntries(hop));
    res.set('Cache-Control', 'private, no-store, must-revalidate');
    if (!scope || upstream.status !== 200 || !body) {
      res.send(body);
      return;
    }
    try {
      const note = JSON.parse(body);
      const withProj = {
        path: note.path,
        project: materializeListFrontmatter(note.frontmatter).project ?? null,
      };
      const filtered = applyScopeFilterToNotes([withProj], scope);
      if (filtered.length === 0) {
        res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        return;
      }
    } catch (_) {
      res.send(body);
      return;
    }
    res.send(body);
  } catch (e) {
    console.error('Gateway GET note error:', e.message);
    res.status(502).json({ error: 'Bad Gateway', code: 'BAD_GATEWAY' });
  }
}

async function proxyToCanister(req, res) {
  const uid = getUserId(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const pathOnly = effectiveRequestPath(req);
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const hctx = await getHostedAccessContext(req);
  const effective =
    hctx && typeof hctx.effective_canister_user_id === 'string' && hctx.effective_canister_user_id
      ? hctx.effective_canister_user_id
      : uid;
  if (hctx && Array.isArray(hctx.allowed_vault_ids) && !hctx.allowed_vault_ids.includes(vaultId)) {
    return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
  }

  if (req.method === 'GET' && pathOnly === '/api/v1/notes') {
    return gatewayProxyGetNotesList(req, res, uid, effective, hctx);
  }
  const noteSubPrefix = '/api/v1/notes/';
  if (
    req.method === 'GET' &&
    pathOnly.startsWith(noteSubPrefix) &&
    pathOnly !== '/api/v1/notes/facets'
  ) {
    const rest = pathOnly.slice(noteSubPrefix.length);
    if (rest) {
      return gatewayProxyGetNoteOne(req, res, uid, effective, hctx);
    }
  }

  const url = CANISTER_URL + upstreamPathAndQuery(req);
  const headers = {
    ...req.headers,
    host: new URL(CANISTER_URL).host,
    'x-user-id': effective,
    'x-actor-id': uid,
    'x-vault-id': req.headers['x-vault-id'] || 'default',
  };
  delete headers.origin;
  delete headers.referer;
  const opts = { method: req.method, headers };
  let bodyOut = req.body;
  if (
    bodyOut !== undefined &&
    typeof bodyOut === 'object' &&
    !Buffer.isBuffer(bodyOut) &&
    isPostApiV1Notes(req.method, pathPartNoQuery(req))
  ) {
    bodyOut = mergeHostedNoteBodyForCanister(bodyOut, uid);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && bodyOut !== undefined) {
    opts.body = typeof bodyOut === 'string' ? bodyOut : JSON.stringify(bodyOut);
    stripStaleOutboundBodyHeaders(headers);
  }
  try {
    const upstream = await fetch(url, opts);
    const body = await upstream.text();
    if (upstream.status >= 400 && req.method === 'GET' && url.includes('/api/v1/notes/')) {
      console.warn('[gateway] canister GET note:', upstream.status, 'url:', url.slice(0, 120));
    }
    const hop = filterUpstreamResponseHeadersForDecodedBody(upstream.headers.entries()).filter(
      ([k]) => !['cache-control', 'etag', 'last-modified'].includes(k.toLowerCase()),
    );
    res.status(upstream.status).set(Object.fromEntries(hop));
    res.set('Cache-Control', 'private, no-store, must-revalidate');
    res.send(body);
  } catch (e) {
    console.error('Gateway proxy error:', e.message);
    res.status(502).json({ error: 'Bad Gateway', code: 'BAD_GATEWAY' });
  }
}

app.use('/api/v1', async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!(await runBillingGate(req, res, getUserId))) return;
  return proxyToCanister(req, res);
});

// Health from canister if UI calls /health via same origin
app.get('/api/v1/health-canister', async (_req, res) => {
  try {
    const r = await fetch(CANISTER_URL + '/health');
    const body = await r.text();
    res.status(r.status).set('Content-Type', 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// When running on Netlify, the app is imported by netlify/functions/gateway.mjs and not started here.
if (!process.env.NETLIFY) {
  if (!CANISTER_URL) {
    console.error('Gateway: CANISTER_URL is required (e.g. https://<canister-id>.ic0.app)');
    process.exit(1);
  }
  if (!SESSION_SECRET) {
    console.error('Gateway: SESSION_SECRET or HUB_JWT_SECRET is required');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Knowtation Hub Gateway listening on http://localhost:${PORT}`);
    console.log('  Canister: ' + CANISTER_URL);
    console.log('  UI origin: ' + HUB_UI_ORIGIN);
    console.log('  Login: GET /auth/login?provider=google|github');
  });
}

export { app };
