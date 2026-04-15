/**
 * Knowtation Hub Gateway — OAuth (Google/GitHub) + proxy to ICP canister with X-User-Id.
 * For hosted product: user logs in here; all /api/* requests are proxied to canister with proof.
 * Run: node server.mjs
 * Env: SESSION_SECRET, CANISTER_URL, HUB_BASE_URL; optional GOOGLE_*, GITHUB_*, HUB_UI_ORIGIN, GATEWAY_PORT.
 */

import crypto from 'crypto';
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
import { stripeWebhookHandler, createCheckoutSession, createPortalSession } from './billing-stripe.mjs';
import { handleBillingSummary } from './billing-http.mjs';
import { isSubscriptionPriceId, isPackPriceId, priceIdFromTierShorthand, billingEnforced } from './billing-constants.mjs';
import { recordIndexingTokensAfterBridgeIndex } from './billing-index-usage.mjs';
import { runBillingGate } from './billing-middleware.mjs';
import { mergeHostedNoteBodyForCanister, isPostApiV1Notes, isNoteWriteRequest } from './apply-note-provenance.mjs';
import { deriveFacetsFromCanisterNotes, materializeListFrontmatter } from './note-facets.mjs';
import { applyGatewayCors } from './cors-middleware.mjs';
import { upstreamPathAndQuery, pathPartNoQuery, effectiveRequestPath } from './request-path.mjs';
import { applyScopeFilterToNotes } from '../lib/scope-filter.mjs';
import { createMetadataBulkHandlers } from './metadata-bulk-canister.mjs';
import { filterUpstreamResponseHeadersForDecodedBody } from './upstream-response-headers.mjs';
import { loadProposalRubric } from '../../lib/hub-proposal-rubric.mjs';
import { commitImageToRepo, validateImageExtension, validateMagicBytes } from '../../lib/github-commit-image.mjs';
import { parseMultipartFile } from './parse-multipart.mjs';
import { proposalPolicyEnvLocked } from '../../lib/hub-proposal-policy.mjs';
import {
  loadHostedProposalLlmPrefs,
  mergeHostedProposalLlmPrefs,
  effectiveHostedEvaluationRequired,
  effectiveHostedReviewHints,
  effectiveHostedEnrich,
} from './proposal-llm-store.mjs';
import { augmentProposalEvaluationBodyForCanister } from './proposal-evaluation-canister-body.mjs';
import { augmentProposalCreateForHosted } from './proposal-create-hosted-body.mjs';
import { maybeScheduleHostedProposalReviewHints } from './proposal-review-hints-async.mjs';
import { runHostedProposalEnrichAndPost } from './proposal-enrich-hosted.mjs';
import { isAttestationConfigured, createAttestation, verifyAttestation, verifyWithIcp, anchorPendingAttestations } from './attest-store.mjs';
import { loadBillingDb, mutateBillingDb } from './billing-store.mjs';
import { normalizeBillingUser, defaultUserRecord } from './billing-logic.mjs';
import {
  mergeConsolidateRequestBodyWithBillingDefaults,
  validateHostedSettingsConsolidationAdvanced,
} from '../../lib/hosted-consolidation-advanced.mjs';
import {
  parseMuseConfigFromEnv,
  resolveExternalRefForApprove,
  proposalIdFromApprovePath,
  fetchMuseProxiedGet,
} from '../../lib/muse-thin-bridge.mjs';

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

// AIR Improvement D: when ATTESTATION_SECRET is set and no explicit AIR endpoint
// is provided, point AIR at this gateway's own /api/v1/attest route.
if (
  process.env.ATTESTATION_SECRET &&
  process.env.ATTESTATION_SECRET.length >= 32 &&
  !process.env.KNOWTATION_AIR_ENDPOINT
) {
  process.env.KNOWTATION_AIR_ENDPOINT = `${BASE_URL}/api/v1/attest`;
  console.log('[gateway] AIR auto-configured: KNOWTATION_AIR_ENDPOINT =', process.env.KNOWTATION_AIR_ENDPOINT);
}
const CANISTER_URL = (process.env.CANISTER_URL || '').replace(/\/$/, '');
const CANISTER_AUTH_SECRET = process.env.CANISTER_AUTH_SECRET || '';
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
const JWT_EXPIRY = process.env.HUB_JWT_EXPIRY || '24h';

// Optional: comma-separated list of user IDs (e.g. google:123,github:456) who get role admin on hosted. Others get member.
const HUB_ADMIN_USER_IDS = (process.env.HUB_ADMIN_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const adminUserIdsSet = new Set(HUB_ADMIN_USER_IDS);

function roleForSub(sub) {
  return sub && adminUserIdsSet.has(sub) ? 'admin' : 'member';
}

function canisterAuthHeaders() {
  if (!CANISTER_AUTH_SECRET) return {};
  return { 'x-gateway-auth': CANISTER_AUTH_SECRET };
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

const IMAGE_PROXY_TOKEN_TTL_SECONDS = 300;

function signImageProxyToken(secret, uid) {
  const exp = Math.floor(Date.now() / 1000) + IMAGE_PROXY_TOKEN_TTL_SECONDS;
  const payload = `img\0${uid}\0${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${exp}.${Buffer.from(uid).toString('base64url')}.${sig}`;
}

function verifyImageProxyToken(secret, token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expStr, uidB64, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!exp || Math.floor(Date.now() / 1000) > exp) return null;
  let uid;
  try { uid = Buffer.from(uidB64, 'base64url').toString(); } catch (_) { return null; }
  if (!uid) return null;
  const payload = `img\0${uid}\0${exp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return uid;
}

const app = express();
// Trust the first downstream proxy so express-rate-limit (and any future IP-based middleware)
// reads the real client IP from X-Forwarded-For instead of the CDN/load-balancer address.
app.set('trust proxy', 1);

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
// Phase D3: mcp_state query param is passed through OAuth state for MCP authorization flow.
app.get('/auth/login', (req, res, next) => {
  const provider = (req.query.provider || 'google').toLowerCase();
  const invite = typeof req.query.invite === 'string' ? req.query.invite.trim() : '';
  const mcpState = typeof req.query.mcp_state === 'string' ? req.query.mcp_state.trim() : '';
  let state;
  if (mcpState) {
    state = `mcp:${mcpState}`;
  } else {
    state = invite || undefined;
  }
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
  const invite = typeof req.query.state === 'string' ? req.query.state.trim() : '';
  let fragment = `token=${encodeURIComponent(token)}`;
  if (invite && invite.length > 0) fragment += '&invite=' + encodeURIComponent(invite);
  return `${HUB_UI_ORIGIN}/hub/#${fragment}`;
}

app.get(
  '/auth/callback/google',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (state.startsWith('mcp:') && app._mcpOAuthProvider) {
      const sub = userId(req.user);
      if (!sub) return res.status(401).json({ error: 'auth_failed' });
      return app._mcpOAuthProvider.completeMcpAuthorization(state.slice(4), sub, res);
    }
    const token = issueToken(req.user);
    res.redirect(postLoginRedirect(token, req));
  }
);
app.get(
  '/auth/callback/github',
  passport.authenticate('github', { session: false }),
  (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (state.startsWith('mcp:') && app._mcpOAuthProvider) {
      const sub = userId(req.user);
      if (!sub) return res.status(401).json({ error: 'auth_failed' });
      return app._mcpOAuthProvider.completeMcpAuthorization(state.slice(4), sub, res);
    }
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

// Phase D2/D3: MCP gateway + OAuth 2.1.
// MCP requires stateful sessions (SSE, session pool) that are incompatible with Netlify's
// serverless function model (26s timeout, no shared memory between invocations).
// On Netlify, only the OAuth discovery endpoints are mounted (lightweight, stateless).
// The full /mcp session endpoint requires a persistent Express server (local dev, Docker, VPS,
// or a dedicated MCP host like Railway/Fly.io). See docs/AGENT-INTEGRATION.md §2 (hosted MCP).
if (SESSION_SECRET && !process.env.NETLIFY) {
  import('./mcp-oauth-provider.mjs').then(async ({ KnowtationOAuthProvider }) => {
    const { mcpAuthRouter } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
    const oauthProvider = new KnowtationOAuthProvider({
      sessionSecret: SESSION_SECRET,
      baseUrl: BASE_URL,
    });
    app._mcpOAuthProvider = oauthProvider;
    // @modelcontextprotocol/sdk mounts OAuth handlers with express-rate-limit. Behind Nginx,
    // X-Forwarded-For is always set; limiters then validate trust proxy. The gateway uses
    // Express 4 while the SDK bundles Express 5 routers — in that mix we still observed
    // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on /token (Cursor stuck on "Exchanging token…") even
    // with app.set('trust proxy', 1) and validate.xForwardedForHeader disabled. Disable the
    // SDK limiters entirely for these routes; enforce abuse limits at the reverse proxy
    // (limit_req on /token, /authorize, /register, /revoke) or a shared edge WAF.
    app.set('trust proxy', 1);
    const mcpOAuthSdkHandlerOpts = { rateLimit: false };
    app.use(mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(BASE_URL),
      scopesSupported: ['vault:read', 'vault:write', 'vault:admin'],
      authorizationOptions: mcpOAuthSdkHandlerOpts,
      tokenOptions: mcpOAuthSdkHandlerOpts,
      clientRegistrationOptions: mcpOAuthSdkHandlerOpts,
      revocationOptions: mcpOAuthSdkHandlerOpts,
    }));
    console.log('[gateway] MCP OAuth 2.1 endpoints mounted');
  }).catch((e) => {
    console.error('[gateway] MCP OAuth router failed to load:', e.message || e);
  });
} else if (SESSION_SECRET && process.env.NETLIFY) {
  console.log('[gateway] MCP OAuth/session endpoints skipped on Netlify (stateful sessions require persistent server)');
}

if (BRIDGE_URL && CANISTER_URL && !process.env.NETLIFY) {
  import('./mcp-proxy.mjs').then(({ createMcpProxyRouter }) => {
    const mcpRouter = createMcpProxyRouter({
      getUserId,
      getHostedAccessContext,
      canisterUrl: CANISTER_URL,
      canisterAuthSecret: CANISTER_AUTH_SECRET,
      bridgeUrl: BRIDGE_URL,
      sessionSecret: SESSION_SECRET || '',
    });
    app.use('/mcp', mcpRouter);
    console.log('[gateway] MCP endpoint mounted at /mcp');
  }).catch((e) => {
    console.error('[gateway] MCP proxy failed to load:', e.message || e);
  });
} else if (process.env.NETLIFY) {
  app.all('/mcp', (_req, res) => {
    res.status(503).json({
      error: 'MCP endpoint requires a persistent server. Connect to the dedicated MCP host or use self-hosted deployment.',
      code: 'MCP_NETLIFY_UNSUPPORTED',
      docs: 'https://github.com/aaronrene/knowtation/blob/main/docs/AGENT-INTEGRATION.md',
    });
  });
}

// Connect GitHub + Back up now: proxy to bridge when BRIDGE_URL is set (single origin for UI)
if (BRIDGE_URL) {
  app.get('/api/v1/auth/github-connect', (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    res.redirect(`${BRIDGE_URL}/auth/github-connect${q ? '?' + q : ''}`);
  });
  // Browsers send OPTIONS preflight before POST with Authorization + JSON body. The bridge only
  // registers POST /api/v1/vault/sync, so proxying OPTIONS returns 404 and surfaces as "Failed to fetch".
  app.all('/api/v1/vault/sync', async (req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    const url = BRIDGE_URL + '/api/v1/vault/sync' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    await proxyTo(BRIDGE_URL, url, req, res);
  });
  app.all('/api/v1/vaults/:vaultId', async (req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    if (req.method !== 'DELETE') {
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    if (!(await runBillingGate(req, res, getUserId))) return;
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const url =
      BRIDGE_URL + '/api/v1/vaults/' + encodeURIComponent(req.params.vaultId) + q;
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
    const uid = getUserId(req);
    const headers = { ...req.headers, host: new URL(BRIDGE_URL).host };
    delete headers.origin;
    delete headers.referer;
    const opts = { method: 'POST', headers };
    const payload =
      req.body === undefined ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (payload !== undefined) {
      opts.body = payload;
      stripStaleOutboundBodyHeaders(headers);
    }
    try {
      const upstream = await fetch(BRIDGE_URL + '/api/v1/index', opts);
      const body = await upstream.text();
      if (uid) await recordIndexingTokensAfterBridgeIndex(uid, upstream.status, body);
      const hop = filterUpstreamResponseHeadersForDecodedBody(upstream.headers.entries());
      res.status(upstream.status).set(Object.fromEntries(hop));
      res.send(body);
    } catch (e) {
      console.error('Gateway proxy (bridge) error:', e.message);
      res.status(502).json({ error: 'Bad Gateway', code: 'BAD_GATEWAY' });
    }
  });
  // Roles & invites: proxy to bridge (bridge has persistent storage)
  app.get('/api/v1/roles', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + req.originalUrl, req, res);
  });
  app.post('/api/v1/roles', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/roles', req, res);
  });
  app.post('/api/v1/roles/evaluator-may-approve', requireAdmin, async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/roles/evaluator-may-approve', req, res);
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

  // Memory routes: proxy to bridge (per-user/vault isolation handled by bridge)
  app.get('/api/v1/memory/:key', async (req, res) => {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory/' + encodeURIComponent(req.params.key) + q, req, res);
  });
  app.post('/api/v1/memory/store', async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory/store', req, res);
  });
  app.get('/api/v1/memory', async (req, res) => {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory' + q, req, res);
  });
  app.post('/api/v1/memory/search', async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory/search', req, res);
  });
  app.delete('/api/v1/memory/clear', async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory/clear', req, res);
  });
  app.get('/api/v1/memory-stats', async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory-stats', req, res);
  });
  // Consolidation routes: proxy to bridge with billing gate on POST
  app.post('/api/v1/memory/consolidate', async (req, res) => {
    if (!(await runBillingGate(req, res, getUserId))) return;
    const uid = getUserId(req);
    try {
      const db = await loadBillingDb();
      const raw = db.users?.[uid] || defaultUserRecord(uid);
      const u = normalizeBillingUser(raw);
      req.body = mergeConsolidateRequestBodyWithBillingDefaults(
        req.body && typeof req.body === 'object' ? req.body : {},
        u,
      );
    } catch (_) {
      /* fail open: bridge merges with billing file / defaults */
    }
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory/consolidate', req, res);
  });
  app.get('/api/v1/memory/consolidate/status', async (req, res) => {
    await proxyTo(BRIDGE_URL, BRIDGE_URL + '/api/v1/memory/consolidate/status', req, res);
  });

  // Phase 18: image upload — gateway buffers the file, fetches GitHub token from bridge,
  // then commits directly to GitHub (avoids forwarding a multipart body to another Lambda).
  app.post(/^\/api\/v1\/notes\/(.+)\/upload-image$/, async (req, res) => {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

    // 1. Get GitHub connection (token + repo) from bridge.
    let ghToken, ghRepo;
    try {
      const tokenRes = await fetch(`${BRIDGE_URL}/api/v1/vault/github-token`, {
        headers: { authorization: req.headers.authorization || '' },
      });
      if (!tokenRes.ok) {
        const errData = await tokenRes.json().catch(() => ({}));
        return res.status(tokenRes.status).json({
          error: errData.error || 'GitHub not connected',
          code: errData.code || 'GITHUB_NOT_CONNECTED',
        });
      }
      const data = await tokenRes.json();
      ghToken = data.token;
      ghRepo = data.repo;
    } catch (e) {
      return res.status(502).json({ error: 'Could not reach bridge', code: 'BAD_GATEWAY' });
    }
    if (!ghToken) return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
    if (!ghRepo) return res.status(400).json({ error: 'GitHub repo not set. Back up once first to set the remote.', code: 'GITHUB_NOT_CONFIGURED' });

    // 2. Buffer the uploaded file from the multipart body.
    let fileBuffer, originalName, mimeType;
    try {
      const raw = await bufferImportRequestBody(req);
      const ct = req.headers['content-type'] || '';
      const boundaryMatch = ct.match(/boundary=([^\s;]+)/i);
      if (!boundaryMatch) return res.status(400).json({ error: 'Content-Type boundary missing', code: 'BAD_REQUEST' });
      const boundary = boundaryMatch[1];
      // Parse the first file part from the multipart body manually (avoids multer dependency).
      const parsed = parseMultipartFile(raw, boundary);
      if (!parsed) return res.status(400).json({ error: 'image file required', code: 'BAD_REQUEST' });
      fileBuffer = parsed.data;
      originalName = parsed.filename || 'image.jpg';
      mimeType = parsed.contentType || 'application/octet-stream';
    } catch (e) {
      return res.status(500).json({ error: 'Could not read upload body', code: 'INTERNAL_ERROR' });
    }

    // 3. Validate extension, content-type, and magic bytes.
    try { validateImageExtension(originalName); } catch (e) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    if (!mimeType.toLowerCase().startsWith('image/')) {
      return res.status(400).json({ error: 'File content-type must be image/*', code: 'BAD_REQUEST' });
    }
    const ext = originalName.split('.').pop().toLowerCase();
    const magicOk = validateMagicBytes(fileBuffer, ext);
    if (!magicOk) {
      return res.status(400).json({ error: 'File content does not match declared image type', code: 'BAD_REQUEST' });
    }

    // 4. Commit to GitHub directly from the gateway.
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
      const uniqueName = `${Date.now()}-${safeName}`;
      const repoFilePath = `media/images/${yearMonth}/${uniqueName}`;
      const result = await commitImageToRepo({
        accessToken: ghToken,
        repoUrl: ghRepo,
        filePath: repoFilePath,
        fileBuffer,
        commitMessage: `Add image: ${safeName}`,
      });
      return res.json({
        url: result.url,
        inserted_markdown: `![${safeName}](${result.url})`,
        sha: result.sha,
        repo_path: repoFilePath,
        repo_private: result.isPrivate === true,
      });
    } catch (e) {
      const msg = e.message || String(e);
      const clientErr = /not found|not connected|lacks permission|lacks repo|Reconnect|scope|remote/i.test(msg);
      return res.status(clientErr ? 400 : 500).json({ error: msg, code: clientErr ? 'BAD_REQUEST' : 'RUNTIME_ERROR' });
    }
  });

  app.get('/api/v1/vault/image-proxy-token', (req, res) => {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    if (!SESSION_SECRET) return res.status(503).json({ error: 'Not configured', code: 'NOT_CONFIGURED' });
    const token = signImageProxyToken(SESSION_SECRET, uid);
    res.json({ token, expires_in: IMAGE_PROXY_TOKEN_TTL_SECONDS });
  });

  app.get('/api/v1/vault/image-proxy', async (req, res) => {
    const auth = req.headers.authorization || '';
    const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
    let uid = headerToken ? getUserId({ headers: { authorization: `Bearer ${headerToken}` } }) : null;
    let jwtTokenForBridge = headerToken || '';
    if (!uid && queryToken && SESSION_SECRET) {
      uid = verifyImageProxyToken(SESSION_SECRET, queryToken);
    }
    // Backward compat: old hub.js sends full JWT as ?token= (pre-signed-token change).
    if (!uid && queryToken) {
      const fromJwt = getUserId({ headers: { authorization: `Bearer ${queryToken}` } });
      if (fromJwt) { uid = fromJwt; jwtTokenForBridge = queryToken; }
    }
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

    // When uid is known but no JWT to forward (HMAC token auth path), mint a
    // short-lived gateway JWT so the bridge can identify the user.
    if (!jwtTokenForBridge && SESSION_SECRET) {
      try { jwtTokenForBridge = jwt.sign({ sub: uid }, SESSION_SECRET, { expiresIn: '5m' }); } catch (_) {}
    }

    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) return res.status(400).json({ error: 'url parameter required', code: 'BAD_REQUEST' });

    // Only proxy raw.githubusercontent.com URLs to prevent SSRF.
    const rawMatch = rawUrl.match(
      /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
    );
    if (!rawMatch) {
      return res.status(400).json({ error: 'Only raw.githubusercontent.com URLs are supported', code: 'BAD_REQUEST' });
    }
    const [, owner, repo, ref, filePath] = rawMatch;

    let ghToken = null;
    if (jwtTokenForBridge) {
      try {
        const tokenRes = await fetch(`${BRIDGE_URL}/api/v1/vault/github-token`, {
          headers: { authorization: `Bearer ${jwtTokenForBridge}` },
        });
        if (tokenRes.ok) {
          const data = await tokenRes.json();
          ghToken = data.token || null;
        }
      } catch (_) { /* bridge unreachable — fall through, public repos still work */ }
    }

    if (!ghToken) {
      // No stored GitHub token — assume the repo is public and redirect directly.
      return res.redirect(302, rawUrl);
    }

    // Use the GitHub Contents API to get a signed, short-lived download_url for the file.
    // This avoids sending the PAT in the redirect URL while still letting private-repo images load.
    const apiUrl =
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}` +
      `?ref=${encodeURIComponent(ref)}`;
    try {
      const apiRes = await fetch(apiUrl, {
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Knowtation-Hub/1.0',
        },
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const dlUrl = data.download_url || rawUrl;
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.redirect(302, dlUrl);
      }
      // GitHub returned an error (e.g. 404 file missing, 403 large-file).
      const errBody = await apiRes.json().catch(() => ({}));
      return res.status(apiRes.status).json({
        error: errBody.message || 'Image not found on GitHub',
        code: 'UPSTREAM_ERROR',
      });
    } catch (e) {
      return res.status(502).json({ error: 'Failed to fetch image metadata from GitHub', code: 'BAD_GATEWAY' });
    }
  });
}

/**
 * Safe client request headers that may be forwarded to upstream services.
 * Using an explicit allowlist prevents host-header injection, internal proxy header leakage,
 * and forwarding of security-sensitive headers (cookies, x-forwarded-for, etc.) to upstreams.
 */
const PROXY_HEADER_ALLOWLIST = new Set([
  'content-type',
  'accept',
  'accept-language',
  'accept-encoding',
]);

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
  const headers = { host: new URL(baseUrl).host };
  // Allowlist: only forward safe headers; also forward authorization for bridge JWT auth
  // and x-vault-id for vault routing. Never forward origin, referer, cookies, or proxy headers.
  for (const k of PROXY_HEADER_ALLOWLIST) {
    if (req.headers[k] !== undefined) headers[k] = req.headers[k];
  }
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers['x-vault-id']) headers['x-vault-id'] = req.headers['x-vault-id'];
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

/**
 * Read multipart/raw POST body for import proxy.
 * Netlify (serverless-http) attaches the Lambda body as Buffer on `req.body` and uses a synthetic stream;
 * `fetch(req, { duplex })` is unreliable there — always buffer then POST bytes.
 * @param {import('express').Request} req
 * @returns {Promise<Buffer>}
 */
async function bufferImportRequestBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (typeof req.body === 'string') return Buffer.from(req.body, 'latin1');
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}


/**
 * Multipart import: forward body bytes to bridge (do not use proxyTo — body is not JSON in req.body).
 * @param {string} _baseUrl - bridge origin (reserved for diagnostics; fetch URL is `url`)
 * @param {string} url - full URL to bridge /api/v1/import
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function proxyImportToBridge(_baseUrl, url, req, res) {
  let raw;
  try {
    raw = await bufferImportRequestBody(req);
  } catch (e) {
    console.error('Gateway import proxy (read body):', e.message || e);
    return res.status(500).json({ error: 'Could not read upload body', code: 'INTERNAL_ERROR' });
  }
  if (!raw.length) {
    return res.status(400).json({ error: 'Empty upload body', code: 'BAD_REQUEST' });
  }
  // Do not set `Host` manually — undici derives it from the request URL; a wrong Host breaks some upstreams.
  const headers = {
    authorization: req.headers.authorization || '',
    'x-vault-id': String(req.headers['x-vault-id'] || 'default'),
  };
  const ct = req.headers['content-type'];
  if (ct) headers['content-type'] = ct;
  headers['content-length'] = String(raw.length);
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: raw,
    });
  } catch (e) {
    console.error('Gateway import proxy error:', e.message, e.cause);
    const detail = e.cause?.message || e.message || String(e);
    return res.status(502).json({
      error: 'Bad Gateway',
      code: 'BAD_GATEWAY',
      detail,
    });
  }
  const body = await upstream.text();
  const upstreamCt = upstream.headers.get('content-type') || '';
  if (
    upstream.status >= 400 &&
    !/application\/json/i.test(upstreamCt) &&
    body.trimStart().startsWith('<')
  ) {
    return res.status(upstream.status).json({
      error: 'Import service returned a non-JSON error (check bridge Netlify function logs).',
      code: 'BAD_GATEWAY',
      detail: `HTTP ${upstream.status}`,
    });
  }
  const hop = filterUpstreamResponseHeadersForDecodedBody(upstream.headers.entries());
  res.status(upstream.status).set(Object.fromEntries(hop));
  res.send(body);
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

const metadataBulkHandlers = createMetadataBulkHandlers({
  CANISTER_URL,
  CANISTER_AUTH_SECRET,
  BRIDGE_URL,
  SESSION_SECRET: SESSION_SECRET || '',
  getUserId,
  getHostedAccessContext,
});

app.get('/api/v1/billing/summary', (req, res) => handleBillingSummary(req, res, getUserId));

/**
 * POST /api/v1/billing/checkout
 * Body: { price_id, success_url, cancel_url } OR { tier, success_url, cancel_url }
 * Returns: { url } — Stripe Checkout Session URL.
 * mode is automatically determined: subscription for tiers, payment for token packs.
 */
app.post('/api/v1/billing/checkout', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let priceId = typeof body.price_id === 'string' ? body.price_id.trim() : null;

  if (!priceId && typeof body.tier === 'string') {
    priceId = priceIdFromTierShorthand(body.tier.trim());
    if (!priceId) {
      return res.status(400).json({
        error: `Unknown tier '${body.tier}' or Stripe price env var not configured.`,
        code: 'BAD_REQUEST',
      });
    }
  }

  if (!priceId && typeof body.pack_size === 'string') {
    const packSizeMap = {
      small: process.env.STRIPE_PRICE_PACK_10 || null,
      medium: process.env.STRIPE_PRICE_PACK_25 || null,
      large: process.env.STRIPE_PRICE_PACK_50 || null,
    };
    priceId = packSizeMap[body.pack_size.toLowerCase()] || null;
    if (!priceId) {
      return res.status(400).json({
        error: `Unknown pack_size '${body.pack_size}' or Stripe pack price env var not configured.`,
        code: 'BAD_REQUEST',
      });
    }
  }

  if (!priceId) {
    return res.status(400).json({ error: 'price_id, tier, or pack_size is required', code: 'BAD_REQUEST' });
  }

  const isSub = isSubscriptionPriceId(priceId);
  const isPack = isPackPriceId(priceId);

  if (!isSub && !isPack) {
    return res.status(400).json({
      error: 'price_id is not a recognised Knowtation subscription or token pack price.',
      code: 'BAD_REQUEST',
    });
  }

  const mode = isSub ? 'subscription' : 'payment';

  const rawSuccessUrl = typeof body.success_url === 'string' ? body.success_url.trim() : '';
  const rawCancelUrl = typeof body.cancel_url === 'string' ? body.cancel_url.trim() : '';

  const fallbackBase = HUB_UI_ORIGIN || BASE_URL;
  const successUrl = rawSuccessUrl || `${fallbackBase}/hub/#settings`;
  const cancelUrl = rawCancelUrl || `${fallbackBase}/hub/#settings`;

  try {
    const { url } = await createCheckoutSession({
      priceId,
      userId: uid,
      successUrl,
      cancelUrl,
      mode,
      stripeCustomerId: null,
    });
    return res.json({ url });
  } catch (e) {
    const code = e.code || 'STRIPE_ERROR';
    if (code === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: e.message, code });
    }
    console.error('[billing/checkout] Stripe error:', e.message);
    return res.status(502).json({ error: e.message || 'Stripe checkout failed', code });
  }
});

/**
 * POST /api/v1/billing/portal
 * Body: { return_url? }
 * Returns: { url } — Stripe Billing Portal session URL.
 */
app.post('/api/v1/billing/portal', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawReturnUrl = typeof body.return_url === 'string' ? body.return_url.trim() : '';
  const fallbackBase = HUB_UI_ORIGIN || BASE_URL;
  const returnUrl = rawReturnUrl || `${fallbackBase}/hub/#settings`;

  try {
    const { url } = await createPortalSession({ userId: uid, returnUrl });
    return res.json({ url });
  } catch (e) {
    const code = e.code || 'STRIPE_ERROR';
    if (code === 'NOT_CONFIGURED') {
      return res.status(503).json({ error: e.message, code });
    }
    console.error('[billing/portal] Stripe error:', e.message);
    return res.status(502).json({ error: e.message || 'Stripe portal failed', code });
  }
});

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
        headers: { 'X-User-Id': canisterVaultUserId, Accept: 'application/json', ...canisterAuthHeaders() },
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
  let hub_evaluator_may_approve = process.env.HUB_EVALUATOR_MAY_APPROVE === '1';
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
        if (typeof data.may_approve_proposals === 'boolean') hub_evaluator_may_approve = data.may_approve_proposals;
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
  const dataDir = path.join(projectRoot, 'data');
  const llmPrefs = await loadHostedProposalLlmPrefs();
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
    proposal_enrich_enabled: effectiveHostedEnrich(llmPrefs),
    proposal_evaluation_required: effectiveHostedEvaluationRequired(llmPrefs, dataDir),
    proposal_review_hints_enabled: effectiveHostedReviewHints(llmPrefs),
    proposal_policy_stored: {
      proposal_evaluation_required: llmPrefs.proposal_evaluation_required,
      review_hints_enabled: llmPrefs.review_hints_enabled,
      enrich_enabled: llmPrefs.enrich_enabled,
    },
    proposal_policy_env_locked: proposalPolicyEnvLocked(),
    hub_evaluator_may_approve,
    proposal_rubric: loadProposalRubric(path.join(projectRoot, 'data')),
    daemon: await (async () => {
      try {
        const db = await loadBillingDb();
        const raw = db.users?.[uid] || defaultUserRecord(uid);
        const u = normalizeBillingUser(raw);
        return {
          enabled: false,
          interval_minutes: u.consolidation_interval_minutes || 120,
          idle_only: true,
          idle_threshold_minutes: 15,
          run_on_start: false,
          max_cost_per_day_usd: null,
          passes: u.consolidation_passes,
          lookback_hours: u.consolidation_lookback_hours,
          max_events_per_pass: u.consolidation_max_events_per_pass,
          max_topics_per_pass: u.consolidation_max_topics_per_pass,
          llm: {
            provider: '',
            model: '',
            base_url: '',
            max_tokens: u.consolidation_llm_max_tokens,
          },
          hosted_enabled: u.consolidation_enabled,
        };
      } catch (_) {
        return {
          enabled: false,
          interval_minutes: 120,
          idle_only: true,
          idle_threshold_minutes: 15,
          run_on_start: false,
          max_cost_per_day_usd: null,
          passes: { consolidate: true, verify: true, discover: false },
          lookback_hours: 24,
          max_events_per_pass: 200,
          max_topics_per_pass: 10,
          llm: { provider: '', model: '', base_url: '', max_tokens: 1024 },
          hosted_enabled: false,
        };
      }
    })(),
    muse_bridge: (() => {
      const envOverride = process.env.MUSE_URL != null && String(process.env.MUSE_URL).trim() !== '';
      const mc = parseMuseConfigFromEnv();
      let origin = null;
      if (mc) {
        try {
          origin = new URL(mc.baseUrl).origin;
        } catch (_) {
          /* ignore */
        }
      }
      return {
        enabled: Boolean(mc),
        origin,
        source: envOverride ? 'env' : 'none',
        env_override_active: envOverride,
        url_editable: false,
        yaml_url_for_edit: '',
      };
    })(),
  });
});

/** Hosted: Muse base URL is operator env only (not writable from Hub Settings). */
app.post('/api/v1/settings/muse', express.json(), (req, res) => {
  res.status(501).json({
    error: 'Knowtation Cloud configures the optional Muse link on the server; it cannot be set from this screen.',
    code: 'NOT_IMPLEMENTED',
  });
});

/**
 * POST /api/v1/settings/consolidation
 * Hosted mode: save consolidation schedule + pass preferences to the billing store.
 * Self-hosted daemon settings are not writable here; respond with an appropriate note.
 */
app.post('/api/v1/settings/consolidation', express.json(), async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const mode = typeof body.mode === 'string' ? body.mode : (body.enabled ? 'daemon' : 'hosted');
  const advCheck = validateHostedSettingsConsolidationAdvanced(body);
  if (!advCheck.ok) {
    return res.status(400).json({ error: advCheck.error, code: advCheck.code });
  }
  try {
    let saved = {};
    await mutateBillingDb((db) => {
      if (!db.users) db.users = {};
      if (!db.users[uid]) db.users[uid] = defaultUserRecord(uid);
      const u = normalizeBillingUser(db.users[uid]);
      if (mode === 'off') {
        u.consolidation_enabled = false;
      } else {
        u.consolidation_enabled = true;
        const iv = Math.floor(Number(body.interval_minutes) || 120);
        if (iv >= 1 && iv <= 43200) u.consolidation_interval_minutes = iv;
      }
      if (body.passes && typeof body.passes === 'object') {
        u.consolidation_passes = {
          consolidate: body.passes.consolidate !== false,
          verify: body.passes.verify !== false,
          discover: Boolean(body.passes.discover),
        };
      }
      if (body.lookback_hours !== undefined) {
        u.consolidation_lookback_hours = Math.floor(Number(body.lookback_hours));
      }
      if (body.max_events_per_pass !== undefined) {
        u.consolidation_max_events_per_pass = Math.floor(Number(body.max_events_per_pass));
      }
      if (body.max_topics_per_pass !== undefined) {
        u.consolidation_max_topics_per_pass = Math.floor(Number(body.max_topics_per_pass));
      }
      if (body.llm !== undefined && typeof body.llm === 'object' && body.llm.max_tokens !== undefined) {
        u.consolidation_llm_max_tokens = Math.floor(Number(body.llm.max_tokens));
      }
      normalizeBillingUser(u);
      saved = {
        hosted_enabled: u.consolidation_enabled,
        interval_minutes: u.consolidation_interval_minutes,
        passes: u.consolidation_passes,
        lookback_hours: u.consolidation_lookback_hours,
        max_events_per_pass: u.consolidation_max_events_per_pass,
        max_topics_per_pass: u.consolidation_max_topics_per_pass,
        llm: {
          provider: '',
          model: '',
          base_url: '',
          max_tokens: u.consolidation_llm_max_tokens,
        },
      };
    });
    res.json({ ok: true, hosted: true, daemon: { enabled: false, ...saved } });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to save', code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/settings/proposal-policy', requireAdmin, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    await mergeHostedProposalLlmPrefs({
      proposal_evaluation_required: body.proposal_evaluation_required,
      review_hints_enabled: body.review_hints_enabled,
      enrich_enabled: body.enrich_enabled,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.get('/api/v1/setup', (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  res.json({
    vault_path: '',
    vault_git: { enabled: false, remote: '' },
  });
});

// --- Admin routes: HUB_ADMIN_USER_IDS, or bridge GET /api/v1/role → role "admin" (Team tab) ---
function requireAdmin(req, res, next) {
  const uid = getUserId(req);
  if (!uid) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  if (roleForSub(uid) === 'admin') {
    next();
    return;
  }
  if (!BRIDGE_URL || !req.headers.authorization) {
    res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
    return;
  }
  void (async () => {
    try {
      const roleRes = await fetch(BRIDGE_URL + '/api/v1/role', {
        method: 'GET',
        headers: { Authorization: req.headers.authorization, Accept: 'application/json' },
      });
      if (!roleRes.ok) {
        if (!res.headersSent) res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
        return;
      }
      const data = await roleRes.json();
      if (data && data.role === 'admin') {
        next();
        return;
      }
      if (!res.headersSent) res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
    } catch (e) {
      console.warn('[gateway] requireAdmin bridge /role', e?.message || String(e));
      if (!res.headersSent) res.status(403).json({ error: 'Admin only', code: 'FORBIDDEN' });
    }
  })();
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

// Optional Muse read-only proxy (admin; Option C). 404 when MUSE_URL unset.
app.get(
  '/api/v1/operator/muse/proxy',
  (req, res, next) => {
    if (!parseMuseConfigFromEnv()) {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }
    requireAdmin(req, res, next);
  },
  async (req, res) => {
    const cfg = parseMuseConfigFromEnv();
    if (!cfg) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const rel = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!rel) return res.status(400).json({ error: 'path query required', code: 'BAD_REQUEST' });
    const result = await fetchMuseProxiedGet({ config: cfg, relativePath: rel });
    if (!result.ok && result.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: 'Invalid path', code: 'BAD_REQUEST' });
    }
    if (!result.ok && !result.body) {
      return res.status(result.status).json({ error: 'Bad gateway', code: result.code });
    }
    if (!result.ok && result.body && result.contentType) {
      res.status(result.status).set('Content-Type', result.contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      return res.send(result.body);
    }
    if (result.ok && result.body) {
      res.status(200).set('Content-Type', result.contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      return res.send(result.body);
    }
    return res.status(502).json({ error: 'Bad gateway', code: 'BAD_GATEWAY' });
  },
);

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

// POST /api/v1/import — bridge runs importers and writes notes to canister when BRIDGE_URL is set
app.post('/api/v1/import', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  if (BRIDGE_URL) {
    if (!(await runBillingGate(req, res, getUserId))) return;
    const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    await proxyImportToBridge(BRIDGE_URL, BRIDGE_URL + '/api/v1/import' + q, req, res);
    return;
  }
  res.status(501).json({
    error: 'Import is not yet available on hosted (set BRIDGE_URL for bridge-backed import).',
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

// GET /api/v1/vault/folders — no canister filesystem; UI falls back to inbox + custom path
app.get('/api/v1/vault/folders', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  if (!CANISTER_URL) {
    return res.json({ folders: ['inbox'] });
  }
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const hctx = await getHostedAccessContext(req);
  if (hctx && Array.isArray(hctx.allowed_vault_ids) && !hctx.allowed_vault_ids.includes(vaultId)) {
    return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
  }
  res.json({ folders: ['inbox'] });
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
  // Phase 12 — blockchain filters applied client-side (canister stores frontmatter as opaque JSON)
  const filterNetwork = (params.get('network') || '').trim().toLowerCase();
  const filterWallet = (params.get('wallet_address') || '').trim().toLowerCase();
  const filterPaymentStatus = (params.get('payment_status') || '').trim().toLowerCase();
  const needsClientFilter = Boolean(scope || filterNetwork || filterWallet || filterPaymentStatus);
  if (needsClientFilter) {
    params.set('limit', '10000');
    params.set('offset', '0');
  }
  // Remove Phase 12 params before forwarding to canister (canister ignores them, but keep URL clean)
  params.delete('network');
  params.delete('wallet_address');
  params.delete('payment_status');
  const fetchUrl = `${CANISTER_URL}/api/v1/notes${params.toString() ? `?${params.toString()}` : ''}`;
  try {
    const upstream = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-user-id': effective,
        'x-actor-id': uid,
        'x-vault-id': vaultId,
        ...canisterAuthHeaders(),
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
    if (needsClientFilter && Array.isArray(data.notes)) {
      let filtered = data.notes;
      // Scope filter (project/folder access control)
      if (scope) {
        const withProj = filtered.map((n) => ({
          path: n.path,
          project: materializeListFrontmatter(n.frontmatter).project ?? null,
        }));
        const kept = applyScopeFilterToNotes(withProj, scope);
        const keptPaths = new Set(kept.map((r) => r.path).filter(Boolean));
        filtered = filtered.filter((n) => n.path && keptPaths.has(n.path));
      }
      // Phase 12 blockchain filters
      if (filterNetwork || filterWallet || filterPaymentStatus) {
        filtered = filtered.filter((n) => {
          const fm = materializeListFrontmatter(n.frontmatter);
          if (filterNetwork && String(fm.network ?? '').trim().toLowerCase() !== filterNetwork) return false;
          if (filterWallet && String(fm.wallet_address ?? '').trim().toLowerCase() !== filterWallet) return false;
          if (filterPaymentStatus && String(fm.payment_status ?? '').trim().toLowerCase() !== filterPaymentStatus) return false;
          return true;
        });
      }
      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
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
        ...canisterAuthHeaders(),
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

const PROPOSAL_APPROVE_OR_DISCARD_RE = /^\/api\/v1\/proposals\/[^/]+\/(approve|discard)\/?$/;

/**
 * Bridge / JWT actor role for proposal RBAC (canister only sees effective X-User-Id).
 * @param {import('express').Request} req
 * @param {Record<string, unknown>|null} hctx
 * @returns {Promise<{ role: string, mayApproveProposals: boolean }>}
 */
async function resolveHostedActorRole(req, hctx) {
  const envFallback = process.env.HUB_EVALUATOR_MAY_APPROVE === '1';
  let role = 'member';
  let mayApproveProposals = false;
  if (hctx && typeof hctx.role === 'string') {
    role = hctx.role;
    if (typeof hctx.may_approve_proposals === 'boolean') {
      mayApproveProposals = hctx.may_approve_proposals;
    } else if (role === 'evaluator') {
      mayApproveProposals = envFallback;
    }
  } else if (BRIDGE_URL && req.headers.authorization) {
    try {
      const roleRes = await fetch(BRIDGE_URL + '/api/v1/role', {
        method: 'GET',
        headers: { Authorization: req.headers.authorization, Accept: 'application/json' },
      });
      if (roleRes.ok) {
        const data = await roleRes.json();
        if (data.role) role = data.role;
        if (typeof data.may_approve_proposals === 'boolean') {
          mayApproveProposals = data.may_approve_proposals;
        } else if (role === 'evaluator') {
          mayApproveProposals = envFallback;
        }
      }
    } catch (_) {}
  } else {
    try {
      const auth = req.headers.authorization;
      const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (token && SESSION_SECRET) {
        const payload = jwt.verify(token, SESSION_SECRET);
        role = payload.role || roleForSub(payload.sub);
        mayApproveProposals = role === 'admin' || (role === 'evaluator' && envFallback);
      }
    } catch (_) {}
  }
  return { role, mayApproveProposals };
}

/**
 * Approve/discard: enforce actor role on gateway (canister only sees effective X-User-Id).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} pathNoQuery
 * @param {string} method
 * @param {Record<string, unknown>|null} hctx from getHostedAccessContext (null if no bridge / not delegated)
 */
async function assertHostedProposalApproveDiscard(req, res, pathNoQuery, method, hctx) {
  if (method !== 'POST' || !PROPOSAL_APPROVE_OR_DISCARD_RE.test(pathNoQuery)) return true;

  const uid = getUserId(req);
  if (!uid) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return false;
  }

  const { role, mayApproveProposals } = await resolveHostedActorRole(req, hctx);

  if (/\/discard\/?$/.test(pathNoQuery)) {
    if (role !== 'admin') {
      res.status(403).json({ error: 'Discard requires admin.', code: 'FORBIDDEN' });
      return false;
    }
    return true;
  }

  const canApprove = role === 'admin' || (role === 'evaluator' && mayApproveProposals);
  if (!canApprove) {
    res.status(403).json({
      error:
        'Approve requires admin, or an evaluator with approve permission (per-user in Team, or HUB_EVALUATOR_MAY_APPROVE=1 when no per-user value).',
      code: 'FORBIDDEN',
    });
    return false;
  }
  return true;
}

/**
 * Fetch the current note count for a user from the canister.
 * Used by the billing storage cap gate before note CREATE.
 * Fails open — returns 0 on any error so the gate never blocks due to a canister outage.
 *
 * @param {string} userId
 * @param {import('express').Request} req
 * @returns {Promise<number>}
 */
async function getNoteCountForUser(userId, req) {
  if (!CANISTER_URL) return 0;
  try {
    const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
    const hctx = await getHostedAccessContext(req);
    const effective =
      hctx && typeof hctx.effective_canister_user_id === 'string' && hctx.effective_canister_user_id
        ? hctx.effective_canister_user_id
        : userId;
    const url = `${CANISTER_URL}/api/v1/notes?limit=1&offset=0`;
    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-user-id': effective,
        'x-actor-id': userId,
        'x-vault-id': vaultId,
        ...canisterAuthHeaders(),
      },
    });
    if (!upstream.ok) return 0;
    const data = await upstream.json();
    const total = typeof data.total === 'number' ? data.total : (Array.isArray(data.notes) ? data.notes.length : 0);
    return Math.max(0, Math.floor(total));
  } catch (_) {
    return 0;
  }
}

async function proxyToCanister(req, res) {
  const uid = getUserId(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const pathOnly = effectiveRequestPath(req);
  const pathNoQuery = pathPartNoQuery(req);
  const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
  const hctx = await getHostedAccessContext(req);
  if (!(await assertHostedProposalApproveDiscard(req, res, pathNoQuery, req.method, hctx))) return;
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
    host: new URL(CANISTER_URL).host,
    'x-user-id': effective,
    'x-actor-id': uid,
    'x-vault-id': req.headers['x-vault-id'] || 'default',
    ...canisterAuthHeaders(),
  };
  // Allowlist: only forward safe body/content headers; canister auth is via x-user-id + x-gateway-auth.
  // Never forward origin, referer, cookies, authorization, or other proxy headers to the canister.
  for (const k of PROXY_HEADER_ALLOWLIST) {
    if (req.headers[k] !== undefined) headers[k] = req.headers[k];
  }
  const opts = { method: req.method, headers };
  let bodyOut = req.body;
  const pathOnlyForBody = pathPartNoQuery(req);
  const dataDir = path.join(projectRoot, 'data');
  let hostedLlmPrefs = null;
  if (
    req.method === 'POST' &&
    (pathOnlyForBody === '/api/v1/proposals' || pathOnlyForBody === '/api/v1/proposals/')
  ) {
    hostedLlmPrefs = await loadHostedProposalLlmPrefs();
  }
  // Improvement B: AIR attestation for hosted gateway note writes.
  // Guarded by KNOWTATION_AIR_ENDPOINT being set; always non-blocking (gateway has no air.required config).
  let gatewayAirId = null;
  if (
    process.env.KNOWTATION_AIR_ENDPOINT &&
    bodyOut !== undefined &&
    typeof bodyOut === 'object' &&
    !Buffer.isBuffer(bodyOut) &&
    isNoteWriteRequest(req.method, pathOnlyForBody)
  ) {
    try {
      const notePath =
        req.method === 'POST'
          ? (typeof bodyOut.path === 'string' ? bodyOut.path.replace(/\\/g, '/') : '')
          : pathOnlyForBody
              .slice('/api/v1/notes/'.length)
              .split('/')
              .map(decodeURIComponent)
              .join('/');
      const { attestBeforeWrite: gwAttest } = await import('../../lib/air.mjs');
      const airId = await gwAttest(
        { air: { enabled: true, required: false, endpoint: process.env.KNOWTATION_AIR_ENDPOINT } },
        notePath
      );
      if (airId && airId !== 'air-placeholder-write') {
        gatewayAirId = airId;
      }
    } catch (e) {
      // Never let an AIR failure block a hosted write; log and continue.
      console.error('[gateway] AIR attestation error (non-fatal):', e?.message || String(e));
    }
  }

  if (
    bodyOut !== undefined &&
    typeof bodyOut === 'object' &&
    !Buffer.isBuffer(bodyOut) &&
    isPostApiV1Notes(req.method, pathOnlyForBody)
  ) {
    bodyOut = mergeHostedNoteBodyForCanister(bodyOut, uid, gatewayAirId);
  } else if (
    gatewayAirId &&
    bodyOut !== undefined &&
    typeof bodyOut === 'object' &&
    !Buffer.isBuffer(bodyOut) &&
    req.method === 'PUT' &&
    pathOnlyForBody.startsWith('/api/v1/notes/')
  ) {
    // PUT note write: inject air_id into frontmatter alongside existing fields
    bodyOut = mergeHostedNoteBodyForCanister(bodyOut, uid, gatewayAirId);
  }
  if (bodyOut !== undefined && typeof bodyOut === 'object' && !Buffer.isBuffer(bodyOut)) {
    bodyOut = augmentProposalEvaluationBodyForCanister(req.method, pathOnlyForBody, bodyOut);
    const policyOpts =
      hostedLlmPrefs != null
        ? { evaluationRequired: effectiveHostedEvaluationRequired(hostedLlmPrefs, dataDir) }
        : {};
    bodyOut = augmentProposalCreateForHosted(req.method, pathOnlyForBody, bodyOut, dataDir, policyOpts);
    if (req.method === 'POST') {
      const approveId = proposalIdFromApprovePath(pathOnlyForBody);
      if (approveId) {
        try {
          const museCfg = parseMuseConfigFromEnv();
          const resolved = await resolveExternalRefForApprove({
            clientRef: bodyOut.external_ref,
            proposalId: approveId,
            vaultId,
            config: museCfg,
            logWarn: (msg, extra) => console.warn(msg, extra != null ? JSON.stringify(extra) : ''),
          });
          if (resolved) {
            bodyOut = { ...bodyOut, external_ref: resolved };
          }
        } catch (e) {
          console.warn('[gateway] muse approve merge (non-fatal):', e?.message || String(e));
        }
      }
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && bodyOut !== undefined) {
    opts.body = typeof bodyOut === 'string' ? bodyOut : JSON.stringify(bodyOut);
    stripStaleOutboundBodyHeaders(headers);
  }
  try {
    const upstream = await fetch(url, opts);
    const body = await upstream.text();
    // For a successful proposal CREATE, extract path+body so the hints job can skip
    // its own canister GET (saves one ICP round trip, ~1–3 s, from the hints path).
    let parsedProposalData = null;
    if (
      req.method === 'POST' &&
      (pathOnlyForBody === '/api/v1/proposals' || pathOnlyForBody === '/api/v1/proposals/') &&
      upstream.status >= 200 && upstream.status < 300
    ) {
      try {
        const j = JSON.parse(body);
        if (j && typeof j.proposal_id === 'string') {
          parsedProposalData = {
            path: j.path != null ? String(j.path) : '',
            body: j.body != null ? String(j.body) : '',
          };
        }
      } catch (_) {}
    }
    try {
      await maybeScheduleHostedProposalReviewHints({
        method: req.method,
        pathOnly: pathOnlyForBody,
        upstreamStatus: upstream.status,
        responseText: body,
        canisterUrl: CANISTER_URL,
        effectiveUserId: effective,
        actorUserId: uid,
        vaultId,
        hintsEnabled: hostedLlmPrefs ? effectiveHostedReviewHints(hostedLlmPrefs) : false,
        proposalData: parsedProposalData,
      });
    } catch (e) {
      // Never let a hints failure affect the primary proxy response.
      console.error('[gateway] hints exception (non-fatal):', e?.message || String(e));
    }
    if (upstream.status >= 400 && req.method === 'GET' && url.includes('/api/v1/notes/')) {
      console.warn('[gateway] canister GET note:', upstream.status, 'url:', url.slice(0, 120));
    }
    if (
      upstream.status === 404 &&
      req.method === 'POST' &&
      /\/api\/v1\/proposals\/[^/]+\/evaluation\/?(\?|$)/.test(pathOnlyForBody)
    ) {
      console.warn(
        '[gateway] canister returned 404 for POST …/evaluation. If the body is {"error":"Not found","code":"NOT_FOUND"}, the hub canister on mainnet likely predates the evaluation route or HTTP upgrade for it — redeploy `hub` from this repo (`hub/icp/README.md` §ICP HTTP gateway behavior).',
      );
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

// Bulk metadata by effective project slug (canister orchestration; not a canister route)
app.post('/api/v1/notes/delete-by-project', async (req, res) => {
  if (!(await runBillingGate(req, res, getUserId))) return;
  return metadataBulkHandlers.deleteByProject(req, res);
});
app.post('/api/v1/notes/rename-project', async (req, res) => {
  if (!(await runBillingGate(req, res, getUserId))) return;
  return metadataBulkHandlers.renameProject(req, res);
});

/** Hosted Enrich: gateway runs LLM and POSTs to canister (not proxied as opaque POST). */
app.post('/api/v1/proposals/:proposalId/enrich', async (req, res) => {
  // Express 4 does not auto-catch async route handler exceptions; wrap everything so a
  // rejected promise never leaves the request hanging until Netlify's Lambda timeout.
  try {
    if (!(await runBillingGate(req, res, getUserId))) return;
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    const proposalId = req.params.proposalId;
    const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
    const hctx = await getHostedAccessContext(req);
    if (hctx && Array.isArray(hctx.allowed_vault_ids) && !hctx.allowed_vault_ids.includes(vaultId)) {
      return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
    }
    const { role } = await resolveHostedActorRole(req, hctx);
    if (role === 'viewer') {
      return res.status(403).json({ error: 'This action requires a different role.', code: 'FORBIDDEN' });
    }
    const effective =
      hctx && typeof hctx.effective_canister_user_id === 'string' && hctx.effective_canister_user_id
        ? hctx.effective_canister_user_id
        : uid;
    const llmPrefs = await loadHostedProposalLlmPrefs();
    const enrichEnabled = effectiveHostedEnrich(llmPrefs);
    // Diagnostic: log which LLM provider will be used (visible in Netlify function logs).
    console.log(
      '[gateway/enrich] proposalId=%s enrichEnabled=%s provider=%s',
      proposalId,
      enrichEnabled,
      process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'ollama(NO KEY)',
    );
    const out = await runHostedProposalEnrichAndPost({
      canisterUrl: CANISTER_URL,
      effectiveUserId: effective,
      actorUserId: uid,
      vaultId,
      proposalId,
      enrichEnabled,
    });
    if (!out.ok) {
      if (out.status === 404 && out.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      }
      if (out.status === 404) {
        return res.status(404).json({ error: 'Proposal not found', code: 'NOT_FOUND' });
      }
      if (out.status === 400) {
        return res.status(400).json({ error: out.detail || 'Bad request', code: out.code || 'BAD_REQUEST' });
      }
      return res.status(out.status || 500).json({
        error: out.detail || out.code || 'Enrich failed',
        code: out.code || 'RUNTIME_ERROR',
      });
    }
    // Return immediately — the frontend calls openProposal() + loadProposals() after this
    // which re-fetches the updated proposal. Eliminating the extra canister GET here removes
    // one full ICP round trip (~1–3 s) from the critical path and prevents Netlify timeout.
    return res.set('Cache-Control', 'private, no-store, must-revalidate').json({ ok: true });
  } catch (e) {
    console.error('[gateway/enrich] unhandled exception:', e?.stack || e?.message || e);
    if (!res.headersSent) {
      res.status(500).json({ error: e?.message || 'Internal error', code: 'INTERNAL_ERROR' });
    }
  }
});

// ---------------------------------------------------------------------------
// AIR Improvement D — built-in attestation endpoint
// ---------------------------------------------------------------------------

app.post('/api/v1/attest', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  if (!isAttestationConfigured()) {
    return res.status(503).json({
      error: 'Attestation service not configured (ATTESTATION_SECRET missing or too short).',
      code: 'NOT_CONFIGURED',
    });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) {
    return res.status(400).json({ error: 'action is required', code: 'BAD_REQUEST' });
  }
  const notePath = typeof body.path === 'string' ? body.path : '';
  const contentHash = typeof body.content_hash === 'string' ? body.content_hash : null;
  try {
    const result = await createAttestation(action, notePath, contentHash);
    return res.json(result);
  } catch (e) {
    console.error('[gateway] POST /api/v1/attest error:', e?.message || e);
    return res.status(500).json({ error: 'Attestation failed', code: 'INTERNAL_ERROR' });
  }
});

app.get('/api/v1/attest/:id', async (req, res) => {
  if (!isAttestationConfigured()) {
    return res.status(503).json({
      error: 'Attestation service not configured (ATTESTATION_SECRET missing or too short).',
      code: 'NOT_CONFIGURED',
    });
  }
  const id = req.params.id;
  if (!id || !id.startsWith('air-')) {
    return res.status(400).json({ error: 'Invalid attestation id format', code: 'BAD_REQUEST' });
  }
  try {
    const result = await verifyAttestation(id);
    if (!result.record) {
      return res.status(404).json({ error: 'Attestation not found', code: 'NOT_FOUND' });
    }
    return res.json(result);
  } catch (e) {
    console.error('[gateway] GET /api/v1/attest/:id error:', e?.message || e);
    return res.status(500).json({ error: 'Verification failed', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// AIR Improvement E — ICP blockchain anchor verification + reconciliation
// ---------------------------------------------------------------------------

app.get('/api/v1/attest/:id/verify', async (req, res) => {
  if (!isAttestationConfigured()) {
    return res.status(503).json({
      error: 'Attestation service not configured (ATTESTATION_SECRET missing or too short).',
      code: 'NOT_CONFIGURED',
    });
  }
  const id = req.params.id;
  if (!id || !id.startsWith('air-')) {
    return res.status(400).json({ error: 'Invalid attestation id format', code: 'BAD_REQUEST' });
  }
  try {
    const result = await verifyWithIcp(id);
    if (!result.sources.blobs.found && !result.sources.icp.found) {
      return res.status(404).json({ error: 'Attestation not found', code: 'NOT_FOUND', ...result });
    }
    return res.json(result);
  } catch (e) {
    console.error('[gateway] GET /api/v1/attest/:id/verify error:', e?.message || e);
    return res.status(500).json({ error: 'Verification failed', code: 'INTERNAL_ERROR' });
  }
});

app.post('/api/v1/attest/anchor-pending', requireAdmin, async (req, res) => {
  if (!isAttestationConfigured()) {
    return res.status(503).json({
      error: 'Attestation service not configured (ATTESTATION_SECRET missing or too short).',
      code: 'NOT_CONFIGURED',
    });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && x.startsWith('air-')) : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'ids array with air-* entries is required', code: 'BAD_REQUEST' });
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 IDs per batch', code: 'BAD_REQUEST' });
  }
  try {
    const result = await anchorPendingAttestations(ids);
    return res.json(result);
  } catch (e) {
    console.error('[gateway] POST /api/v1/attest/anchor-pending error:', e?.message || e);
    return res.status(500).json({ error: 'Anchor failed', code: 'INTERNAL_ERROR' });
  }
});

app.use('/api/v1', async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!(await runBillingGate(req, res, getUserId, { getNoteCount: getNoteCountForUser }))) return;
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

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[gateway] unhandled error:', err?.stack || err?.message || err);
  const status =
    typeof err.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
  res.status(status).json({
    error: err.message || 'Internal error',
    code: err.code || 'INTERNAL_ERROR',
  });
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
  if (!CANISTER_AUTH_SECRET && CANISTER_URL) {
    console.warn(
      '\x1b[33m[SECURITY] CANISTER_AUTH_SECRET is not set. ' +
      'The canister will not verify gateway identity. ' +
      'Set CANISTER_AUTH_SECRET and call admin_set_gateway_auth_secret on the canister before public launch.\x1b[0m'
    );
  }
  if (CANISTER_URL && !billingEnforced()) {
    console.warn(
      '\x1b[33m[SECURITY] BILLING_ENFORCE is not set to true. ' +
      'Billing limits (storage cap, usage gates) are not enforced. ' +
      'Set BILLING_ENFORCE=true before public launch on hosted deployment.\x1b[0m'
    );
  }
  app.listen(PORT, () => {
    console.log(`Knowtation Hub Gateway listening on http://localhost:${PORT}`);
    console.log('  Canister: ' + CANISTER_URL);
    console.log('  UI origin: ' + HUB_UI_ORIGIN);
    console.log('  Login: GET /auth/login?provider=google|github');
  });
}

export { app };
