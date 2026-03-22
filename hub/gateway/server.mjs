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
import { mergeHostedNoteBodyForCanister, isPostApiV1Notes, pathPartNoQuery } from './apply-note-provenance.mjs';

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

// CORS: with credentials, browser rejects *. Use HUB_CORS_ORIGIN (single or comma-separated).
// If users open both apex and www, list both origins (e.g. https://knowtation.store,https://www.knowtation.store).
const corsOrigins = process.env.HUB_CORS_ORIGIN
  ? process.env.HUB_CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [];
app.use((req, res, next) => {
  const origin = req.get('Origin');
  const allow =
    origin && corsOrigins.length > 0 && corsOrigins.includes(origin)
      ? origin
      : corsOrigins.length > 0
        ? corsOrigins[0]
        : '*';
  res.set('Access-Control-Allow-Origin', allow);
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vault-Id, X-User-Id');
  res.set('Access-Control-Allow-Credentials', 'true');
  if (corsOrigins.length > 0) res.set('Vary', 'Origin');
  next();
});

// Health (no auth)
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
}

async function proxyTo(baseUrl, url, req, res) {
  const headers = { ...req.headers, host: new URL(baseUrl).host };
  delete headers.origin;
  delete headers.referer;
  const opts = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
    opts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  try {
    const upstream = await fetch(url, opts);
    const body = await upstream.text();
    res.status(upstream.status).set(Object.fromEntries(upstream.headers.entries()));
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

app.get('/api/v1/billing/summary', (req, res) => handleBillingSummary(req, res, getUserId));

// GET /api/v1/settings and GET /api/v1/setup — hosted: vault_list from canister; bridge fields when BRIDGE_URL set
app.get('/api/v1/settings', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  let vault_list = [{ id: 'default', label: 'Default' }];
  let allowed_vault_ids = ['default'];
  if (CANISTER_URL) {
    try {
      const vRes = await fetch(CANISTER_URL + '/api/v1/vaults', {
        method: 'GET',
        headers: { 'X-User-Id': uid, Accept: 'application/json' },
      });
      if (vRes.ok) {
        const data = await vRes.json();
        const vaults = Array.isArray(data.vaults) ? data.vaults : [];
        if (vaults.length > 0) {
          vault_list = vaults.map((v) => ({
            id: String(v.id || 'default'),
            label: String(v.label != null && v.label !== '' ? v.label : v.id || 'default'),
          }));
          allowed_vault_ids = vault_list.map((v) => v.id);
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

// GET /api/v1/notes/facets — hosted stub (canister does not implement; Hub filter dropdowns need this)
app.get('/api/v1/notes/facets', (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  res.json({ projects: [], tags: [], folders: [] });
});

/** Path + query for upstream canister. Forward raw path (no URL parsing) so percent-encoding (e.g. %2F) is preserved; canister decodes before vault lookup. Do not use req.path: Express strips the mount so req.path is only the suffix (e.g. /notes), which would call the canister at /notes and yield NOT_FOUND. */
function upstreamPathAndQuery(req) {
  const raw = req.originalUrl || req.url || '/';
  const q = raw.indexOf('?');
  const pathPart = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : '';
  return pathPart + search;
}

async function proxyToCanister(req, res) {
  const uid = getUserId(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const url = CANISTER_URL + upstreamPathAndQuery(req);
  const headers = {
    ...req.headers,
    host: new URL(CANISTER_URL).host,
    'x-user-id': uid,
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
  }
  try {
    const upstream = await fetch(url, opts);
    const body = await upstream.text();
    if (upstream.status >= 400 && req.method === 'GET' && url.includes('/api/v1/notes/')) {
      console.warn('[gateway] canister GET note:', upstream.status, 'url:', url.slice(0, 120));
    }
    res.status(upstream.status).set(Object.fromEntries(upstream.headers.entries()));
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
