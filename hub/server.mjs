/**
 * Knowtation Hub — REST API + OAuth + JWT. Phase 11.
 * Run from repo root: node hub/server.mjs
 * Env: KNOWTATION_VAULT_PATH, HUB_JWT_SECRET, HUB_PORT; optional HUB_CORS_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, HUB_BASE_URL, HUB_PROPOSAL_EVALUATION_REQUIRED (see lib/hub-proposal-policy.mjs), HUB_EVALUATOR_MAY_APPROVE=1 (fallback when no per-user row in data/hub_evaluator_may_approve.json), KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS=1 (async LLM hints; not a gate).
 */

import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';

import { loadConfig } from '../lib/config.mjs';
import { runListNotes, runFacets } from '../lib/list-notes.mjs';
import {
  readNote,
  normalizeSlug,
  resolveVaultRelativePath,
  noteFileExistsInVault,
  listVaultFolderOptions,
} from '../lib/vault.mjs';
import { writeNote, deleteNote, deleteNotesByPrefix } from '../lib/write.mjs';
import { deleteNotesByProjectSlug, renameProjectSlugInVault } from '../lib/hub-bulk-metadata.mjs';
import { mergeProvenanceFrontmatter } from '../lib/hub-provenance.mjs';
import { runSearch } from '../lib/search.mjs';
import { exportNoteToContent } from '../lib/export.mjs';
import { runImport } from '../lib/import.mjs';
import { IMPORT_SOURCE_TYPES } from '../lib/import-source-types.mjs';
import { noteStateIdFromParts, absentNoteStateId } from '../lib/note-state-id.mjs';
import { completeChat } from '../lib/llm-complete.mjs';
import {
  listProposals,
  getProposal,
  createProposal,
  updateProposalStatus,
  updateProposalEnrichment,
  discardProposalsUnderPathPrefix,
  discardProposalsAtPaths,
  submitProposalEvaluation,
  mergeEvaluationChecklist,
  evaluationAllowsApprove,
} from './proposals-store.mjs';
import { loadProposalRubric } from '../lib/hub-proposal-rubric.mjs';
import { getProposalEvaluationRequired } from '../lib/hub-proposal-policy.mjs';
import { loadReviewTriggers, applyReviewTriggers } from '../lib/hub-proposal-review-triggers.mjs';
import { runProposalReviewHintsJob } from '../lib/hub-proposal-review-hints-job.mjs';
import { appendAudit } from './audit-log.mjs';
import { maybeAutoSync, runVaultSync } from '../lib/vault-git-sync.mjs';
import { readHubSetup, writeHubSetup } from '../lib/hub-setup.mjs';
import { readConnection as readGitHubConnection, writeConnection as writeGitHubConnection } from '../lib/github-connection.mjs';
import { loadRoleMap, getRole, readRolesObject, writeRolesFile } from './roles.mjs';
import { createInvite, consumeInvite, revokeInvite, listInvites } from './invites.mjs';
import { getAllowedVaultIds, readVaultAccess, writeVaultAccess } from './hub_vault_access.mjs';
import { getScopeForUserVault, readScope, writeScope } from './hub_scope.mjs';
import { readHubVaults, writeHubVaults } from '../lib/hub-vaults.mjs';
import { deleteSelfHostedVault } from './hub-delete-vault.mjs';
import { applyScopeFilterToNotes as applyScopeFilter } from './lib/scope-filter.mjs';
import {
  readEvaluatorMayApprove,
  writeEvaluatorMayApprove,
  actorMayApproveProposals,
} from './lib/hub-evaluator-may-approve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
// Load .env from project root
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const PORT = parseInt(process.env.HUB_PORT || '3333', 10);
const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.HUB_JWT_SECRET || (isProduction ? null : 'change-me-in-production');
if (isProduction && !process.env.HUB_JWT_SECRET) {
  console.error('Hub: HUB_JWT_SECRET is required in production. Set in .env.');
  process.exit(1);
}
const BASE_URL = process.env.HUB_BASE_URL || `http://localhost:${PORT}`;
const JWT_EXPIRY = process.env.HUB_JWT_EXPIRY || '1h';

let config;
try {
  config = loadConfig(projectRoot);
} catch (e) {
  console.error('Hub: config load failed. Set KNOWTATION_VAULT_PATH.', e.message);
  process.exit(1);
}

/** Phase 13: role store (data/hub_roles.json). Reloaded when config is reloaded (e.g. after POST setup). */
let roleMap = loadRoleMap(config.data_dir);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/api/v1/auth/callback/google`,
      },
      (_accessToken, _refreshToken, profile, done) => {
        return done(null, { provider: 'google', id: profile.id, displayName: profile.displayName });
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
        callbackURL: `${BASE_URL}/api/v1/auth/callback/github`,
      },
      (_accessToken, _refreshToken, profile, done) => {
        return done(null, { provider: 'github', id: profile.id, displayName: profile.username });
      }
    )
  );
}

/**
 * Issue JWT for authenticated user. Payload includes `role` from role store (Phase 13).
 * When no roles file exists (or it is empty), everyone gets role 'admin' — no manual setup
 * or hardcoded IDs; every new install works and the Team tab is visible. Once the file has
 * at least one entry, only listed users get that role; others get getRole() default 'member'.
 */
function issueToken(user) {
  const sub = `${user.provider}:${user.id}`;
  const role = roleMap.size === 0 ? 'admin' : getRole(roleMap, sub);
  return jwt.sign(
    { sub, name: user.displayName, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function parseQueryBounds(req, res, next) {
  const limitRaw = req.query?.limit != null ? parseInt(req.query.limit, 10) : undefined;
  const offsetRaw = req.query?.offset != null ? parseInt(req.query.offset, 10) : undefined;
  if (limitRaw != null && (isNaN(limitRaw) || limitRaw < 0 || limitRaw > 100)) {
    return res.status(400).json({ error: 'limit must be 0–100', code: 'BAD_REQUEST' });
  }
  if (offsetRaw != null && (isNaN(offsetRaw) || offsetRaw < 0)) {
    return res.status(400).json({ error: 'offset must be non-negative', code: 'BAD_REQUEST' });
  }
  next();
}

function jwtAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }
}

/**
 * Phase 13: effective role for permission checks and Settings UI.
 * Always derived from hub_roles.json (roleMap), not from the JWT payload, so Team role changes
 * apply without forcing users to log out and back in. JWT `role` is only set at login time.
 */
function effectiveRole(req) {
  if (roleMap.size === 0) return 'admin';
  const sub = req.user?.sub ?? '';
  const gr = getRole(roleMap, sub);
  return gr === 'member' || !gr ? 'editor' : gr;
}

/** Phase 13: require one of the given roles (viewer, editor, admin, evaluator). Must run after jwtAuth. */
function requireRole(...allowedRoles) {
  const set = new Set(allowedRoles);
  return (req, res, next) => {
    const role = effectiveRole(req);
    if (set.has(role)) return next();
    return res.status(403).json({ error: 'This action requires a different role.', code: 'FORBIDDEN' });
  };
}

function hubEnvEvaluatorMayApprove() {
  return process.env.HUB_EVALUATOR_MAY_APPROVE === '1';
}

/** Approve: admin always; evaluator per data/hub_evaluator_may_approve.json + env fallback. */
function requireApproveRole(req, res, next) {
  const role = effectiveRole(req);
  const sub = req.user?.sub ?? '';
  const mayMap = readEvaluatorMayApprove(config.data_dir);
  if (actorMayApproveProposals(sub, role, mayMap, hubEnvEvaluatorMayApprove())) return next();
  return res.status(403).json({
    error:
      'Approve requires admin, or an evaluator with approve permission (Team tab / data/hub_evaluator_may_approve.json, or HUB_EVALUATOR_MAY_APPROVE=1 when no per-user entry).',
    code: 'FORBIDDEN',
  });
}

/** Phase 15: resolve vault_id to path, check access, set req.vaultPath and req.scope. Must run after jwtAuth. */
function requireVaultAccess(req, res, next) {
  const allowed = getAllowedVaultIds(config.data_dir, req.user?.sub ?? '');
  if (!allowed.includes(req.vault_id)) {
    return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
  }
  const vaultPath = config.resolveVaultPath(req.vault_id);
  if (!vaultPath) {
    return res.status(404).json({ error: 'Vault not found.', code: 'NOT_FOUND' });
  }
  req.vaultPath = vaultPath;
  req.scope = getScopeForUserVault(config.data_dir, req.user?.sub ?? '', req.vault_id);
  next();
}

const app = express();
const corsOrigin = process.env.HUB_CORS_ORIGIN;
app.use(cors({ origin: corsOrigin ? corsOrigin.split(',') : true, credentials: true }));
app.use(express.json());
app.use(passport.initialize());

// Rate limits
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many login attempts', code: 'RATE_LIMIT' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests', code: 'RATE_LIMIT' } });

function captureAuth(req, res, next) {
  const secret = process.env.CAPTURE_WEBHOOK_SECRET;
  if (!secret) return next();
  const provided = req.headers['x-webhook-secret'];
  if (provided === secret) return next();
  return res.status(401).json({ error: 'Invalid or missing X-Webhook-Secret', code: 'UNAUTHORIZED' });
}

function sanitizeForFilename(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';
}

// Health (no auth)
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));

// Which OAuth providers are configured (no auth; UI uses this to show buttons vs setup help)
app.get('/api/v1/auth/providers', (_req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  });
});

// Auth: login redirect (rate limited). Optional ?invite=TOKEN passed through state for Phase 13 invite.
app.get('/api/v1/auth/login', loginLimiter, (req, res, next) => {
  const provider = (req.query.provider || 'google').toLowerCase();
  const inviteToken = typeof req.query.invite === 'string' ? req.query.invite.trim() : null;
  const stateOpt = inviteToken ? { state: signState({ invite: inviteToken, ts: Date.now() }) } : {};
  if (provider === 'google' && process.env.GOOGLE_CLIENT_ID) {
    return passport.authenticate('google', { scope: ['profile'], ...stateOpt })(req, res, next);
  }
  if (provider === 'github' && process.env.GITHUB_CLIENT_ID) {
    return passport.authenticate('github', { scope: ['user:email'], ...stateOpt })(req, res, next);
  }
  return res.status(400).json({ error: `Unknown or disabled provider: ${provider}`, code: 'BAD_REQUEST' });
});

// Auth: OAuth callbacks. If state contains invite token, consume it and re-issue JWT with new role.
function handleAuthCallback(req, res) {
  const redirect = (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');
  let token = issueToken(req.user);
  const statePayload = req.query.state ? verifyState(req.query.state, 7 * 24 * 60 * 60 * 1000) : null;
  if (statePayload && statePayload.invite && req.user && req.user.id) {
    const sub = `${req.user.provider}:${req.user.id}`;
    const consumed = consumeInvite(config.data_dir, statePayload.invite, sub);
    if (consumed) {
      roleMap = loadRoleMap(config.data_dir);
      token = issueToken(req.user);
      return res.redirect(`${redirect}/?token=${encodeURIComponent(token)}&invite_accepted=1`);
    }
  }
  res.redirect(`${redirect}/?token=${encodeURIComponent(token)}`);
}
app.get(
  '/api/v1/auth/callback/google',
  passport.authenticate('google', { session: false }),
  handleAuthCallback
);
app.get(
  '/api/v1/auth/callback/github',
  passport.authenticate('github', { session: false }),
  handleAuthCallback
);

// Connect GitHub (repo scope): redirect to GitHub, then callback saves token for vault push
function signState(statePayload) {
  const payload = JSON.stringify(statePayload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}
function verifyState(stateStr, maxAgeMs = 600000) {
  const [payloadB64, sig] = String(stateStr).split('.');
  if (!payloadB64 || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
    if (expected !== sig) return null;
    if (Date.now() - (payload.ts || 0) > maxAgeMs) return null;
    return payload;
  } catch (_) {
    return null;
  }
}
app.get('/api/v1/auth/github-connect', (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.redirect((process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '') + '/?github_connect_error=not_configured');
  }
  const state = signState({ r: crypto.randomBytes(16).toString('hex'), ts: Date.now() });
  const redirectUri = BASE_URL + '/api/v1/auth/callback/github-connect';
  const url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(process.env.GITHUB_CLIENT_ID) + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&scope=repo&state=' + encodeURIComponent(state);
  res.redirect(url);
});
app.get('/api/v1/auth/callback/github-connect', async (req, res) => {
  const { code, state } = req.query || {};
  const baseRedirect = (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');
  if (!verifyState(state)) {
    return res.redirect(baseRedirect + '/?github_connect_error=invalid_state');
  }
  if (!code || !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return res.redirect(baseRedirect + '/?github_connect_error=missing');
  }
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: BASE_URL + '/api/v1/auth/callback/github-connect',
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.redirect(baseRedirect + '/?github_connect_error=no_token');
    }
    writeGitHubConnection(config.data_dir, { access_token: accessToken });
    return res.redirect(baseRedirect + '/?github_connected=1');
  } catch (e) {
    return res.redirect(baseRedirect + '/?github_connect_error=' + encodeURIComponent(e.message || 'exchange_failed'));
  }
});

// Vault context for multi-vault / canister: optional X-Vault-Id header or vault_id query (Phase 0 / hosted)
app.use('/api/v1', (req, res, next) => {
  const raw = req.get('X-Vault-Id') || req.query.vault_id;
  req.vault_id = typeof raw === 'string' && raw.trim() ? raw.trim() : 'default';
  next();
});

// POST /api/v1/capture — webhook for Slack, Discord, etc. (no JWT; optional X-Webhook-Secret)
app.post('/api/v1/capture', captureAuth, (req, res) => {
  const payload = req.body || {};
  const body = payload.body;
  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body (string) is required', code: 'BAD_REQUEST' });
  }
  const source = payload.source || 'webhook';
  const sourceId = payload.source_id || null;
  const project = payload.project || null;
  const tags = payload.tags || null;
  const now = new Date().toISOString().slice(0, 10);
  const sourceSlug = normalizeSlug(source) || 'webhook';
  const filename = sourceId
    ? `${sourceSlug}_${sanitizeForFilename(sourceId)}.md`
    : `${sourceSlug}_${Date.now()}.md`;
  const relativePath = project
    ? `projects/${normalizeSlug(project)}/inbox/${filename}`
    : `inbox/${filename}`;
  const baseFm = {
    source,
    date: now,
    ...(sourceId && { source_id: sourceId }),
    ...(project && { project: normalizeSlug(project) }),
    ...(tags && { tags }),
  };
  const frontmatter = mergeProvenanceFrontmatter(baseFm, { kind: 'webhook' });
  try {
    const result = writeNote(config.vault_path, relativePath, { body: body.trimEnd(), frontmatter });
    invalidateFacetsCache();
    maybeAutoSync(config);
    res.status(200).json({ ok: true, path: result.path });
  } catch (e) {
    if (e.message && e.message.includes('Invalid path')) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// API v1 (JWT + rate limit + vault access for notes/search/proposals)
app.use('/api/v1/notes', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/search', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/proposals', jwtAuth, apiLimiter, requireVaultAccess);

// Facets cache (60s) per vault; invalidate on write/approve
const FACETS_TTL_MS = 60 * 1000;
const facetsCacheByVault = {};
function invalidateFacetsCache() {
  Object.keys(facetsCacheByVault).forEach((k) => delete facetsCacheByVault[k]);
}

// GET /api/v1/vault/folders — disk folders for Hub “New note” picker (self-hosted; empty on hosted gateway stub)
app.get('/api/v1/vault/folders', jwtAuth, apiLimiter, requireVaultAccess, (req, res) => {
  try {
    const folders = listVaultFolderOptions(req.vaultPath);
    res.json({ folders });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/notes/facets — filter dropdown values (before /:path to avoid collision)
app.get('/api/v1/notes/facets', (req, res) => {
  try {
    const vid = req.vault_id ?? 'default';
    const cached = facetsCacheByVault[vid];
    if (cached?.data && Date.now() - cached.ts < FACETS_TTL_MS) {
      return res.json(cached.data);
    }
    const vaultConfig = { ...config, vault_path: req.vaultPath };
    let facets = runFacets(vaultConfig);
    if (req.scope?.projects?.length || req.scope?.folders?.length) {
      const notes = runListNotes(vaultConfig, { fields: 'path+metadata' });
      const filtered = applyScopeFilter(notes.notes || [], req.scope);
      const projects = new Set();
      const tags = new Set();
      const folders = new Set();
      for (const n of filtered) {
        if (n.project) projects.add(n.project);
        for (const t of n.tags || []) if (t) tags.add(t);
        const folder = n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : '';
        if (folder) folders.add(folder);
      }
      facets = { projects: [...projects].sort(), tags: [...tags].sort(), folders: [...folders].sort() };
    }
    facetsCacheByVault[vid] = { data: facets, ts: Date.now() };
    res.json(facets);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/notes — list notes
app.get('/api/v1/notes', parseQueryBounds, (req, res) => {
  try {
    const limit = req.query.limit != null ? Math.min(100, Math.max(0, parseInt(req.query.limit, 10) || 20)) : 20;
    const offset = req.query.offset != null ? Math.max(0, parseInt(req.query.offset, 10) || 0) : 0;
    const opts = {
      folder: req.query.folder,
      project: req.query.project,
      tag: req.query.tag,
      since: req.query.since,
      until: req.query.until,
      chain: req.query.chain,
      entity: req.query.entity,
      episode: req.query.episode,
      limit,
      offset,
      order: req.query.order,
      fields: req.query.fields || 'path+metadata',
      countOnly: req.query.count_only === 'true',
    };
    const vaultConfig = { ...config, vault_path: req.vaultPath };
    const out = (req.scope?.projects?.length || req.scope?.folders?.length)
      ? (() => {
          const full = runListNotes(vaultConfig, { ...opts, limit: 10000, offset: 0 });
          const filtered = applyScopeFilter(full.notes || [], req.scope);
          return { notes: filtered.slice(offset, offset + limit), total: filtered.length };
        })()
      : runListNotes(vaultConfig, opts);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/notes/:path — get one note (path may contain slashes)
app.get(/^\/api\/v1\/notes\/(.+)$/, (req, res) => {
  const notePath = req.path.replace(/^\/api\/v1\/notes\//, '');
  if (!notePath) return res.status(400).json({ error: 'Path required', code: 'BAD_REQUEST' });
  try {
    const note = readNote(req.vaultPath, decodeURIComponent(notePath));
    res.json({ path: note.path, frontmatter: note.frontmatter, body: note.body });
  } catch (e) {
    if (e.message && e.message.includes('not found')) return res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/search — semantic search
app.post('/api/v1/search', async (req, res) => {
  const query = req.body?.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required', code: 'BAD_REQUEST' });
  }
  const rawLimit = req.body?.limit;
  const limit = rawLimit != null ? Math.min(100, Math.max(0, parseInt(rawLimit, 10) || 20)) : 20;
  try {
    const opts = {
      folder: req.body.folder,
      project: req.body.project,
      tag: req.body.tag,
      limit,
      since: req.body.since,
      until: req.body.until,
      order: req.body.order,
      fields: req.body.fields,
      vault_id: req.vault_id,
    };
    const vaultConfig = { ...config, vault_path: req.vaultPath };
    let out = await runSearch(query, opts, vaultConfig);
    if (out.results && req.vaultPath) {
      out = {
        ...out,
        results: out.results.filter((r) => r && noteFileExistsInVault(req.vaultPath, r.path)),
      };
    }
    if ((req.scope?.projects?.length || req.scope?.folders?.length) && out.results) {
      out = { ...out, results: applyScopeFilter(out.results, req.scope) };
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/notes — write note (Phase 13: editor or admin)
app.post('/api/v1/notes', requireRole('editor', 'admin'), (req, res) => {
  const { path: notePath, body, frontmatter, append } = req.body || {};
  if (!notePath || typeof notePath !== 'string') {
    return res.status(400).json({ error: 'path required', code: 'BAD_REQUEST' });
  }
  try {
    const fm = mergeProvenanceFrontmatter(frontmatter, {
      sub: req.user?.sub ?? null,
      kind: 'human',
    });
    const out = writeNote(req.vaultPath, notePath, { body, frontmatter: fm, append });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: req.vaultPath });
    res.json(out);
  } catch (e) {
    if (e.message && e.message.includes('Invalid path')) return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// DELETE /api/v1/notes/:path — delete note (editor or admin)
app.delete(/^\/api\/v1\/notes\/(.+)$/, requireRole('editor', 'admin'), (req, res) => {
  const notePath = req.path.replace(/^\/api\/v1\/notes\//, '');
  if (!notePath) return res.status(400).json({ error: 'Path required', code: 'BAD_REQUEST' });
  try {
    const out = deleteNote(req.vaultPath, decodeURIComponent(notePath));
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: req.vaultPath });
    res.json(out);
  } catch (e) {
    if (e.message && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    }
    if (e.message && e.message.includes('Invalid path')) return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/notes/delete-by-prefix — bulk delete notes under a vault-relative prefix (editor/admin; "delete project")
app.post('/api/v1/notes/delete-by-prefix', requireRole('editor', 'admin'), (req, res) => {
  const raw = req.body && req.body.path_prefix != null ? String(req.body.path_prefix) : '';
  try {
    const { deleted, paths } = deleteNotesByPrefix(req.vaultPath, raw, { ignore: config.ignore || [] });
    const proposals_discarded = discardProposalsUnderPathPrefix(config.data_dir, {
      vault_id: req.vault_id ?? 'default',
      path_prefix: raw,
    });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: req.vaultPath });
    res.json({ deleted, paths, proposals_discarded });
  } catch (e) {
    if (
      e.message &&
      (e.message.includes('path_prefix') || e.message.includes('Invalid path_prefix') || e.message.includes('Invalid path'))
    ) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/notes/delete-by-project — bulk delete by list-notes project filter (self-hosted Node; see docs/HUB-METADATA-BULK-OPS.md)
app.post('/api/v1/notes/delete-by-project', requireRole('editor', 'admin'), (req, res) => {
  const raw = req.body && req.body.project != null ? String(req.body.project) : '';
  try {
    const { deleted, paths } = deleteNotesByProjectSlug(req.vaultPath, raw, { ignore: config.ignore || [] });
    const proposals_discarded = discardProposalsAtPaths(config.data_dir, {
      vault_id: req.vault_id ?? 'default',
      paths,
    });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: req.vaultPath });
    res.json({ deleted, paths, proposals_discarded });
  } catch (e) {
    if (e.message && (e.message.includes('project slug required') || e.message.includes('Invalid path'))) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/notes/rename-project — rewrite frontmatter project slug (self-hosted Node; see docs/HUB-METADATA-BULK-OPS.md)
app.post('/api/v1/notes/rename-project', requireRole('editor', 'admin'), (req, res) => {
  const from = req.body && req.body.from != null ? String(req.body.from) : '';
  const to = req.body && req.body.to != null ? String(req.body.to) : '';
  try {
    const { updated, paths } = renameProjectSlugInVault(req.vaultPath, from, to, { ignore: config.ignore || [] });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: req.vaultPath });
    res.json({ updated, paths });
  } catch (e) {
    if (
      e.message &&
      (e.message.includes('from and to project') || e.message.includes('Invalid path') || e.message.includes('escapes vault'))
    ) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/index — re-run indexer (Phase 13: editor or admin; Phase 15: vault-scoped)
app.post('/api/v1/index', jwtAuth, apiLimiter, requireVaultAccess, requireRole('editor', 'admin'), async (req, res) => {
  try {
    const { runIndex } = await import('../lib/indexer.mjs');
    const result = await runIndex({ log: () => {}, vaultId: req.vault_id, vaultPath: req.vaultPath });
    invalidateFacetsCache();
    res.json({ ok: true, notesProcessed: result.notesProcessed, chunksIndexed: result.chunksIndexed });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/export — export one note to content (editor/admin). Returns { content, filename } for client download.
app.post('/api/v1/export', jwtAuth, apiLimiter, requireVaultAccess, requireRole('editor', 'admin'), (req, res) => {
  const { path: notePath, format } = req.body || {};
  if (!notePath || typeof notePath !== 'string') {
    return res.status(400).json({ error: 'path required', code: 'BAD_REQUEST' });
  }
  const fmt = format === 'html' ? 'html' : 'md';
  try {
    resolveVaultRelativePath(req.vaultPath, notePath);
    const { content, filename } = exportNoteToContent(req.vaultPath, notePath, { format: fmt });
    res.json({ content, filename });
  } catch (e) {
    if (e.message && e.message.includes('Invalid path')) return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    res.status(404).json({ error: e.message || 'Note not found', code: 'NOT_FOUND' });
  }
});

// POST /api/v1/import — upload file (or zip) and run import (editor/admin). Multipart: source_type, file; optional project, output_dir, tags.
const importTempDirMiddleware = (req, _res, next) => {
  req._importTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-import-'));
  next();
};
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req._importTempDir),
    filename: (req, file, cb) => cb(null, file.originalname || 'upload'),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
}).single('file');
app.post('/api/v1/import', jwtAuth, apiLimiter, requireVaultAccess, requireRole('editor', 'admin'), importTempDirMiddleware, importUpload, async (req, res) => {
  const tempDir = req._importTempDir;
  try {
    if (!req.file) return res.status(400).json({ error: 'file required', code: 'BAD_REQUEST' });
    const sourceType = (req.body && req.body.source_type) ? String(req.body.source_type).trim() : '';
    if (!IMPORT_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({ error: `source_type must be one of: ${IMPORT_SOURCE_TYPES.join(', ')}`, code: 'BAD_REQUEST' });
    }
    const project = req.body && req.body.project ? String(req.body.project).trim() : undefined;
    const outputDir = req.body && req.body.output_dir ? String(req.body.output_dir).trim() : undefined;
    const tagsRaw = req.body && req.body.tags ? String(req.body.tags) : '';
    const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let inputPath = req.file.path;
    if (req.file.originalname && req.file.originalname.toLowerCase().endsWith('.zip')) {
      const extractDir = path.join(tempDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      const zip = new AdmZip(req.file.path);
      zip.extractAllTo(extractDir, true);
      inputPath = extractDir;
    }
    const result = await runImport(sourceType, inputPath, { project, outputDir, tags, vaultPath: req.vaultPath });
    const importStamp = mergeProvenanceFrontmatter({}, {
      sub: req.user?.sub ?? null,
      kind: 'import',
    });
    for (const item of result.imported || []) {
      if (item.path && typeof item.path === 'string') {
        try {
          writeNote(req.vaultPath, item.path, { frontmatter: importStamp });
        } catch (e) {
          console.error('hub import provenance pass failed for', item.path, e.message || e);
        }
      }
    }
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: req.vaultPath });
    res.json({ imported: result.imported, count: result.count });
  } catch (e) {
    const msg = e.message || String(e);
    const clientError =
      /OPENAI_API_KEY|required for transcription|Unsupported format|file not found|not found:|Transcription failed|413|Payload Too Large|25MB|Whisper accepts/i.test(
        msg
      );
    res.status(clientError ? 400 : 500).json({
      error: msg,
      code: clientError ? 'BAD_REQUEST' : 'RUNTIME_ERROR',
    });
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

// Proposals (vault-scoped)
app.get('/api/v1/proposals', parseQueryBounds, (req, res) => {
  try {
    const limit = req.query.limit != null ? Math.min(100, Math.max(0, parseInt(req.query.limit, 10) || 50)) : 50;
    const offset = req.query.offset != null ? Math.max(0, parseInt(req.query.offset, 10) || 0) : 0;
    const opts = {
      status: req.query.status,
      vault_id: req.vault_id,
      limit,
      offset,
      label: typeof req.query.label === 'string' ? req.query.label : undefined,
      source: typeof req.query.source === 'string' ? req.query.source : undefined,
      path_prefix: typeof req.query.path_prefix === 'string' ? req.query.path_prefix : undefined,
      evaluation_status:
        typeof req.query.evaluation_status === 'string' ? req.query.evaluation_status : undefined,
      review_queue: typeof req.query.review_queue === 'string' ? req.query.review_queue : undefined,
      review_severity: typeof req.query.review_severity === 'string' ? req.query.review_severity : undefined,
    };
    const out = listProposals(config.data_dir, opts);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.get('/api/v1/proposals/:id', (req, res) => {
  const proposal = getProposal(config.data_dir, req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found', code: 'NOT_FOUND' });
  const allowed = getAllowedVaultIds(config.data_dir, req.user?.sub ?? '');
  const vid = proposal.vault_id ?? 'default';
  if (!allowed.includes(vid)) return res.status(403).json({ error: 'Access to this proposal is not allowed.', code: 'FORBIDDEN' });
  res.json(proposal);
});

app.post('/api/v1/proposals/:id/evaluation', requireRole('admin', 'evaluator'), (req, res) => {
  const proposal = getProposal(config.data_dir, req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found', code: 'NOT_FOUND' });
  const allowed = getAllowedVaultIds(config.data_dir, req.user?.sub ?? '');
  const vid = proposal.vault_id ?? 'default';
  if (!allowed.includes(vid)) {
    return res.status(403).json({ error: 'Access to this proposal is not allowed.', code: 'FORBIDDEN' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rubric = loadProposalRubric(config.data_dir);
  const merged = mergeEvaluationChecklist(rubric.items, body.checklist);
  const result = submitProposalEvaluation(config.data_dir, req.params.id, {
    outcome: body.outcome,
    evaluation_checklist: merged,
    evaluation_grade: body.grade,
    evaluation_comment: body.comment,
    evaluated_by: req.user?.sub ?? 'unknown',
  });
  if (!result.ok) {
    const st = result.code === 'NOT_FOUND' ? 404 : 400;
    return res.status(st).json({ error: result.error, code: result.code });
  }
  appendAudit(config.data_dir, {
    userId: req.user?.sub ?? 'unknown',
    action: 'evaluation_submitted',
    proposalId: req.params.id,
    detail: { evaluation_status: result.proposal.evaluation_status },
  });
  res.json(result.proposal);
});

app.post('/api/v1/proposals', requireRole('editor', 'admin'), (req, res) => {
  const {
    path: notePath,
    body,
    frontmatter,
    intent,
    base_state_id,
    external_ref,
    labels,
    source,
  } = req.body || {};
  try {
    const policyPending = getProposalEvaluationRequired(config.data_dir);
    const triggers = loadReviewTriggers(config.data_dir);
    const labelArr = Array.isArray(labels) ? labels : [];
    const applied = applyReviewTriggers(triggers, {
      path: String(notePath || ''),
      body: String(body || ''),
      intent: String(intent || ''),
      labels: labelArr,
    });
    const proposal = createProposal(config.data_dir, {
      path: notePath,
      body,
      frontmatter,
      intent,
      base_state_id,
      external_ref,
      labels,
      source,
      vault_id: req.vault_id,
      proposed_by: req.user?.sub ?? undefined,
      evaluationRequired: policyPending,
      evaluationForcedPending: applied.forcePending,
      review_queue: applied.review_queue,
      review_severity: applied.review_severity,
      auto_flag_reasons: applied.auto_flag_reasons,
    });
    if (applied.auto_flag_reasons.length) {
      appendAudit(config.data_dir, {
        userId: req.user?.sub ?? 'unknown',
        action: 'proposal_auto_flagged',
        proposalId: proposal.proposal_id,
        detail: { reasons: applied.auto_flag_reasons },
      });
    }
    if (process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS === '1') {
      setImmediate(() => {
        runProposalReviewHintsJob(config, proposal.proposal_id).catch(() => {});
      });
    }
    res.status(201).json(proposal);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/proposals/:id/approve', requireApproveRole, (req, res) => {
  const proposal = getProposal(config.data_dir, req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found', code: 'NOT_FOUND' });
  const approveVaultPath = config.resolveVaultPath(proposal.vault_id ?? 'default');
  if (!approveVaultPath) return res.status(400).json({ error: 'Proposal vault not found.', code: 'BAD_REQUEST' });
  if (proposal.status !== 'proposed') {
    return res.status(400).json({ error: `Proposal status is ${proposal.status}`, code: 'BAD_REQUEST' });
  }
  const approveBody = req.body && typeof req.body === 'object' ? req.body : {};
  const waiverReason =
    approveBody.waiver_reason != null && String(approveBody.waiver_reason).trim()
      ? String(approveBody.waiver_reason).trim()
      : '';
  if (!evaluationAllowsApprove(proposal)) {
    if (waiverReason.length < 3) {
      return res.status(403).json({
        error: 'Evaluation must be passed before approve, or provide waiver_reason (admin override).',
        code: 'EVALUATION_REQUIRED',
      });
    }
  }
  const fromReq =
    approveBody.base_state_id != null && String(approveBody.base_state_id).trim() !== ''
      ? String(approveBody.base_state_id).trim()
      : '';
  const fromProposal =
    proposal.base_state_id != null && String(proposal.base_state_id).trim() !== ''
      ? String(proposal.base_state_id).trim()
      : '';
  const expectedBase = fromReq || fromProposal;
  if (expectedBase) {
    let currentId;
    if (noteFileExistsInVault(approveVaultPath, proposal.path)) {
      try {
        const n = readNote(approveVaultPath, proposal.path);
        currentId = noteStateIdFromParts(n.frontmatter, n.body);
      } catch (_) {
        return res.status(409).json({
          error: 'base_state_id mismatch; vault note changed or path state differs',
          code: 'CONFLICT',
        });
      }
    } else {
      currentId = absentNoteStateId();
    }
    if (currentId !== expectedBase) {
      return res.status(409).json({
        error: 'base_state_id mismatch; vault note changed or path state differs',
        code: 'CONFLICT',
      });
    }
  }
  try {
    const fm = mergeProvenanceFrontmatter(proposal.frontmatter ?? {}, {
      sub: req.user?.sub ?? null,
      kind: 'agent',
      proposedBy: proposal.proposed_by ?? null,
      approvedBy: req.user?.sub ?? null,
    });
    writeNote(approveVaultPath, proposal.path, {
      body: proposal.body,
      frontmatter: fm,
    });
    let evaluation_waiver;
    if (!evaluationAllowsApprove(proposal) && waiverReason.length >= 3) {
      evaluation_waiver = {
        by: req.user?.sub ?? 'unknown',
        at: new Date().toISOString(),
        reason: waiverReason.slice(0, 2000),
      };
    }
    const updated = updateProposalStatus(config.data_dir, req.params.id, 'approved', {
      ...(evaluation_waiver ? { evaluation_waiver } : {}),
    });
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: evaluation_waiver ? 'approve_waiver' : 'approve',
      proposalId: req.params.id,
      ...(evaluation_waiver ? { detail: { reason_len: waiverReason.length } } : {}),
    });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: approveVaultPath });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/proposals/:id/discard', requireRole('admin'), (req, res) => {
  const proposal = getProposal(config.data_dir, req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found', code: 'NOT_FOUND' });
  const updated = updateProposalStatus(config.data_dir, req.params.id, 'discarded');
  appendAudit(config.data_dir, { userId: req.user?.sub ?? 'unknown', action: 'discard', proposalId: req.params.id });
  res.json(updated);
});

// Optional Tier-2: LLM summary + suggested labels (KNOWTATION_HUB_PROPOSAL_ENRICH=1; see docs/PROPOSAL-LIFECYCLE.md)
app.post('/api/v1/proposals/:id/enrich', requireRole('editor', 'admin', 'evaluator'), async (req, res) => {
  if (process.env.KNOWTATION_HUB_PROPOSAL_ENRICH !== '1') {
    return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  }
  const proposal = getProposal(config.data_dir, req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found', code: 'NOT_FOUND' });
  const allowed = getAllowedVaultIds(config.data_dir, req.user?.sub ?? '');
  const vid = proposal.vault_id ?? 'default';
  if (!allowed.includes(vid)) {
    return res.status(403).json({ error: 'Access to this proposal is not allowed.', code: 'FORBIDDEN' });
  }
  if (proposal.status !== 'proposed') {
    return res.status(400).json({ error: 'Can only enrich proposed proposals', code: 'BAD_REQUEST' });
  }
  try {
    const system =
      'Reply with ONLY valid JSON: {"summary":"one short paragraph","suggested_labels":["lowercase-short-tag"]}. At most 5 labels. No markdown fences.';
    const user = `Path: ${proposal.path}\nIntent: ${proposal.intent || '—'}\n---\n${String(proposal.body || '').slice(0, 12_000)}`;
    const raw = await completeChat(config, { system, user, maxTokens: 400 });
    let summary = raw;
    let suggested = [];
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
      const j = JSON.parse(cleaned);
      if (typeof j.summary === 'string') summary = j.summary;
      if (Array.isArray(j.suggested_labels)) suggested = j.suggested_labels;
    } catch (_) {
      /* use raw text as summary */
    }
    const model = process.env.OPENAI_API_KEY
      ? config.llm?.openai_chat_model || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
      : process.env.OLLAMA_CHAT_MODEL || config.llm?.ollama_chat_model || process.env.OLLAMA_MODEL || 'ollama';
    const updated = updateProposalEnrichment(config.data_dir, req.params.id, {
      assistant_notes: summary,
      assistant_model: String(model).slice(0, 128),
      suggested_labels: suggested,
    });
    appendAudit(config.data_dir, { userId: req.user?.sub ?? 'unknown', action: 'enrich', proposalId: req.params.id });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/settings — safe config status for Settings UI (Phase 13 + Phase 15 multi-vault)
app.get('/api/v1/settings', jwtAuth, requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const vg = config.vault_git;
  const vaultPath = config.vault_path || '';
  const vault_path_display = vaultPath ? '…/' + path.basename(vaultPath) : '';
  const githubConn = readGitHubConnection(config.data_dir);
  const emb = config.embedding || {};
  const ollamaUrl = emb.ollama_url || (emb.provider === 'ollama' ? 'http://localhost:11434' : undefined);
  const vaultListRaw = readHubVaults(config.data_dir, projectRoot);
  const vaultList = (vaultListRaw.length ? vaultListRaw : config.vaultList || []).map((v) => ({ id: v.id, label: v.label || v.id }));
  const allowed_vault_ids = getAllowedVaultIds(config.data_dir, req.user?.sub ?? '');
  const dataDirDisplay = path.relative(projectRoot, config.data_dir);
  res.json({
    role: effectiveRole(req),
    user_id: req.user?.sub ?? '',
    vault_id: req.vault_id ?? 'default',
    vault_list: vaultList,
    allowed_vault_ids,
    data_dir_display: dataDirDisplay || 'data',
    vault_path_display,
    vault_git: {
      enabled: !!vg?.enabled,
      has_remote: !!vg?.remote,
      auto_commit: !!vg?.auto_commit,
      auto_push: !!vg?.auto_push,
    },
    github_connect_available: Boolean(process.env.GITHUB_CLIENT_ID),
    github_connected: Boolean(githubConn?.access_token),
    workspace_owner_id: null,
    hosted_delegating: false,
    embedding_display: {
      provider: emb.provider || 'ollama',
      model: emb.model || 'nomic-embed-text',
      ollama_url: ollamaUrl,
    },
    proposal_enrich_enabled: process.env.KNOWTATION_HUB_PROPOSAL_ENRICH === '1',
    proposal_evaluation_required: getProposalEvaluationRequired(config.data_dir),
    proposal_review_hints_enabled: process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS === '1',
    hub_evaluator_may_approve: actorMayApproveProposals(
      req.user?.sub ?? '',
      effectiveRole(req),
      readEvaluatorMayApprove(config.data_dir),
      hubEnvEvaluatorMayApprove(),
    ),
    proposal_rubric: loadProposalRubric(config.data_dir),
  });
});

// POST /api/v1/vault/sync — manual "Back up now" (Phase 13: editor or admin; Phase 15: vault-scoped)
app.post('/api/v1/vault/sync', jwtAuth, requireVaultAccess, requireRole('editor', 'admin'), (req, res) => {
  try {
    const result = runVaultSync({ ...config, vault_path: req.vaultPath });
    res.json(result);
  } catch (e) {
    if (e.message && e.message.includes('must be set in config')) {
      return res.status(400).json({ error: e.message, code: 'NOT_CONFIGURED' });
    }
    if (e.message && /not a Git repository|Vault folder is not a Git repository/i.test(e.message)) {
      return res.status(400).json({ error: e.message, code: 'GIT_NOT_INITIALIZED' });
    }
    const stderr = e.stderr != null ? (Buffer.isBuffer(e.stderr) ? e.stderr.toString('utf8') : String(e.stderr)) : '';
    const stdout = e.stdout != null ? (Buffer.isBuffer(e.stdout) ? e.stdout.toString('utf8') : String(e.stdout)) : '';
    const detail = [e.message, stderr, stdout].filter(Boolean).join('\n').trim();
    res.status(500).json({ error: detail || 'Sync failed', code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/vault/git-init — create .git in current vault (self-hosted); editor/admin
app.post('/api/v1/vault/git-init', jwtAuth, requireVaultAccess, requireRole('editor', 'admin'), (req, res) => {
  try {
    const vaultPath = req.vaultPath;
    if (!vaultPath || !fs.existsSync(vaultPath)) {
      return res.status(400).json({ error: 'Vault path not found.', code: 'BAD_REQUEST' });
    }
    const gitDir = path.join(vaultPath, '.git');
    if (fs.existsSync(gitDir)) {
      return res.status(400).json({ error: 'This vault is already a Git repository.', code: 'ALREADY_GIT' });
    }
    const runGit = (args) =>
      execFileSync('git', args, { cwd: vaultPath, stdio: ['pipe', 'pipe', 'pipe'] });
    runGit(['init']);
    runGit(['config', 'user.email', 'hub@knowtation.local']);
    runGit(['config', 'user.name', 'Knowtation Hub']);
    runGit(['add', '-A']);
    try {
      runGit(['commit', '-m', 'Initial commit']);
    } catch (_) {
      const stamp = path.join(vaultPath, '.knowtation-git-init.md');
      fs.writeFileSync(
        stamp,
        '# Vault\n\nGit initialized by Knowtation Hub. You can delete this file after your first real commit.\n',
        'utf8',
      );
      runGit(['add', '-A']);
      runGit(['commit', '-m', 'Initial commit']);
    }
    res.json({
      ok: true,
      message: 'Git initialized in this vault. Use Back up now to push (after Connect GitHub if needed).',
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'git init failed', code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/roles — list roles (Phase 13: admin only; for Team UI)
app.get('/api/v1/roles', jwtAuth, requireRole('admin'), (_req, res) => {
  try {
    const roles = readRolesObject(config.data_dir);
    const evaluator_may_approve = readEvaluatorMayApprove(config.data_dir);
    res.json({ roles, evaluator_may_approve });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/roles — add or update one role (Phase 13: admin only)
app.post('/api/v1/roles', jwtAuth, requireRole('admin'), (req, res) => {
  const { user_id: userId, role } = req.body || {};
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'user_id required (e.g. github:12345)', code: 'BAD_REQUEST' });
  }
  const r = (role || '').toLowerCase();
  if (!['admin', 'editor', 'viewer', 'evaluator'].includes(r)) {
    return res.status(400).json({ error: 'role must be admin, editor, viewer, or evaluator', code: 'BAD_REQUEST' });
  }
  try {
    const current = readRolesObject(config.data_dir);
    const uidKey = userId.trim();
    current[uidKey] = r;
    writeRolesFile(config.data_dir, current);
    roleMap = loadRoleMap(config.data_dir);
    let mayMap = readEvaluatorMayApprove(config.data_dir);
    if (r === 'evaluator' && req.body && Object.prototype.hasOwnProperty.call(req.body, 'evaluator_may_approve')) {
      mayMap = { ...mayMap, [uidKey]: Boolean(req.body.evaluator_may_approve) };
      writeEvaluatorMayApprove(config.data_dir, mayMap);
    } else if (r !== 'evaluator' && Object.prototype.hasOwnProperty.call(mayMap, uidKey)) {
      const next = { ...mayMap };
      delete next[uidKey];
      writeEvaluatorMayApprove(config.data_dir, next);
    }
    res.json({ ok: true, roles: current });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/roles/evaluator-may-approve', jwtAuth, requireRole('admin'), (req, res) => {
  const { user_id: userId, evaluator_may_approve: flag } = req.body || {};
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'user_id required', code: 'BAD_REQUEST' });
  }
  if (typeof flag !== 'boolean') {
    return res.status(400).json({ error: 'evaluator_may_approve must be boolean', code: 'BAD_REQUEST' });
  }
  const uidKey = userId.trim();
  const rm = loadRoleMap(config.data_dir);
  const gr = getRole(rm, uidKey);
  const storedRole = gr === 'member' || !gr ? (rm.size === 0 ? 'admin' : 'editor') : gr;
  if (storedRole !== 'evaluator') {
    return res.status(400).json({ error: 'User must have evaluator role', code: 'BAD_REQUEST' });
  }
  try {
    const mayMap = { ...readEvaluatorMayApprove(config.data_dir), [uidKey]: flag };
    writeEvaluatorMayApprove(config.data_dir, mayMap);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// Phase 13 invite flow (admin only)
const baseOrigin = () => (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');

// POST /api/v1/invites — create invite link (admin only)
app.post('/api/v1/invites', jwtAuth, requireRole('admin'), (req, res) => {
  const role = (req.body?.role || 'editor').toLowerCase();
  if (!['viewer', 'editor', 'admin', 'evaluator'].includes(role)) {
    return res.status(400).json({ error: 'role must be viewer, editor, admin, or evaluator', code: 'BAD_REQUEST' });
  }
  try {
    const { token, role: r, created_at, expires_at } = createInvite(config.data_dir, role);
    const invite_url = `${baseOrigin()}?invite=${encodeURIComponent(token)}`;
    res.status(201).json({ invite_url, token, role: r, created_at, expires_at });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/invites — list pending invites (admin only)
app.get('/api/v1/invites', jwtAuth, requireRole('admin'), (_req, res) => {
  try {
    const invites = listInvites(config.data_dir);
    res.json({ invites });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// DELETE /api/v1/invites/:token — revoke invite (admin only)
app.delete('/api/v1/invites/:token', jwtAuth, requireRole('admin'), (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).json({ error: 'token required', code: 'BAD_REQUEST' });
  try {
    const removed = revokeInvite(config.data_dir, token);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// Phase 15: multi-vault admin (admin only)
app.get('/api/v1/vaults', jwtAuth, requireRole('admin'), (_req, res) => {
  try {
    const list = readHubVaults(config.data_dir, projectRoot);
    const vaults = list.length > 0 ? list : (config.vaultList || []).map((v) => ({ id: v.id, path: v.path, label: v.label }));
    res.json({ vaults });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/vaults', jwtAuth, requireRole('admin'), (req, res) => {
  const vaults = req.body?.vaults;
  if (!Array.isArray(vaults)) return res.status(400).json({ error: 'vaults array required', code: 'BAD_REQUEST' });
  try {
    writeHubVaults(config.data_dir, vaults, projectRoot);
    config = loadConfig(projectRoot);
    res.json({ ok: true, vaults: config.vaultList });
  } catch (e) {
    if (e.message && (e.message.includes('default') || e.message.includes('required'))) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.delete('/api/v1/vaults/:vaultId', jwtAuth, apiLimiter, requireRole('admin'), async (req, res) => {
  const vaultId = decodeURIComponent(String(req.params.vaultId || '').trim());
  try {
    const out = await deleteSelfHostedVault({
      dataDir: config.data_dir,
      projectRoot,
      vaultId,
      config,
    });
    config = loadConfig(projectRoot);
    roleMap = loadRoleMap(config.data_dir);
    invalidateFacetsCache();
    res.json(out);
  } catch (e) {
    const code = e.code && typeof e.code === 'string' ? e.code : 'RUNTIME_ERROR';
    const status =
      code === 'BAD_REQUEST' ? 400 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({ error: e.message || 'Delete vault failed', code });
  }
});

app.get('/api/v1/vault-access', jwtAuth, requireRole('admin'), (_req, res) => {
  try {
    const access = readVaultAccess(config.data_dir);
    res.json({ access });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/vault-access', jwtAuth, requireRole('admin'), (req, res) => {
  const access = req.body?.access;
  if (!access || typeof access !== 'object') return res.status(400).json({ error: 'access object required', code: 'BAD_REQUEST' });
  try {
    writeVaultAccess(config.data_dir, access);
    res.json({ ok: true, access: readVaultAccess(config.data_dir) });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.get('/api/v1/scope', jwtAuth, requireRole('admin'), (_req, res) => {
  try {
    const scope = readScope(config.data_dir);
    res.json({ scope });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/scope', jwtAuth, requireRole('admin'), (req, res) => {
  const scope = req.body?.scope;
  if (!scope || typeof scope !== 'object') return res.status(400).json({ error: 'scope object required', code: 'BAD_REQUEST' });
  try {
    writeScope(config.data_dir, scope);
    res.json({ ok: true, scope: readScope(config.data_dir) });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/setup — editable setup (Phase 13: requires auth + viewer)
app.get('/api/v1/setup', jwtAuth, requireRole('viewer', 'editor', 'admin', 'evaluator'), (_req, res) => {
  const vg = config.vault_git;
  res.json({
    vault_path: config.vault_path || '',
    vault_git: {
      enabled: !!vg?.enabled,
      remote: vg?.remote || '',
    },
  });
});

// POST /api/v1/setup — write vault_path and/or vault.git (Phase 13: admin only)
app.post('/api/v1/setup', jwtAuth, requireRole('admin'), (req, res) => {
  if (process.env.HUB_ALLOW_SETUP_WRITE === 'false') {
    return res.status(403).json({ error: 'Setup write is disabled (HUB_ALLOW_SETUP_WRITE=false)', code: 'FORBIDDEN' });
  }
  const body = req.body || {};
  try {
    const payload = {};
    if (body.vault_path !== undefined) payload.vault_path = body.vault_path;
    if (body.vault_git !== undefined) {
      payload.vault = { git: body.vault_git };
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'Provide vault_path and/or vault_git', code: 'BAD_REQUEST' });
    }
    writeHubSetup(config.data_dir, payload);
    config = loadConfig(projectRoot);
    roleMap = loadRoleMap(config.data_dir);
    res.json({ ok: true, message: 'Setup saved. Config applied.' });
  } catch (e) {
    if (e.message && e.message.includes('cannot be empty')) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message || 'Setup save failed', code: 'RUNTIME_ERROR' });
  }
});

// Rich Hub UI — same origin as API so opening http://localhost:3333/ shows the app
const hubUiDir = path.join(projectRoot, 'web', 'hub');
app.use(express.static(hubUiDir, { index: 'index.html' }));
app.get('/', (_req, res) => {
  res.sendFile(path.join(hubUiDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Knowtation Hub listening on http://localhost:${PORT}`);
  console.log('  UI:     GET /  (Rich Hub)');
  console.log('  Health: GET /health');
  console.log('  Login:  GET /api/v1/auth/login?provider=google|github');
  console.log('  API:    /api/v1/notes, /api/v1/search, /api/v1/proposals (Bearer JWT)');
});
