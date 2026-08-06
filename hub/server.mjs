/**
 * Knowtation Hub — REST API + OAuth + JWT. Phase 11.
 * Run from repo root: node hub/server.mjs
 * Env: KNOWTATION_VAULT_PATH, HUB_JWT_SECRET, HUB_PORT; optional HUB_CORS_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, HUB_BASE_URL, HUB_PROPOSAL_EVALUATION_REQUIRED, KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS, KNOWTATION_HUB_PROPOSAL_ENRICH (see lib/hub-proposal-policy.mjs; explicit 0/1 or false/true overrides data/hub_proposal_policy.json), HUB_EVALUATOR_MAY_APPROVE=1 (fallback when no per-user row in data/hub_evaluator_may_approve.json).
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
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';

import { loadConfig, CHAT_PROVIDERS, normalizeChatProviderInput } from '../lib/config.mjs';
import { runListNotes, runFacets } from '../lib/list-notes.mjs';
import {
  readNote,
  normalizeSlug,
  normalizeMetadataFacets,
  resolveVaultRelativePath,
  noteFileExistsInVault,
  listVaultFolderOptions,
} from '../lib/vault.mjs';
import { buildNoteOutline } from '../lib/note-outline.mjs';
import { buildDocumentTree } from '../lib/document-tree.mjs';
import { readSectionSource } from '../lib/section-source-note.mjs';
import { writeNote, deleteNote, deleteNotesByPrefix } from '../lib/write.mjs';
import { deleteNotesByProjectSlug, renameProjectSlugInVault } from '../lib/hub-bulk-metadata.mjs';
import { mergeProvenanceFrontmatter } from '../lib/hub-provenance.mjs';
import { runSearch } from '../lib/search.mjs';
import { runKeywordSearch } from '../lib/keyword-search.mjs';
import { exportNoteToContent } from '../lib/export.mjs';
import { runImport } from '../lib/import.mjs';
import { IMPORT_SOURCE_TYPES } from '../lib/import-source-types.mjs';
import { noteStateIdFromParts, absentNoteStateId } from '../lib/note-state-id.mjs';
import { buildApprovalLogWrite } from '../lib/approval-log.mjs';
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
  patchProposalTaskMetaCascade,
} from './proposals-store.mjs';
import { loadProposalRubric } from '../lib/hub-proposal-rubric.mjs';
import {
  getProposalEvaluationRequired,
  getProposalReviewHintsEnabled,
  getProposalEnrichEnabled,
  proposalPolicyEnvLocked,
  readProposalPolicyFile,
  writeProposalPolicyMerge,
} from '../lib/hub-proposal-policy.mjs';
import { loadReviewTriggers, applyReviewTriggers } from '../lib/hub-proposal-review-triggers.mjs';
import { runProposalReviewHintsJob } from '../lib/hub-proposal-review-hints-job.mjs';
import { appendAudit } from './audit-log.mjs';
import { maybeAutoSync, runVaultSync } from '../lib/vault-git-sync.mjs';
import { readHubSetup, writeHubSetup } from '../lib/hub-setup.mjs';
import { readConnection as readGitHubConnection, writeConnection as writeGitHubConnection } from '../lib/github-connection.mjs';
import { commitImageToRepo, parseGitHubRepoUrl, validateImageExtension, validateMagicBytes } from '../lib/github-commit-image.mjs';
import {
  loadRoleMap,
  getRole,
  readRolesObject,
  writeRolesFile,
  ensureActorAdminOnFirstRolesPopulation,
} from './roles.mjs';
import { createInvite, consumeInvite, revokeInvite, listInvites } from './invites.mjs';
import { getAllowedVaultIds, readVaultAccess, writeVaultAccess } from './hub_vault_access.mjs';
import { getScopeForUserVault, readScope, writeScope } from './hub_scope.mjs';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  pruneRefreshTokens,
} from './refresh-tokens.mjs';
import {
  refreshCookieOptions,
  issueRefreshCookie,
  createRefreshHandler,
  createLogoutHandler,
} from './auth-session.mjs';
import { readHubVaults, writeHubVaults } from '../lib/hub-vaults.mjs';
import { deleteSelfHostedVault } from './hub-delete-vault.mjs';
import { applyScopeFilterToNotes as applyScopeFilter } from './lib/scope-filter.mjs';
import { materializeListFrontmatter } from './gateway/note-facets.mjs';
import {
  readEvaluatorMayApprove,
  writeEvaluatorMayApprove,
  actorMayApproveProposals,
} from './lib/hub-evaluator-may-approve.mjs';
import {
  personalSelfApplyRefusalReason,
  isHttpVisibleSelfApplySeamCode,
  SELF_APPLY_SEAM_ERROR_MESSAGES,
} from '../lib/hub-proposal-personal-self-apply.mjs';
import { isSessionBoundActor } from './gateway/access-token-authz.mjs';
import {
  parseMuseConfigFromEnv,
  resolveExternalRefForApprove,
  fetchMuseProxiedGet,
} from '../lib/muse-thin-bridge.mjs';
import {
  buildCalendarTimeline,
  listSourceCalendarsForClient,
} from '../lib/calendar/timeline.mjs';
import { importIcsIntoVault } from '../lib/calendar/event-store.mjs';
import { patchSourceCalendar, parseSourceCalendarPatchBody } from '../lib/calendar/source-calendar-patch.mjs';
import { retrieveAgentCalendarContext } from '../lib/calendar/agent-retrieval.mjs';
import {
  handleBeginGoogleConnector,
  handleListGoogleConnectors,
} from '../lib/calendar/google-oauth-connector.mjs';
import { handleFlowListRequest, handleFlowGetRequest, handleFlowProjectRequest } from '../lib/flow/flow-handlers.mjs';
import { handleTaskListRequest, handleTaskGetRequest } from '../lib/task/task-handlers.mjs';
import {
  handleAttachmentListRequest,
  handleAttachmentGetRequest,
} from '../lib/attachments/attachment-handlers.mjs';
import {
  handleMediaLinkProposeRequest,
  handleMediaAttachProposeRequest,
  handleMediaImportConsentGrantRequest,
  handleMediaImportConsentListRequest,
  handleMediaImportConsentRevokeRequest,
  precheckApprovedMediaProposal,
  reconcileApprovedMediaProposal,
  MEDIA_PROPOSAL_SOURCE,
} from '../lib/attachments/attachment-write.mjs';
import {
  handleTaskLoopListRequest,
  handleTaskLoopGetRequest,
} from '../lib/task/task-loop-handlers.mjs';
import { handleLoopPassAuditAppendRequest } from '../lib/task/loop-pass-audit.mjs';
import {
  handleTaskProposeRequest,
  handleTaskLoopProposeRequest,
  handleTaskInstanceMaterializeRequest,
  precheckApprovedTaskProposal,
  reconcileApprovedTaskProposal,
  TASK_PROPOSAL_SOURCE,
} from '../lib/task/task-write.mjs';
import {
  handleFlowExternalGrantMintRequest,
  handleFlowExternalGrantRevokeRequest,
  handleFlowExternalGrantListRequest,
  handleFlowExternalToolInvokeRequest,
} from '../lib/flow/external-agent.mjs';
import {
  handleFlowProposeRequest,
  precheckApprovedFlowProposal,
  applyFlowProposalToIndex,
  FLOW_PROPOSAL_SOURCE,
} from '../lib/flow/flow-authoring.mjs';
import {
  handleFlowCaptureObserveRequest,
  handleFlowCaptureListRequest,
  handleFlowCaptureProposeRequest,
  handleFlowCaptureDismissRequest,
  precheckApprovedCaptureProposal,
  applyCaptureProposal,
  FLOW_CAPTURE_PROPOSAL_SOURCE,
} from '../lib/flow/flow-capture.mjs';
import {
  handleFlowRunStartRequest,
  handleFlowRunGetRequest,
  handleFlowRunListRequest,
  handleFlowRunAdvanceRequest,
  handleFlowRunEvidenceRequest,
  handleFlowRunExecuteAutomatableRequest,
  handleFlowRunSubmitReviewRequest,
  handleFlowExecutionConsentMintRequest,
} from '../lib/flow/flow-execution.mjs';
import {
  handleAgentIdentityRegisterProposeRequest,
  handleAgentIdentityListRequest,
  handleDelegationConsentProposeRequest,
  handleDelegationConsentRevokeRequest,
  handleDelegationGrantMintRequest,
  handleDelegationGrantRevokeRequest,
  handleDelegationGrantListRequest,
  handleDelegationAuditAppendRequest,
  precheckApprovedDelegationProposal,
  applyDelegationProposalToIndex,
  DELEGATION_PROPOSAL_SOURCE,
  hashPrincipalRef,
} from '../lib/agent/delegation.mjs';
import { resolveOfflineLockedAuthPosture } from './lib/local-auth-gate.mjs';
import { oauthDisabledGuard, logBootstrapInstructionOnce } from './lib/local-auth-oauth-guard.mjs';
import { registerLocalAuthRoutes, credentialStoreHasAdmin } from './lib/local-auth-routes.mjs';
import { pruneExpiredBootstrapRecord } from './lib/local-auth-bootstrap.mjs';
import { effectiveRoleForHub } from './lib/local-auth-role.mjs';

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

/** Muse bridge: use merged `config.muse.url` (local.yaml + env) when parsing bridge options. */
function museEnvForBridge() {
  const u = config?.muse?.url;
  if (u != null && String(u).trim() !== '') {
    return { ...process.env, MUSE_URL: String(u).trim().replace(/\/+$/, '') };
  }
  return process.env;
}

function museBridgePublicSettings() {
  const envOverride = process.env.MUSE_URL != null && String(process.env.MUSE_URL).trim() !== '';
  const mc = parseMuseConfigFromEnv(museEnvForBridge());
  let origin = null;
  if (mc) {
    try {
      origin = new URL(mc.baseUrl).origin;
    } catch (_) {
      /* ignore */
    }
  }
  const yamlOnly = !envOverride && Boolean(config.muse?.url);
  return {
    enabled: Boolean(mc),
    origin,
    source: envOverride ? 'env' : yamlOnly ? 'yaml' : 'none',
    env_override_active: envOverride,
    url_editable: !envOverride,
    yaml_url_for_edit: envOverride ? '' : String(config.muse?.url || ''),
  };
}

/** Phase 13: role store (data/hub_roles.json). Reloaded when config is reloaded (e.g. after POST setup). */
let roleMap = loadRoleMap(config.data_dir);

/** Phase 8 P1b-b: offline-locked auth posture (env gate read once at boot, §2.2). */
const offlineLockedPosture = resolveOfflineLockedAuthPosture();
const offlineLockedActive = offlineLockedPosture.active;
pruneExpiredBootstrapRecord(config.data_dir);
logBootstrapInstructionOnce(offlineLockedActive, credentialStoreHasAdmin(config.data_dir));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (!offlineLockedActive && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
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
if (!offlineLockedActive && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
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
  const role = effectiveRoleForHub(roleMap, sub, offlineLockedActive);
  return jwt.sign(
    { sub, provider: user.provider, id: user.id, name: user.displayName, role, type: 'session' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Re-mint a short-lived access token from a `sub` alone (used by POST /auth/refresh, which
 * only knows the user id). Role is re-derived from the current role store so a refreshed
 * token always reflects the latest Team role, exactly like login. Display name is omitted
 * (the UI reads it from /settings); identity for authorization is the `sub`.
 * @param {string} sub
 * @returns {string} signed JWT
 */
function issueAccessTokenForSub(sub) {
  const role = effectiveRoleForHub(roleMap, sub, offlineLockedActive);
  const idx = sub.indexOf(':');
  const provider = idx > 0 ? sub.slice(0, idx) : '';
  const id = idx > 0 ? sub.slice(idx + 1) : sub;
  return jwt.sign(
    { sub, provider, id, role, type: 'session' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

// Persistent sessions (refresh-token rotation). The refresh token is durable, hashed at
// rest, and delivered as an HttpOnly cookie; the security logic lives in
// hub/lib/refresh-token-core.mjs via the file store below.
const refreshStore = {
  issue: (sub, opts) => issueRefreshToken(config.data_dir, sub, opts),
  rotate: (token, opts) => rotateRefreshToken(config.data_dir, token, opts),
  revoke: (token) => revokeRefreshToken(config.data_dir, token),
};

/**
 * Cookie policy for the refresh token. Self-hosted Hub serves UI and API from one origin,
 * so SameSite=Lax is correct; Secure follows whether the deployment is HTTPS. Scoped to the
 * auth path so the cookie is only sent to /api/v1/auth endpoints.
 */
function refreshCookiePolicy() {
  return refreshCookieOptions({
    secure: BASE_URL.startsWith('https://'),
    sameSite: 'lax',
    maxAgeMs: 90 * 24 * 60 * 60 * 1000,
  });
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

function jwtAuthFlex(req, res, next) {
  const auth = req.headers.authorization;
  const headerToken = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  if (headerToken) {
    try {
      req.user = jwt.verify(headerToken, JWT_SECRET);
      return next();
    } catch (_) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
    }
  }
  if (queryToken) {
    const uid = verifyImageProxyToken(JWT_SECRET, queryToken);
    if (uid) {
      req.user = { sub: uid };
      return next();
    }
    // Backward compat: old hub.js sends full JWT as ?token= (pre-signed-token change).
    try {
      const decoded = jwt.verify(queryToken, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (_) { /* not a valid JWT either */ }
  }
  return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
}

/**
 * Phase 13: effective role for permission checks and Settings UI.
 * Always derived from hub_roles.json (roleMap), not from the JWT payload, so Team role changes
 * apply without forcing users to log out and back in. JWT `role` is only set at login time.
 */
function effectiveRole(req) {
  const sub = req.user?.sub ?? '';
  if (roleMap.size === 0) {
    return offlineLockedActive ? 'member' : 'admin';
  }
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

/** Approve: admin always; evaluator per data/hub_evaluator_may_approve.json + env fallback;
 * HOSTED-WRITE-EVAL: editor/member personal self-apply when Scooling fingerprint matches.
 * SEC-SEAM-1 / S2.1 + S6.2: author/session inputs + named seam refusal codes. */
function requireApproveRole(req, res, next) {
  const role = effectiveRole(req);
  const sub = req.user?.sub ?? '';
  const mayMap = readEvaluatorMayApprove(config.data_dir);
  if (actorMayApproveProposals(sub, role, mayMap, hubEnvEvaluatorMayApprove())) return next();

  const proposal = getProposal(config.data_dir, req.params.id);
  const hasVaultWrite = role === 'editor' || role === 'admin' || role === 'member';
  const authorActorId =
    proposal && typeof proposal.proposed_by === 'string' ? proposal.proposed_by : '';
  const reason = personalSelfApplyRefusalReason({
    proposal,
    hasVaultWrite,
    partitionOwned: Boolean(proposal),
    role,
    authorActorId,
    approverActorId: sub,
    sessionBound: isSessionBoundActor(req.user),
  });
  if (reason === null) {
    return next();
  }

  if (isHttpVisibleSelfApplySeamCode(reason)) {
    return res.status(403).json({
      error: SELF_APPLY_SEAM_ERROR_MESSAGES[reason] || reason,
      code: reason,
    });
  }

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
// Trust the first downstream proxy so express-rate-limit reads the real client IP from
// X-Forwarded-For instead of the CDN/load-balancer address.
app.set('trust proxy', 1);
const corsOrigin = process.env.HUB_CORS_ORIGIN;
const jsonBodyLimit = process.env.HUB_JSON_BODY_LIMIT || '5mb';
app.use(cors({ origin: corsOrigin ? corsOrigin.split(',') : true, credentials: true }));
app.use(express.json({ limit: jsonBodyLimit }));
app.use(cookieParser());
app.use(passport.initialize());

// Rate limits
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many login attempts', code: 'RATE_LIMIT' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests', code: 'RATE_LIMIT' } });
const importUrlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Too many URL imports. Try again later.', code: 'RATE_LIMIT' },
});

function captureAuth(req, res, next) {
  const secret = process.env.CAPTURE_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Capture webhook not configured (CAPTURE_WEBHOOK_SECRET missing)', code: 'NOT_CONFIGURED' });
  }
  const provided = req.headers['x-webhook-secret'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return res.status(401).json({ error: 'Invalid or missing X-Webhook-Secret', code: 'UNAUTHORIZED' });
  }
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid or missing X-Webhook-Secret', code: 'UNAUTHORIZED' });
  }
  return next();
}

function sanitizeForFilename(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';
}

// Health (no auth)
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));

// Which OAuth providers are configured (no auth; UI uses this to show buttons vs setup help)
app.get('/api/v1/auth/providers', (req, res) => {
  if (offlineLockedActive) {
    return res.json({ google: false, github: false, local: true });
  }
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  });
});

const oauthBlocked = oauthDisabledGuard(offlineLockedActive, config.data_dir);

// Auth: login redirect (rate limited). Optional ?invite=TOKEN passed through state for Phase 13 invite.
app.get('/api/v1/auth/login', loginLimiter, oauthBlocked, (req, res, next) => {
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
async function handleAuthCallback(req, res) {
  const redirect = (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');
  let token = issueToken(req.user);
  const sub = `${req.user.provider}:${req.user.id}`;
  // Start a persistent session: durable, HttpOnly refresh cookie alongside the access token.
  const issueSession = async () => {
    try {
      await issueRefreshCookie(res, {
        store: refreshStore,
        sub,
        cookieOptions: refreshCookiePolicy,
        meta: { ua: String(req.headers['user-agent'] || '').slice(0, 256) },
      });
    } catch (_) {
      // A refresh-store write failure must not block login; the access token still works.
    }
  };
  const statePayload = req.query.state ? verifyState(req.query.state, 7 * 24 * 60 * 60 * 1000) : null;
  if (statePayload && statePayload.invite && req.user && req.user.id) {
    const consumed = consumeInvite(config.data_dir, statePayload.invite, sub);
    if (consumed) {
      roleMap = loadRoleMap(config.data_dir);
      token = issueToken(req.user);
      await issueSession();
      return res.redirect(`${redirect}/#token=${encodeURIComponent(token)}&invite_accepted=1`);
    }
  }
  await issueSession();
  res.redirect(`${redirect}/#token=${encodeURIComponent(token)}`);
}
app.get(
  '/api/v1/auth/callback/google',
  oauthBlocked,
  passport.authenticate('google', { session: false }),
  handleAuthCallback
);
app.get(
  '/api/v1/auth/callback/github',
  oauthBlocked,
  passport.authenticate('github', { session: false }),
  handleAuthCallback
);

registerLocalAuthRoutes(app, {
  dataDir: config.data_dir,
  sessionSecret: JWT_SECRET,
  jwtExpiry: JWT_EXPIRY,
  offlineLockedActive,
  issueRefreshCookie: async (res, req, sub) => {
    await issueRefreshCookie(res, {
      store: refreshStore,
      sub,
      cookieOptions: refreshCookiePolicy,
      meta: { ua: String(req.headers['user-agent'] || '').slice(0, 256) },
    });
  },
});

// Persistent sessions: exchange the HttpOnly refresh cookie for a fresh access token, and
// real server-side logout (revokes the refresh token, not just the client cookie).
// Refresh is called on access-token expiry, so its limit is looser than the login limiter.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many refresh attempts', code: 'RATE_LIMIT' },
});
app.post(
  '/api/v1/auth/refresh',
  refreshLimiter,
  createRefreshHandler({
    store: refreshStore,
    issueAccessToken: issueAccessTokenForSub,
    cookieOptions: refreshCookiePolicy,
    meta: (req) => ({ ua: String(req.headers['user-agent'] || '').slice(0, 256) }),
  })
);
app.post(
  '/api/v1/auth/logout',
  createLogoutHandler({ store: refreshStore, cookieOptions: refreshCookiePolicy })
);
// Opportunistically prune dead refresh records at startup (best effort; never fatal).
try { pruneRefreshTokens(config.data_dir); } catch (_) { /* noop */ }

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
    const sigBuf = Buffer.from(sig, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
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
app.use('/api/v1/note-outline', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/document-tree', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/metadata-facets', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/section-source', jwtAuth, apiLimiter, requireVaultAccess);

// GET /api/v1/calendar/connectors/callback — Google OAuth redirect (state-authenticated; no JWT)
app.get('/api/v1/calendar/connectors/callback', async (req, res) => {
  try {
    const mod = await import('../lib/calendar/google-oauth-connector.mjs');
    const googleClient = mod.createProductionGoogleClient
      ? mod.createProductionGoogleClient()
      : mod.createFakeGoogleClient();
    const result = await mod.handleGoogleConnectorCallback({
      dataDir: config.data_dir,
      query: req.query,
      googleClient,
      env: process.env,
    });
    if (result.redirect) {
      return res.redirect(result.status, result.redirect);
    }
    return res.status(result.status).json({ code: result.code });
  } catch (e) {
    return res.status(500).json({ error: 'Callback failed', code: 'RUNTIME_ERROR' });
  }
});

app.use('/api/v1/calendar', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/flows', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/tasks', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/attachments', jwtAuth, apiLimiter, requireVaultAccess);
app.use('/api/v1/task-loops', jwtAuth, apiLimiter, requireVaultAccess);

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

// GET /api/v1/note-outline?path=... — body-free heading outline for one authorized note
app.get('/api/v1/note-outline', (req, res) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (!requestedPath) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  try {
    resolveVaultRelativePath(req.vaultPath, requestedPath);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  if (req.scope?.projects?.length || req.scope?.folders?.length) {
    const allowed = applyScopeFilter([{ path: requestedPath }], req.scope);
    if (allowed.length === 0) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
  }
  try {
    res.json(buildNoteOutline(readNote(req.vaultPath, requestedPath)));
  } catch (e) {
    const message = e?.message ? String(e.message) : '';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }
    if (message.includes('Invalid path')) {
      return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
    }
    return res.status(502).json({ error: 'Upstream error', code: 'UPSTREAM_ERROR' });
  }
});

// GET /api/v1/document-tree?path=... — body-free nested heading tree for one authorized note
app.get('/api/v1/document-tree', (req, res) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (!requestedPath) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  try {
    resolveVaultRelativePath(req.vaultPath, requestedPath);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  if (req.scope?.projects?.length || req.scope?.folders?.length) {
    const allowed = applyScopeFilter([{ path: requestedPath }], req.scope);
    if (allowed.length === 0) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
  }
  try {
    res.json(buildDocumentTree(readNote(req.vaultPath, requestedPath)));
  } catch (e) {
    const message = e?.message ? String(e.message) : '';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }
    if (message.includes('Invalid path')) {
      return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
    }
    return res.status(502).json({ error: 'Upstream error', code: 'UPSTREAM_ERROR' });
  }
});

// GET /api/v1/metadata-facets?path=... — body-free metadata hints for one authorized note
app.get('/api/v1/metadata-facets', (req, res) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (!requestedPath) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  try {
    resolveVaultRelativePath(req.vaultPath, requestedPath);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  if (req.scope?.projects?.length || req.scope?.folders?.length) {
    const allowed = applyScopeFilter([{ path: requestedPath }], req.scope);
    if (allowed.length === 0) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
  }
  try {
    const note = readNote(req.vaultPath, requestedPath);
    res.json(normalizeMetadataFacets(requestedPath, note.frontmatter));
  } catch (e) {
    const message = e?.message ? String(e.message) : '';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }
    if (message.includes('Invalid path')) {
      return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
    }
    return res.status(502).json({ error: 'Upstream error', code: 'UPSTREAM_ERROR' });
  }
});

// GET /api/v1/section-source?path=... — body-free section metadata for one authorized note
app.get('/api/v1/section-source', (req, res) => {
  const requestedPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
  if (!requestedPath) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  try {
    resolveVaultRelativePath(req.vaultPath, requestedPath);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
  }
  if (req.scope?.projects?.length || req.scope?.folders?.length) {
    const allowed = applyScopeFilter([{ path: requestedPath }], req.scope);
    if (allowed.length === 0) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
  }
  try {
    res.json(readSectionSource(req.vaultPath, requestedPath));
  } catch (e) {
    const message = e?.message ? String(e.message) : '';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }
    if (message.includes('Invalid path')) {
      return res.status(400).json({ error: 'Invalid path', code: 'INVALID_PATH' });
    }
    return res.status(502).json({ error: 'Upstream error', code: 'UPSTREAM_ERROR' });
  }
});

// GET /api/v1/calendar/timeline?from=&to=&layers=notes,events&source_calendar_ids=
app.get('/api/v1/calendar/timeline', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
  const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
  if (!from || !to) {
    return res.status(400).json({ error: '`from` and `to` are required', code: 'BAD_REQUEST' });
  }
  try {
    const payload = buildCalendarTimeline({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      vaultPath: req.vaultPath,
      vaultConfig: config,
      from,
      to,
      layers: req.query.layers,
      sourceCalendarIds: req.query.source_calendar_ids,
      scope: req.scope,
    });
    return res.json(payload);
  } catch (e) {
    const message = e?.message ? String(e.message) : 'Invalid timeline request';
    if (message.includes('Unsupported timeline layer') || message.includes('Invalid') || message.includes('required') || message.includes('before')) {
      return res.status(400).json({ error: message, code: 'BAD_REQUEST' });
    }
    return res.status(500).json({ error: message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/calendar/agent-context?from=&to=&agent_context_tier=0|1|2&source_calendar_ids=
// Server-side tier-enforced calendar context for agents (Phase 1E). Enforces
// enabled_for_agents + agent_context_tier_max + org policy cap; v0 ceiling tier 2.
app.get('/api/v1/calendar/agent-context', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from.trim() : '';
  const to = typeof req.query.to === 'string' ? req.query.to.trim() : '';
  if (!from || !to) {
    return res.status(400).json({ error: '`from` and `to` are required', code: 'BAD_REQUEST' });
  }
  try {
    const payload = retrieveAgentCalendarContext(config.data_dir, req.vault_id ?? 'default', {
      from,
      to,
      agentContextTier: req.query.agent_context_tier,
      sourceCalendarIds: req.query.source_calendar_ids,
    });
    return res.json(payload);
  } catch (e) {
    const message = e?.message ? String(e.message) : 'Invalid agent context request';
    if (
      message.includes('agent_context_tier')
      || message.includes('Invalid')
      || message.includes('required')
      || message.includes('before')
    ) {
      return res.status(400).json({ error: message, code: 'BAD_REQUEST' });
    }
    return res.status(500).json({ error: message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/calendar/source-calendars — display/agent toggles (no OAuth secrets)
app.get('/api/v1/calendar/source-calendars', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  try {
    res.json({
      schema: 'knowtation.source_calendars/v0',
      vault_id: req.vault_id ?? 'default',
      source_calendars: listSourceCalendarsForClient(config.data_dir, req.vault_id ?? 'default'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// PATCH /api/v1/calendar/source-calendars/:id — update display/agent toggles (self-hosted)
app.patch('/api/v1/calendar/source-calendars/:id', requireRole('editor', 'admin'), (req, res) => {
  const sourceCalendarId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  if (!sourceCalendarId) {
    return res.status(400).json({ error: 'source calendar id is required', code: 'BAD_REQUEST' });
  }
  try {
    const patch = parseSourceCalendarPatchBody(req.body);
    const result = patchSourceCalendar(
      config.data_dir,
      req.vault_id ?? 'default',
      sourceCalendarId,
      patch,
    );
    return res.json({
      schema: 'knowtation.source_calendar_patch/v0',
      vault_id: req.vault_id ?? 'default',
      policy_agent_context_tier_max_cap: result.policy_agent_context_tier_max_cap,
      source_calendar: result.source_calendar,
    });
  } catch (e) {
    const message = e?.message ? String(e.message) : 'Patch failed';
    if (e?.code === 'POLICY_CAP_EXCEEDED') {
      return res.status(403).json({ error: message, code: 'POLICY_CAP_EXCEEDED' });
    }
    if (message.includes('not found')) {
      return res.status(404).json({ error: message, code: 'NOT_FOUND' });
    }
    if (
      message.includes('must be')
      || message.includes('required')
      || message.includes('exceeds policy')
    ) {
      return res.status(400).json({ error: message, code: 'BAD_REQUEST' });
    }
    return res.status(500).json({ error: message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/calendar/events/import — one-time ICS file import (read-only, self-hosted)
app.post('/api/v1/calendar/events/import', requireRole('editor', 'admin'), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const icsText = typeof body.ics_text === 'string' ? body.ics_text : '';
  if (!icsText.trim()) {
    return res.status(400).json({ error: 'ics_text (string) is required', code: 'BAD_REQUEST' });
  }
  try {
    const result = importIcsIntoVault(config.data_dir, req.vault_id ?? 'default', {
      icsText,
      displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
      sourceCalendarId: typeof body.source_calendar_id === 'string' ? body.source_calendar_id : undefined,
      connectorId: typeof body.connector_id === 'string' ? body.connector_id : undefined,
      defaultTimezone: typeof body.default_timezone === 'string' ? body.default_timezone : undefined,
    });
    return res.status(200).json({
      schema: 'knowtation.calendar_import/v0',
      vault_id: req.vault_id ?? 'default',
      ...result,
    });
  } catch (e) {
    const message = e?.message ? String(e.message) : 'Import failed';
    if (message.includes('not found') || message.includes('required') || message.includes('exceeds') || message.includes('ICS')) {
      return res.status(400).json({ error: message, code: 'BAD_REQUEST' });
    }
    return res.status(500).json({ error: message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/calendar/connectors — begin Google OAuth connect (Phase 1D, gated)
app.post('/api/v1/calendar/connectors', requireRole('editor', 'admin'), (req, res) => {
  const result = handleBeginGoogleConnector({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    body: req.body,
    env: process.env,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error ?? 'Not authorized', code: result.code });
  }
  return res.status(result.status).json(result.payload);
});

// GET /api/v1/calendar/connectors — connector status (token-free, gated)
app.get('/api/v1/calendar/connectors', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const result = handleListGoogleConnectors({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error ?? 'Not authorized', code: result.code });
  }
  return res.json(result.payload);
});

// POST /api/v1/calendar/connectors/:id/sync — manual sync (gated, rate-limited)
app.post('/api/v1/calendar/connectors/:id/sync', requireRole('editor', 'admin'), async (req, res) => {
  const connectorId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  try {
    const mod = await import('../lib/calendar/google-oauth-connector.mjs');
    const googleClient = mod.createProductionGoogleClient
      ? mod.createProductionGoogleClient()
      : mod.createFakeGoogleClient();
    const result = await mod.handleSyncGoogleConnector({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      connectorId,
      googleClient,
      env: process.env,
    });
    if (!result.ok) {
      return res.status(result.status).json({ code: result.code });
    }
    return res.status(result.status).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// DELETE /api/v1/calendar/connectors/:id — revoke + purge (gated)
app.delete('/api/v1/calendar/connectors/:id', requireRole('editor', 'admin'), async (req, res) => {
  const connectorId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  try {
    const mod = await import('../lib/calendar/google-oauth-connector.mjs');
    const googleClient = mod.createProductionGoogleClient
      ? mod.createProductionGoogleClient()
      : mod.createFakeGoogleClient();
    const result = await mod.handleRevokeGoogleConnector({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      connectorId,
      googleClient,
      env: process.env,
    });
    if (!result.ok) {
      return res.status(result.status).json({ code: result.code });
    }
    return res.status(result.status).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// GET /api/v1/flows — scope/tag filtered, content-minimized list (Phase 7A-10b)
app.get('/api/v1/flows', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const limitRaw = req.query.limit;
  let limit;
  if (limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '') {
    limit = parseInt(String(limitRaw), 10);
  }
  const result = handleFlowListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
    tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
    limit,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// GET /api/v1/flows/:id/projection — derived harness projection (Phase 7A-11b)
app.get(
  '/api/v1/flows/:id/projection',
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
    const flowId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const harness = typeof req.query.harness === 'string' ? req.query.harness.trim() : '';
    const result = handleFlowProjectRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      flowId,
      harness,
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      version: typeof req.query.version === 'string' ? req.query.version : undefined,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  },
);

// GET /api/v1/flows/:id — full definition + ordered steps (Phase 7A-10b)
app.get('/api/v1/flows/:id', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const flowId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  const result = handleFlowGetRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    flowId,
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    version: typeof req.query.version === 'string' ? req.query.version : undefined,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// GET /api/v1/tasks — scope-filtered, content-minimized list (Phase 2G-b)
app.get('/api/v1/tasks', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const limitRaw = req.query.limit;
  let limit;
  if (limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '') {
    limit = parseInt(String(limitRaw), 10);
  }
  const result = handleTaskListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
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

// GET /api/v1/tasks/:id — one authorized task (Phase 2G-b)
app.get('/api/v1/tasks/:id', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const taskId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  const result = handleTaskGetRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    taskId,
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// GET /api/v1/attachments — scope-filtered, content-minimized list (Phase 2F-b-b)
app.get('/api/v1/attachments', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const limitRaw = req.query.limit;
  let limit;
  if (limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '') {
    limit = parseInt(String(limitRaw), 10);
  }
  const agentVisibleRaw = req.query.agent_visible;
  const agentVisible =
    agentVisibleRaw === 'true' || agentVisibleRaw === true || agentVisibleRaw === '1';
  const result = handleAttachmentListRequest({
    dataDir: config.data_dir,
    vaultPath: req.vaultPath,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
    note_ref: typeof req.query.note_ref === 'string' ? req.query.note_ref : undefined,
    source: typeof req.query.source === 'string' ? req.query.source : undefined,
    mime_class: typeof req.query.mime_class === 'string' ? req.query.mime_class : undefined,
    storage_kind: typeof req.query.storage_kind === 'string' ? req.query.storage_kind : undefined,
    agent_visible: agentVisible,
    limit,
    hubScope: req.scope ?? null,
    vaultConfig: { ignore: config.ignore },
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// Media write surfaces (Phase 2F-b-d-kn-b) — typed facade over /proposals (SD-4).
// Gated independently: MEDIA_EXTERNAL_LINK_ENABLED / MEDIA_ATTACH_ENABLED (default OFF).
const MEDIA_WRITE_ROLES = requireRole('editor', 'admin');
const MEDIA_CONSENT_READ_ROLES = requireRole('viewer', 'editor', 'admin', 'evaluator');

app.post('/api/v1/attachments/link-proposals', MEDIA_WRITE_ROLES, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await handleMediaLinkProposeRequest({
      dataDir: config.data_dir,
      vaultPath: req.vaultPath,
      vaultId: req.vault_id ?? 'default',
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      body,
      intent: body.intent,
      sessionBound: isSessionBoundActor(req.user),
      createProposal: createProposalWithSession(req),
      hubScope: req.scope ?? null,
      vaultConfig: { ignore: config.ignore },
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: 'media_external_link_propose',
      proposalId: result.payload.proposal_id,
      detail: {
        proposal_kind: result.payload.proposal_kind,
        attachment_id: result.payload.attachment_id,
      },
    });
    return res.status(201).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/attachments/attach-proposals', MEDIA_WRITE_ROLES, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await handleMediaAttachProposeRequest({
      dataDir: config.data_dir,
      vaultPath: req.vaultPath,
      vaultId: req.vault_id ?? 'default',
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      body,
      intent: body.intent,
      sessionBound: isSessionBoundActor(req.user),
      createProposal: createProposalWithSession(req),
      hubScope: req.scope ?? null,
      vaultConfig: { ignore: config.ignore },
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: 'media_attach_propose',
      proposalId: result.payload.proposal_id,
      detail: {
        proposal_kind: result.payload.proposal_kind,
        attachment_id: result.payload.attachment_id,
        note_ref: result.payload.note_ref,
      },
    });
    return res.status(201).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/attachments/import-consents', MEDIA_WRITE_ROLES, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleMediaImportConsentGrantRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    body,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.status(201).json(result.payload);
});

app.get('/api/v1/attachments/import-consents', MEDIA_CONSENT_READ_ROLES, (req, res) => {
  const result = handleMediaImportConsentListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.delete('/api/v1/attachments/import-consents/:id', MEDIA_WRITE_ROLES, (req, res) => {
  const consentId =
    typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  const result = handleMediaImportConsentRevokeRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    consentId,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// GET /api/v1/attachments/:id — one authorized attachment (Phase 2F-b-b)
app.get('/api/v1/attachments/:id', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const attachmentId =
    typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  const result = handleAttachmentGetRequest({
    dataDir: config.data_dir,
    vaultPath: req.vaultPath,
    vaultId: req.vault_id ?? 'default',
    attachmentId,
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    hubScope: req.scope ?? null,
    vaultConfig: { ignore: config.ignore },
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// GET /api/v1/task-loops — scope-filtered loop list (Phase 2G-c hosted parity)
app.get('/api/v1/task-loops', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const limitRaw = req.query.limit;
  let limit;
  if (limitRaw !== undefined && limitRaw !== null && String(limitRaw).trim() !== '') {
    limit = parseInt(String(limitRaw), 10);
  }
  const result = handleTaskLoopListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
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

// GET /api/v1/task-loops/:loop_id — one authorized loop (Phase 2G-c hosted parity)
app.get('/api/v1/task-loops/:loop_id', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const loopId =
    typeof req.params.loop_id === 'string' ? decodeURIComponent(req.params.loop_id).trim() : '';
  const result = handleTaskLoopGetRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    loopId,
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

// Loop pass audit mirror — append-only, idempotent on pass_id (Phase 2G-e OD-7).
// Gated by LOOP_PASS_AUDIT_MIRROR_ENABLED (default OFF → 403 LOOP_PASS_AUDIT_MIRROR_DISABLED).
app.post('/api/v1/loop-pass-audit', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleLoopPassAuditAppendRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    body,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.status(result.idempotent ? 200 : 201).json(result.payload);
});

// Task + task-loop write proposals (Phase 2G-d) — typed facade over /proposals (SD-4).
// Gated by TASK_WRITES_ENABLED (default OFF → 403 TASK_WRITES_DISABLED).
const TASK_WRITE_ROLES = requireRole('viewer', 'editor', 'admin', 'evaluator');

function createProposalWithSession(req) {
  return (dataDir, input) =>
    createProposal(dataDir, {
      ...input,
      session_bound: isSessionBoundActor(req.user),
    });
}


app.post('/api/v1/tasks/proposals', TASK_WRITE_ROLES, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const proposalKind =
      typeof body.proposal_kind === 'string' && body.proposal_kind.trim()
        ? body.proposal_kind.trim()
        : 'task_create';
    const result = await handleTaskProposeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      proposalKind,
      body,
      intent: body.intent,
      sessionBound: isSessionBoundActor(req.user),
      createProposal: createProposalWithSession(req),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: 'task_propose',
      proposalId: result.payload.proposal_id,
      detail: { proposal_kind: result.payload.proposal_kind, task_id: result.payload.task_id },
    });
    return res.status(201).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/task-loops/proposals', TASK_WRITE_ROLES, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const proposalKind =
      typeof body.proposal_kind === 'string' && body.proposal_kind.trim()
        ? body.proposal_kind.trim()
        : 'task_loop_create';
    const result = await handleTaskLoopProposeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      proposalKind,
      body,
      intent: body.intent,
      sessionBound: isSessionBoundActor(req.user),
      createProposal: createProposalWithSession(req),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: 'task_loop_propose',
      proposalId: result.payload.proposal_id,
      detail: { proposal_kind: result.payload.proposal_kind, loop_id: result.payload.loop_id },
    });
    return res.status(201).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/task-loops/:loop_id/instances/proposals', TASK_WRITE_ROLES, async (req, res) => {
  try {
    const loopId =
      typeof req.params.loop_id === 'string' ? decodeURIComponent(req.params.loop_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await handleTaskInstanceMaterializeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      loopId,
      body: { ...body, loop_id: loopId },
      intent: body.intent,
      sessionBound: isSessionBoundActor(req.user),
      createProposal: createProposalWithSession(req),
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: 'task_instance_materialize',
      proposalId: result.payload.proposal_id,
      detail: {
        loop_id: result.payload.loop_id,
        task_id: result.payload.task_id,
        occurrence_key: result.payload.occurrence_key,
      },
    });
    return res.status(201).json(result.payload);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// Flow authoring write-back (Phase 7A-L1b) — typed facade over /proposals (SD-4).
// Gated by FLOW_AUTHORING_WRITES (default OFF → 403 FLOW_AUTHORING_DISABLED).
const FLOW_AUTHORING_WRITE_ROLES = requireRole('viewer', 'editor', 'admin', 'evaluator');

function runFlowPropose(req, res, kind, extra = {}) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return handleFlowProposeRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    kind,
    flow: body.flow,
    steps: body.steps,
    bundle: kind === 'import' ? body.bundle ?? { flow: body.flow, steps: body.steps } : undefined,
    intent: body.intent,
    flowId: extra.flowId,
    baseVersion: body.base_version,
    baseStateId: body.base_state_id,
    externalRef: body.external_ref,
    sourceVaultHint: body.source_vault_hint,
    sessionBound: isSessionBoundActor(req.user),
    createProposal,
  }).then((result) => {
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: 'flow_propose',
      proposalId: result.payload.proposal_id,
      detail: { kind, flow_id: result.payload.flow_id },
    });
    return res.status(201).json(result.payload);
  });
}

// POST /api/v1/flows — propose a new Flow (flow_propose, new).
app.post('/api/v1/flows', FLOW_AUTHORING_WRITE_ROLES, (req, res) => {
  runFlowPropose(req, res, 'new').catch((e) => {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  });
});

// POST /api/v1/flows/:id/proposals — propose an edit to an existing Flow.
app.post('/api/v1/flows/:id/proposals', FLOW_AUTHORING_WRITE_ROLES, (req, res) => {
  const flowId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  runFlowPropose(req, res, 'edit', { flowId }).catch((e) => {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  });
});

// POST /api/v1/flows/import — import a portable bundle through the same path.
app.post('/api/v1/flows/import', FLOW_AUTHORING_WRITE_ROLES, (req, res) => {
  runFlowPropose(req, res, 'import').catch((e) => {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  });
});

// Flow capture flywheel (Phase 7A-L4b) — detection + capture writes independently gated.
const FLOW_CAPTURE_WRITE_ROLES = requireRole('viewer', 'editor', 'admin', 'evaluator');

app.post('/api/v1/flows/capture/observe', FLOW_CAPTURE_WRITE_ROLES, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleFlowCaptureObserveRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    sessionMeta: body,
    includeLowConfidence: body.include_low_confidence === true,
    harness: body.harness,
    config,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.get('/api/v1/flows/candidates', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
  const result = handleFlowCaptureListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
    includeLowConfidence: req.query.include_low_confidence === 'true',
    limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    config,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/flows/candidates/:candidate_id/propose', FLOW_CAPTURE_WRITE_ROLES, (req, res) => {
  const candidateId =
    typeof req.params.candidate_id === 'string' ? decodeURIComponent(req.params.candidate_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  handleFlowCaptureProposeRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    candidateId,
    confirmedScope: body.confirmed_scope,
    scopeWidenAcknowledged: body.scope_widen_acknowledged === true,
    allowLowConfidence: body.allow_low_confidence === true,
    forceNewFlow: body.force_new_flow === true,
    mergeIntoFlowId: body.merge_into_flow_id,
    intent: body.intent,
    createProposal,
    config,
  })
    .then((result) => {
      if (!result.ok) {
        const payload = { error: result.error, code: result.code };
        if (result.merge_into_flow_id) payload.merge_into_flow_id = result.merge_into_flow_id;
        if (result.overlap != null) payload.overlap = result.overlap;
        return res.status(result.status).json(payload);
      }
      appendAudit(config.data_dir, {
        userId: req.user?.sub ?? 'unknown',
        action: 'flow_capture_propose',
        proposalId: result.payload.proposal_id,
        detail: { candidate_id: candidateId },
      });
      return res.status(201).json(result.payload);
    })
    .catch((e) => {
      res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    });
});

app.post('/api/v1/flows/candidates/:candidate_id/dismiss', FLOW_CAPTURE_WRITE_ROLES, (req, res) => {
  const candidateId =
    typeof req.params.candidate_id === 'string' ? decodeURIComponent(req.params.candidate_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  handleFlowCaptureDismissRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    candidateId,
    intent: body.intent,
    createProposal,
  })
    .then((result) => {
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      appendAudit(config.data_dir, {
        userId: req.user?.sub ?? 'unknown',
        action: 'flow_capture_dismiss',
        proposalId: result.payload.proposal_id,
        detail: { candidate_id: candidateId },
      });
      return res.status(201).json(result.payload);
    })
    .catch((e) => {
      res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    });
});

// External-agent grants (Phase 7A-L2b) — gated by FLOW_EXTERNAL_AGENT_ENABLED (default off).
app.post(
  '/api/v1/flows/:id/external-grants',
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
    const flowId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = handleFlowExternalGrantMintRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      userId: req.user?.sub ?? '',
      role: effectiveRole(req),
      flowId,
      flowVersion: body.flow_version,
      requestedTools: body.requested_tools,
      ttlSeconds: body.ttl_seconds,
      actorLabel: body.actor_label,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json(result.payload);
  },
);

app.get('/api/v1/flows/external-grants', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const flowId = typeof req.query.flow_id === 'string' ? req.query.flow_id : undefined;
  const result = handleFlowExternalGrantListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    flowId,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.delete(
  '/api/v1/flows/external-grants/:grant_id',
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
    const grantId =
      typeof req.params.grant_id === 'string' ? decodeURIComponent(req.params.grant_id).trim() : '';
    const result = handleFlowExternalGrantRevokeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      grantId,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  },
);

app.post(
  '/api/v1/flows/external-tools/:tool_id/invoke',
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
    const toolId =
      typeof req.params.tool_id === 'string' ? decodeURIComponent(req.params.tool_id).trim() : '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const bearer =
      typeof req.headers['x-flow-external-bearer'] === 'string'
        ? req.headers['x-flow-external-bearer']
        : body.bearer;
    const result = handleFlowExternalToolInvokeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      toolId,
      bearer,
      flowId: body.flow_id,
      flowVersion: body.flow_version,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  },
);

// Agent delegation (Phase 7C-6) — gated by DELEGATION_ENABLED (default off).
app.post('/api/v1/agents/identities', requireRole('viewer', 'editor', 'admin', 'evaluator'), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await handleAgentIdentityRegisterProposeRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
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

app.get('/api/v1/agents/identities', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const result = handleAgentIdentityListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/delegation/consents', requireRole('viewer', 'editor', 'admin', 'evaluator'), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await handleDelegationConsentProposeRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
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

app.delete(
  '/api/v1/delegation/consents/:consent_id',
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
    const consentId =
      typeof req.params.consent_id === 'string' ? decodeURIComponent(req.params.consent_id).trim() : '';
    const result = handleDelegationConsentRevokeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      consentId,
      userId: req.user?.sub ?? '',
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  },
);

// SEC-KN-5 / P13: mint issues runtime bearer authority — admin only (not viewer/editor/evaluator).
app.post('/api/v1/delegation/grants', requireRole('admin'), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleDelegationGrantMintRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
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

app.get('/api/v1/delegation/grants', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const result = handleDelegationGrantListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    actorAgentId: typeof req.query.actor_agent_id === 'string' ? req.query.actor_agent_id : undefined,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.delete(
  '/api/v1/delegation/grants/:grant_id',
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
    const grantId =
      typeof req.params.grant_id === 'string' ? decodeURIComponent(req.params.grant_id).trim() : '';
    const result = handleDelegationGrantRevokeRequest({
      dataDir: config.data_dir,
      vaultId: req.vault_id ?? 'default',
      grantId,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json(result.payload);
  },
);

app.post('/api/v1/delegation/audit', requireRole('viewer', 'editor', 'admin', 'evaluator'), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const principalRef =
    typeof body.principal_ref === 'string' && body.principal_ref.trim()
      ? body.principal_ref.trim()
      : hashPrincipalRef(req.user?.sub ?? '');
  const result = handleDelegationAuditAppendRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
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

// Flow execution gate (Phase 7A-L3b) — gated by FLOW_RUN_WRITES_ENABLED / FLOW_AUTOMATABLE_EXECUTION_ENABLED.
const FLOW_RUN_WRITE_ROLES = requireRole('viewer', 'editor', 'admin', 'evaluator');

app.get('/api/v1/flow-runs/:run_id', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const result = handleFlowRunGetRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.get('/api/v1/flows/:id/runs', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const flowId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  const result = handleFlowRunListRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    flowId,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.get('/api/v1/flows/:id/runs/:run_id', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const result = handleFlowRunGetRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/flows/:id/runs', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const flowId = typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleFlowRunStartRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    flowId,
    flowVersion: body.flow_version,
    taskRef: body.task_ref,
    externalRef: body.external_ref,
    harness: 'hub',
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.status(201).json(result.payload);
});

app.post('/api/v1/flows/:id/runs/:run_id/advance', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleFlowRunAdvanceRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
    stepId: body.step_id,
    toStatus: body.to_status,
    skipReason: body.skip_reason,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/flows/:id/runs/:run_id/evidence', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleFlowRunEvidenceRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
    stepId: body.step_id,
    evidenceRef: body.evidence_ref,
    pointerKind: body.pointer_kind,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/flows/:id/runs/:run_id/execute-automatable', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleFlowRunExecuteAutomatableRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
    stepId: body.step_id,
    consentId: body.consent_id,
    modelLane: body.model_lane,
    dryRun: body.dry_run,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/flows/:id/runs/:run_id/submit-review', FLOW_RUN_WRITE_ROLES, async (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await handleFlowRunSubmitReviewRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
    intent: body.intent,
    createProposal,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.json(result.payload);
});

app.post('/api/v1/flows/:id/runs/:run_id/consent', FLOW_RUN_WRITE_ROLES, (req, res) => {
  const runId = typeof req.params.run_id === 'string' ? decodeURIComponent(req.params.run_id).trim() : '';
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = handleFlowExecutionConsentMintRequest({
    dataDir: config.data_dir,
    vaultId: req.vault_id ?? 'default',
    userId: req.user?.sub ?? '',
    role: effectiveRole(req),
    runId,
    allowedLanes: body.allowed_lanes,
    costCapUnits: body.cost_cap_units,
    ttlSeconds: body.ttl_seconds,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return res.status(201).json(result.payload);
});

/**
 * Fire-and-forget memory event capture after successful API responses.
 * Never throws, never delays the response — runs in a detached async chain.
 * @param {string} type - MEMORY_EVENT_TYPES value
 * @param {object} data - event payload
 * @param {object} cfg  - server config (for resolveMemoryDir)
 * @param {string} vaultId
 */
function fireCaptureEvent(type, data, cfg, vaultId) {
  (async () => {
    try {
      const { createMemoryManager } = await import('../lib/memory.mjs');
      const mm = createMemoryManager(cfg, vaultId || 'default');
      if (mm.shouldCapture(type)) mm.store(type, data);
    } catch (_) {}
  })();
}

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
      content_scope: req.query.content_scope,
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

// POST /api/v1/search — semantic (default) or keyword
app.post('/api/v1/search', async (req, res) => {
  const query = req.body?.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required', code: 'BAD_REQUEST' });
  }
  const rawLimit = req.body?.limit;
  const limit = rawLimit != null ? Math.min(100, Math.max(0, parseInt(rawLimit, 10) || 20)) : 20;
  const mode = req.body?.mode === 'keyword' ? 'keyword' : 'semantic';
  try {
    const opts = {
      folder: req.body.folder,
      project: req.body.project,
      tag: req.body.tag,
      since: req.body.since,
      until: req.body.until,
      order: req.body.order,
      fields: req.body.fields,
      vault_id: req.vault_id,
      content_scope: req.body.content_scope,
      chain: req.body.chain,
      entity: req.body.entity,
      episode: req.body.episode,
    };
    const vaultConfig = { ...config, vault_path: req.vaultPath };
    let out;
    if (mode === 'keyword') {
      const kwLimit = Math.max(1, Math.min(100, limit || 20));
      const kwOpts = {
        ...opts,
        limit: kwLimit,
        snippetChars: req.body.snippetChars != null ? parseInt(req.body.snippetChars, 10) || 300 : undefined,
        countOnly: req.body.count_only === true || req.body.countOnly === true,
        match: req.body.match === 'all_terms' ? 'all_terms' : 'phrase',
      };
      out = await runKeywordSearch(query, kwOpts, vaultConfig);
    } else {
      out = { ...(await runSearch(query, { ...opts, limit }, vaultConfig)), mode: 'semantic' };
    }
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
    fireCaptureEvent('search', { query, mode, result_count: out.results?.length ?? 0 }, config, req.vault_id || 'default');
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
    fireCaptureEvent('write', { path: notePath, action: append ? 'append' : 'write' }, config, req.vault_id || 'default');
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
    fireCaptureEvent('index', { note_count: result.notesProcessed, chunk_count: result.chunksIndexed }, config, req.vault_id || 'default');
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

// POST /api/v1/export — export one note to content (any vault reader). Returns { content, filename } for client download.
app.post(
  '/api/v1/export',
  jwtAuth,
  apiLimiter,
  requireVaultAccess,
  requireRole('viewer', 'editor', 'admin', 'evaluator'),
  (req, res) => {
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
  },
);

// POST /api/v1/notes/copy — copy or move one note between vaults (editor/admin; multi-vault). Overwrites target path if it exists.
app.post('/api/v1/notes/copy', requireRole('editor', 'admin'), (req, res) => {
  const body = req.body || {};
  const fromVault = typeof body.from_vault_id === 'string' ? body.from_vault_id.replace(/\\/g, '/').trim() : '';
  const toVault = typeof body.to_vault_id === 'string' ? body.to_vault_id.replace(/\\/g, '/').trim() : '';
  const rawPath = typeof body.path === 'string' ? body.path.replace(/\\/g, '/').trim() : '';
  const deleteSource = body.delete_source === true;
  if (!fromVault || !toVault || !rawPath || rawPath.includes('..') || rawPath.startsWith('/')) {
    return res.status(400).json({
      error: 'from_vault_id, to_vault_id, and path are required (vault-relative path)',
      code: 'BAD_REQUEST',
    });
  }
  if (fromVault === toVault) {
    return res.status(400).json({ error: 'from_vault_id and to_vault_id must differ', code: 'BAD_REQUEST' });
  }
  const allowed = getAllowedVaultIds(config.data_dir, req.user?.sub ?? '');
  if (!allowed.includes(fromVault) || !allowed.includes(toVault)) {
    return res.status(403).json({ error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' });
  }
  const fromPath = config.resolveVaultPath(fromVault);
  const toPath = config.resolveVaultPath(toVault);
  if (!fromPath || !toPath) {
    return res.status(404).json({ error: 'Vault not found.', code: 'NOT_FOUND' });
  }
  try {
    resolveVaultRelativePath(fromPath, rawPath);
    const note = readNote(fromPath, rawPath);
    const scopeFrom = getScopeForUserVault(config.data_dir, req.user?.sub ?? '', fromVault);
    if (scopeFrom && (scopeFrom.projects?.length || scopeFrom.folders?.length)) {
      const withProj = {
        path: note.path,
        project: materializeListFrontmatter(note.frontmatter).project ?? null,
      };
      const filtered = applyScopeFilter([withProj], scopeFrom);
      if (filtered.length === 0) {
        return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      }
    }
    const sub = req.user?.sub ?? '';
    const baseFm =
      typeof note.frontmatter === 'object' && note.frontmatter && !Array.isArray(note.frontmatter)
        ? { ...note.frontmatter }
        : {};
    const fm = mergeProvenanceFrontmatter(baseFm, { sub: sub || null, kind: 'human' });
    writeNote(toPath, note.path, { body: note.body, frontmatter: fm });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: toPath });
    fireCaptureEvent('write', { path: note.path, action: 'write' }, config, toVault);
    if (deleteSource) {
      try {
        deleteNote(fromPath, note.path);
      } catch (e) {
        return res.status(502).json({
          error: 'Note was copied to the target vault but deleting the source failed.',
          code: 'DELETE_FAILED',
        });
      }
      invalidateFacetsCache();
      maybeAutoSync({ ...config, vault_path: fromPath });
      fireCaptureEvent('write', { path: note.path, action: 'delete' }, config, fromVault);
    }
    res.json({
      ok: true,
      path: note.path,
      from_vault_id: fromVault,
      to_vault_id: toVault,
      moved: deleteSource,
    });
  } catch (e) {
    if (e.message && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    }
    if (e.message && e.message.includes('Invalid path')) {
      return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
    }
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
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
    const sourceType = (req.body && req.body.source_type) ? String(req.body.source_type).trim() : '';
    if (!IMPORT_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({ error: `source_type must be one of: ${IMPORT_SOURCE_TYPES.join(', ')}`, code: 'BAD_REQUEST' });
    }
    const sheetId = req.body && req.body.spreadsheet_id ? String(req.body.spreadsheet_id).trim() : '';
    const sheetsRange = req.body && req.body.sheets_range ? String(req.body.sheets_range).trim() : undefined;
    if (sourceType === 'google-sheets') {
      if (!sheetId) {
        return res
          .status(400)
          .json({ error: 'google-sheets: spreadsheet_id is required in the multipart body', code: 'BAD_REQUEST' });
      }
      if (req.file) {
        return res
          .status(400)
          .json({ error: 'google-sheets: do not send a file; use spreadsheet_id only', code: 'BAD_REQUEST' });
      }
    } else if (!req.file) {
      return res.status(400).json({ error: 'file required', code: 'BAD_REQUEST' });
    }
    const project = req.body && req.body.project ? String(req.body.project).trim() : undefined;
    const outputDir = req.body && req.body.output_dir ? String(req.body.output_dir).trim() : undefined;
    const tagsRaw = req.body && req.body.tags ? String(req.body.tags) : '';
    const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    let inputPath = sourceType === 'google-sheets' ? sheetId : req.file.path;
    if (sourceType !== 'google-sheets' && req.file && req.file.originalname && req.file.originalname.toLowerCase().endsWith('.zip')) {
      const extractDir = path.join(tempDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      const zip = new AdmZip(req.file.path);
      // Zip-slip protection: every entry must resolve inside extractDir
      const extractDirResolved = path.resolve(extractDir) + path.sep;
      for (const entry of zip.getEntries()) {
        const entryResolved = path.resolve(extractDir, entry.entryName);
        if (entryResolved !== path.resolve(extractDir) && !entryResolved.startsWith(extractDirResolved)) {
          return res.status(400).json({ error: 'Invalid zip entry: path traversal detected', code: 'BAD_REQUEST' });
        }
      }
      zip.extractAllTo(extractDir, true);
      inputPath = extractDir;
    }
    const result = await runImport(sourceType, inputPath, {
      project,
      outputDir,
      tags,
      vaultPath: req.vaultPath,
      ...(sheetsRange ? { sheetsRange } : {}),
    });
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

/**
 * Normalize `mode` for POST /api/v1/import-url body.
 * @param {unknown} raw
 * @returns {'auto' | 'bookmark' | 'extract'}
 */
function normalizeImportUrlMode(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'bookmark' || s === 'extract' || s === 'auto') return s;
  return 'auto';
}

/**
 * @param {unknown} body
 * @returns {string[]}
 */
function tagsFromImportUrlBody(body) {
  const t = body && body.tags;
  if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

// POST /api/v1/import-url — JSON { url, mode?, project?, output_dir?, tags? }; editor/admin.
app.post(
  '/api/v1/import-url',
  jwtAuth,
  importUrlLimiter,
  requireVaultAccess,
  requireRole('editor', 'admin'),
  async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const urlStr = typeof body.url === 'string' ? body.url.trim() : '';
      if (!urlStr) return res.status(400).json({ error: 'url required', code: 'BAD_REQUEST' });
      const urlMode = normalizeImportUrlMode(body.mode);
      const project = body.project != null && String(body.project).trim() !== '' ? String(body.project).trim() : undefined;
      const outputDir =
        body.output_dir != null && String(body.output_dir).trim() !== '' ? String(body.output_dir).trim() : undefined;
      const tags = tagsFromImportUrlBody(body);
      const result = await runImport('url', urlStr, {
        project,
        outputDir,
        tags,
        urlMode,
        vaultPath: req.vaultPath,
      });
      const importStamp = mergeProvenanceFrontmatter({}, {
        sub: req.user?.sub ?? null,
        kind: 'import',
      });
      for (const item of result.imported || []) {
        if (item.path && typeof item.path === 'string') {
          try {
            writeNote(req.vaultPath, item.path, { frontmatter: importStamp });
          } catch (e) {
            console.error('hub import-url provenance pass failed for', item.path, e.message || e);
          }
        }
      }
      invalidateFacetsCache();
      maybeAutoSync({ ...config, vault_path: req.vaultPath });
      res.json({ imported: result.imported, count: result.count });
    } catch (e) {
      const msg = e.message || String(e);
      const clientError =
        /OPENAI_API_KEY|required for transcription|Only https|blocked|private IP|timed out|exceeds \d+ bytes|Invalid URL|URL is required|Extract mode requires|Could not extract|DNS resolution failed|Too many redirects|non-https/i.test(
          msg,
        );
      res.status(clientError ? 400 : 500).json({
        error: msg,
        code: clientError ? 'BAD_REQUEST' : 'RUNTIME_ERROR',
      });
    }
  },
);

// Phase 18D: Upload image to GitHub backup repo, return raw URL for note embedding
const imageUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many image uploads. Try again later.', code: 'RATE_LIMIT' },
});
const imageUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('image');

app.post(
  /^\/api\/v1\/notes\/(.+)\/upload-image$/,
  jwtAuth,
  apiLimiter,
  imageUploadLimiter,
  requireVaultAccess,
  requireRole('editor', 'admin'),
  imageUploadMiddleware,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'image file is required (multipart field "image")', code: 'BAD_REQUEST' });
      }

      const githubConn = readGitHubConnection(config.data_dir);
      if (!githubConn?.access_token) {
        return res.status(400).json({
          error: 'GitHub is not connected. Go to Settings → Backup → Connect GitHub first.',
          code: 'GITHUB_NOT_CONNECTED',
        });
      }

      const remoteUrl = config.vault_git?.remote;
      if (!remoteUrl) {
        return res.status(400).json({
          error: 'No Git remote URL configured. Go to Settings → Backup and set a remote URL.',
          code: 'NO_GIT_REMOTE',
        });
      }

      const originalName = req.file.originalname || 'image.png';
      let ext;
      try {
        ext = validateImageExtension(originalName);
      } catch (e) {
        return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
      }

      const contentType = req.file.mimetype || '';
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: `Invalid Content-Type: ${contentType}. Must be image/*`, code: 'BAD_REQUEST' });
      }

      if (!validateMagicBytes(req.file.buffer, ext)) {
        return res.status(400).json({
          error: `File content does not match .${ext} format (magic bytes mismatch). The file may be corrupted or not a real image.`,
          code: 'BAD_REQUEST',
        });
      }

      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
      const uniqueName = `${Date.now()}-${safeName}`;
      const repoFilePath = `media/images/${yearMonth}/${uniqueName}`;

      const result = await commitImageToRepo({
        accessToken: githubConn.access_token,
        repoUrl: remoteUrl,
        filePath: repoFilePath,
        fileBuffer: req.file.buffer,
        commitMessage: `Add image: ${safeName}`,
      });

      const insertedMarkdown = `![${safeName}](${result.url})`;

      res.json({
        url: result.url,
        inserted_markdown: insertedMarkdown,
        sha: result.sha,
        repo_path: repoFilePath,
        repo_private: result.isPrivate === true,
      });
    } catch (e) {
      const msg = e.message || String(e);
      const clientErr = /not found|not connected|lacks permission|lacks repo|Reconnect|scope|remote/i.test(msg);
      res.status(clientErr ? 400 : 500).json({
        error: msg,
        code: clientErr ? 'BAD_REQUEST' : 'RUNTIME_ERROR',
      });
    }
  },
);

app.get('/api/v1/vault/image-proxy-token', jwtAuth, (req, res) => {
  const uid = req.user?.sub ?? '';
  if (!uid) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  const token = signImageProxyToken(JWT_SECRET, uid);
  res.json({ token, expires_in: IMAGE_PROXY_TOKEN_TTL_SECONDS });
});

const IMAGE_PROXY_SIZE_LIMIT = 10 * 1024 * 1024;
app.get('/api/v1/vault/image-proxy', jwtAuthFlex, apiLimiter, async (req, res) => {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  // Accept only raw.githubusercontent.com URLs to prevent SSRF.
  if (!/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/.+$/i.test(rawUrl)) {
    return res.status(400).json({ error: 'url must be a raw.githubusercontent.com path', code: 'BAD_REQUEST' });
  }
  // Read the stored GitHub token for this user (falls back to any connected token).
  let accessToken = '';
  try {
    const userId = req.user?.sub ?? '';
    const conn = readGitHubConnection(config.data_dir, userId || undefined);
    if (conn?.access_token) accessToken = conn.access_token;
  } catch (_) {}

  const fetchHeaders = { 'User-Agent': 'Knowtation-Hub/1.0' };
  if (accessToken) fetchHeaders.Authorization = `token ${accessToken}`;

  let upstream;
  try {
    upstream = await fetch(rawUrl, { headers: fetchHeaders });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to fetch image from GitHub', code: 'UPSTREAM_ERROR' });
  }

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: 'Image not found on GitHub', code: 'UPSTREAM_ERROR' });
  }

  const ct = upstream.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) {
    return res.status(400).json({ error: 'URL does not point to an image', code: 'BAD_REQUEST' });
  }

  // Buffer and enforce size limit before sending.
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.byteLength > IMAGE_PROXY_SIZE_LIMIT) {
    return res.status(400).json({ error: 'Image too large (max 10 MB)', code: 'BAD_REQUEST' });
  }

  res.setHeader('Content-Type', ct);
  res.setHeader('Content-Length', buf.byteLength);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
});

// Optional Muse read-only proxy (admin; Option C). 404 when MUSE_URL unset.
app.get('/api/v1/operator/muse/proxy', jwtAuth, apiLimiter, requireRole('admin'), async (req, res) => {
  const cfg = parseMuseConfigFromEnv(museEnvForBridge());
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

app.post('/api/v1/proposals', requireRole('editor', 'admin', 'evaluator'), (req, res) => {
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
    if (getProposalReviewHintsEnabled(config.data_dir)) {
      setImmediate(() => {
        runProposalReviewHintsJob(config, proposal.proposal_id).catch(() => {});
      });
    }
    res.status(201).json(proposal);
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
});

app.post('/api/v1/proposals/:id/approve', requireApproveRole, async (req, res) => {
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
  // Flow proposals carry a flowst1_ token, not a note kn1_; the authoritative
  // flow concurrency re-check runs below instead of the note-level check.
  if (
    expectedBase &&
    proposal.source !== FLOW_PROPOSAL_SOURCE &&
    proposal.source !== FLOW_CAPTURE_PROPOSAL_SOURCE &&
    proposal.source !== DELEGATION_PROPOSAL_SOURCE &&
    proposal.source !== TASK_PROPOSAL_SOURCE &&
    proposal.source !== MEDIA_PROPOSAL_SOURCE
  ) {
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
  // Authoritative Flow concurrency + bundle re-check BEFORE the mirror write, so
  // a conflict short-circuits with zero partial state (no index write, no mirror).
  let flowApply = null;
  if (proposal.source === FLOW_PROPOSAL_SOURCE) {
    const flowPrecheck = precheckApprovedFlowProposal(config.data_dir, proposal);
    if (!flowPrecheck.ok) {
      return res.status(flowPrecheck.status).json({ error: flowPrecheck.error, code: flowPrecheck.code });
    }
    flowApply = flowPrecheck;
  }
  let captureApply = null;
  if (proposal.source === FLOW_CAPTURE_PROPOSAL_SOURCE) {
    const capturePrecheck = precheckApprovedCaptureProposal(config.data_dir, proposal);
    if (!capturePrecheck.ok) {
      return res.status(capturePrecheck.status).json({ error: capturePrecheck.error, code: capturePrecheck.code });
    }
    captureApply = capturePrecheck;
  }
  let delegationApply = null;
  if (proposal.source === DELEGATION_PROPOSAL_SOURCE) {
    const delegationPrecheck = precheckApprovedDelegationProposal(config.data_dir, proposal, {
      author: typeof proposal.proposed_by === 'string' ? proposal.proposed_by : '',
    });
    if (!delegationPrecheck.ok) {
      return res.status(delegationPrecheck.status).json({
        error: delegationPrecheck.error,
        code: delegationPrecheck.code,
      });
    }
    delegationApply = delegationPrecheck;
  }
  let taskApply = null;
  if (proposal.source === TASK_PROPOSAL_SOURCE) {
    const taskPrecheck = precheckApprovedTaskProposal(config.data_dir, proposal);
    if (!taskPrecheck.ok) {
      return res.status(taskPrecheck.status).json({ error: taskPrecheck.error, code: taskPrecheck.code });
    }
    taskApply = taskPrecheck;
  }
  let mediaApply = null;
  if (proposal.source === MEDIA_PROPOSAL_SOURCE) {
    const mediaPrecheck = precheckApprovedMediaProposal(config.data_dir, proposal, {
      vaultPath: approveVaultPath,
      vaultConfig: { ignore: config.ignore },
    });
    if (!mediaPrecheck.ok) {
      return res.status(mediaPrecheck.status).json({ error: mediaPrecheck.error, code: mediaPrecheck.code });
    }
    mediaApply = mediaPrecheck;
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
    // Reconcile the approved mirror into the Flow index (new (flow_id, version)
    // row) — the only index write besides seed. Bundle pre-validated above.
    if (flowApply) {
      applyFlowProposalToIndex(config.data_dir, flowApply.vaultId, flowApply.flow, flowApply.steps);
    }
    if (captureApply) {
      applyCaptureProposal(config.data_dir, captureApply);
    }
    if (delegationApply) {
      applyDelegationProposalToIndex(config.data_dir, delegationApply);
    }
    if (taskApply) {
      const taskReconcile = reconcileApprovedTaskProposal(config.data_dir, taskApply);
      if (taskReconcile.cascade_task_ids && Array.isArray(taskReconcile.cascade_task_ids)) {
        patchProposalTaskMetaCascade(config.data_dir, req.params.id, taskReconcile.cascade_task_ids);
      }
    }
    if (mediaApply) {
      reconcileApprovedMediaProposal(config.data_dir, mediaApply);
    }
    const approvedAtIso = new Date().toISOString();
    let approval_log_written = false;
    let approval_log_path;
    let approval_log_error;
    try {
      const excerpt =
        proposal.body != null && String(proposal.body).trim()
          ? String(proposal.body).replace(/\s+/g, ' ').trim()
          : '';
      const logSpec = buildApprovalLogWrite({
        proposalId: proposal.proposal_id,
        targetPath: proposal.path,
        approvedAt: approvedAtIso,
        approvedBy: req.user?.sub ?? undefined,
        proposedBy: proposal.proposed_by ?? undefined,
        intent: proposal.intent,
        source: proposal.source,
        proposedBodyExcerpt: excerpt || undefined,
      });
      writeNote(approveVaultPath, logSpec.relativePath, {
        body: logSpec.body,
        frontmatter: logSpec.frontmatter,
      });
      approval_log_written = true;
      approval_log_path = logSpec.relativePath;
    } catch (e) {
      approval_log_error = e.message || String(e);
    }
    let evaluation_waiver;
    if (!evaluationAllowsApprove(proposal) && waiverReason.length >= 3) {
      evaluation_waiver = {
        by: req.user?.sub ?? 'unknown',
        at: approvedAtIso,
        reason: waiverReason.slice(0, 2000),
      };
    }
    const museCfg = parseMuseConfigFromEnv(museEnvForBridge());
    const resolvedExternalRef = await resolveExternalRefForApprove({
      clientRef: approveBody.external_ref,
      proposalId: req.params.id,
      vaultId: proposal.vault_id ?? 'default',
      config: museCfg,
    });
    const updated = updateProposalStatus(config.data_dir, req.params.id, 'approved', {
      ...(evaluation_waiver ? { evaluation_waiver } : {}),
      ...(resolvedExternalRef ? { external_ref: resolvedExternalRef } : {}),
    });
    /** @type {Record<string, unknown>} */
    const approveDetail = {};
    if (evaluation_waiver) approveDetail.reason_len = waiverReason.length;
    if (resolvedExternalRef) {
      approveDetail.external_ref_set = true;
      approveDetail.external_ref_len = resolvedExternalRef.length;
    }
    appendAudit(config.data_dir, {
      userId: req.user?.sub ?? 'unknown',
      action: evaluation_waiver ? 'approve_waiver' : 'approve',
      proposalId: req.params.id,
      ...(Object.keys(approveDetail).length ? { detail: approveDetail } : {}),
    });
    invalidateFacetsCache();
    maybeAutoSync({ ...config, vault_path: approveVaultPath });
    res.json({
      ...updated,
      approval_log_written,
      ...(approval_log_path ? { approval_log_path } : {}),
      ...(approval_log_error ? { approval_log_error } : {}),
    });
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
  if (!getProposalEnrichEnabled(config.data_dir)) {
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
    const { buildEnrichMessages, validateAndNormalizeEnrichResult } = await import('../lib/proposal-enrich-llm.mjs');
    const { system, user } = buildEnrichMessages({
      path: proposal.path,
      intent: proposal.intent,
      body: proposal.body,
    });
    const raw = await completeChat(config, { system, user, maxTokens: 1200 });
    const norm = validateAndNormalizeEnrichResult(raw);
    const model = process.env.OPENAI_API_KEY
      ? config.llm?.openai_chat_model || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
      : process.env.OLLAMA_CHAT_MODEL || config.llm?.ollama_chat_model || process.env.OLLAMA_MODEL || 'ollama';
    const updated = updateProposalEnrichment(config.data_dir, req.params.id, {
      assistant_notes: norm.summary,
      assistant_model: String(model).slice(0, 128),
      suggested_labels: norm.suggested_labels,
      assistant_suggested_frontmatter: norm.suggested_frontmatter,
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
  const storedPolicy = readProposalPolicyFile(config.data_dir);
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
    proposal_enrich_enabled: getProposalEnrichEnabled(config.data_dir),
    proposal_evaluation_required: getProposalEvaluationRequired(config.data_dir),
    proposal_review_hints_enabled: getProposalReviewHintsEnabled(config.data_dir),
    proposal_policy_stored: {
      proposal_evaluation_required: storedPolicy.proposal_evaluation_required === true,
      review_hints_enabled: storedPolicy.review_hints_enabled === true,
      enrich_enabled: storedPolicy.enrich_enabled === true,
    },
    proposal_policy_env_locked: proposalPolicyEnvLocked(),
    hub_evaluator_may_approve: actorMayApproveProposals(
      req.user?.sub ?? '',
      effectiveRole(req),
      readEvaluatorMayApprove(config.data_dir),
      hubEnvEvaluatorMayApprove(),
    ),
    proposal_rubric: loadProposalRubric(config.data_dir),
    muse_bridge: museBridgePublicSettings(),
    chat: {
      provider: config.llm?.provider || '',
      providers: CHAT_PROVIDERS,
      env_locked: Boolean(process.env.KNOWTATION_CHAT_PROVIDER),
      env_provider: String(process.env.KNOWTATION_CHAT_PROVIDER || '').trim().toLowerCase() || null,
      key_available: {
        openai: Boolean(process.env.OPENAI_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        deepinfra: Boolean(process.env.DEEPINFRA_API_KEY),
        openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      },
    },
    daemon: {
      enabled: Boolean(config.daemon?.enabled),
      interval_minutes: config.daemon?.interval_minutes ?? 120,
      idle_only: config.daemon?.idle_only !== false,
      idle_threshold_minutes: config.daemon?.idle_threshold_minutes ?? 15,
      run_on_start: Boolean(config.daemon?.run_on_start),
      max_cost_per_day_usd: config.daemon?.max_cost_per_day_usd ?? null,
      passes: {
        consolidate: config.daemon?.passes?.consolidate !== false,
        verify: config.daemon?.passes?.verify !== false,
        discover: Boolean(config.daemon?.passes?.discover),
      },
      llm: {
        provider: config.daemon?.llm?.provider || '',
        model: config.daemon?.llm?.model || '',
        base_url: config.daemon?.llm?.base_url || '',
        max_tokens: config.daemon?.llm?.max_tokens ?? 1024,
      },
      lookback_hours: config.daemon?.lookback_hours ?? 24,
      max_events_per_pass: config.daemon?.max_events_per_pass ?? 200,
      max_topics_per_pass: config.daemon?.max_topics_per_pass ?? 10,
    },
  });
});

app.post(
  '/api/v1/settings/consolidation',
  jwtAuth,
  apiLimiter,
  requireRole('admin'),
  express.json(),
  async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const yaml = (await import('js-yaml')).default;
      const configPath = process.env.KNOWTATION_CONFIG || path.join(projectRoot, 'config', 'local.yaml');
      let doc = {};
      if (fs.existsSync(configPath)) {
        doc = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
      }
      if (!doc.daemon) doc.daemon = {};
      if (body.enabled !== undefined) doc.daemon.enabled = Boolean(body.enabled);
      if (body.interval_minutes !== undefined) {
        const iv = Math.floor(Number(body.interval_minutes) || 0);
        if (iv < 1 || iv > 43200) return res.status(400).json({ error: 'interval_minutes must be 1–43200', code: 'VALIDATION_ERROR' });
        doc.daemon.interval_minutes = iv;
      }
      if (body.idle_only !== undefined) doc.daemon.idle_only = Boolean(body.idle_only);
      if (body.idle_threshold_minutes !== undefined) doc.daemon.idle_threshold_minutes = Math.max(1, Math.floor(Number(body.idle_threshold_minutes) || 15));
      if (body.run_on_start !== undefined) doc.daemon.run_on_start = Boolean(body.run_on_start);
      if (body.max_cost_per_day_usd !== undefined) {
        doc.daemon.max_cost_per_day_usd = body.max_cost_per_day_usd === '' || body.max_cost_per_day_usd === null ? null : Math.max(0, Number(body.max_cost_per_day_usd) || 0);
      }
      if (body.passes !== undefined && typeof body.passes === 'object') {
        if (!doc.daemon.passes) doc.daemon.passes = {};
        if (body.passes.consolidate !== undefined) doc.daemon.passes.consolidate = Boolean(body.passes.consolidate);
        if (body.passes.verify !== undefined) doc.daemon.passes.verify = Boolean(body.passes.verify);
        if (body.passes.discover !== undefined) doc.daemon.passes.discover = Boolean(body.passes.discover);
      }
      if (body.lookback_hours !== undefined) {
        const lb = Math.floor(Number(body.lookback_hours));
        if (lb < 1 || lb > 8760) {
          return res.status(400).json({ error: 'lookback_hours must be 1–8760', code: 'VALIDATION_ERROR' });
        }
        doc.daemon.lookback_hours = lb;
      }
      if (body.max_events_per_pass !== undefined) {
        const me = Math.floor(Number(body.max_events_per_pass));
        if (me < 1 || me > 10000) {
          return res.status(400).json({ error: 'max_events_per_pass must be 1–10000', code: 'VALIDATION_ERROR' });
        }
        doc.daemon.max_events_per_pass = me;
      }
      if (body.max_topics_per_pass !== undefined) {
        const mt = Math.floor(Number(body.max_topics_per_pass));
        if (mt < 1 || mt > 500) {
          return res.status(400).json({ error: 'max_topics_per_pass must be 1–500', code: 'VALIDATION_ERROR' });
        }
        doc.daemon.max_topics_per_pass = mt;
      }
      if (body.llm !== undefined && typeof body.llm === 'object') {
        if (!doc.daemon.llm) doc.daemon.llm = {};
        if (body.llm.provider !== undefined) doc.daemon.llm.provider = String(body.llm.provider || '');
        if (body.llm.model !== undefined) {
          const m = String(body.llm.model || '');
          if (/[/\\;|&$`(){}<>!#]/.test(m)) return res.status(400).json({ error: 'Invalid model name', code: 'VALIDATION_ERROR' });
          doc.daemon.llm.model = m;
        }
        if (body.llm.base_url !== undefined) doc.daemon.llm.base_url = String(body.llm.base_url || '');
        if (body.llm.max_tokens !== undefined) {
          const mxt = Math.floor(Number(body.llm.max_tokens));
          if (mxt < 64 || mxt > 8192) {
            return res.status(400).json({ error: 'llm.max_tokens must be 64–8192', code: 'VALIDATION_ERROR' });
          }
          doc.daemon.llm.max_tokens = mxt;
        }
      }
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(configPath, yaml.dump(doc), 'utf8');
      config = loadConfig(projectRoot);
      res.json({ ok: true, daemon: doc.daemon });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to save', code: 'RUNTIME_ERROR' });
    }
  },
);

// POST /api/v1/settings/chat — set the completeChat provider (MCP summarize + proposal LLM jobs).
// Admin only. Persists llm.provider to config/local.yaml. The provider drives where note text is
// sent and which account is billed, so input is strictly whitelisted. When KNOWTATION_CHAT_PROVIDER
// is set, the operator env lock wins and the UI cannot change it (409).
app.post(
  '/api/v1/settings/chat',
  jwtAuth,
  apiLimiter,
  requireRole('admin'),
  express.json(),
  async (req, res) => {
    try {
      if (process.env.KNOWTATION_CHAT_PROVIDER) {
        return res.status(409).json({
          error:
            'Chat provider is locked by the KNOWTATION_CHAT_PROVIDER environment variable; unset it to manage the provider from the UI.',
          code: 'ENV_LOCKED',
        });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = normalizeChatProviderInput(body.provider);
      if (!result.ok) {
        return res.status(400).json({ error: result.error, code: 'VALIDATION_ERROR' });
      }
      const yaml = (await import('js-yaml')).default;
      const configPath = process.env.KNOWTATION_CONFIG || path.join(projectRoot, 'config', 'local.yaml');
      let doc = {};
      if (fs.existsSync(configPath)) {
        doc = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
      }
      if (!doc.llm || typeof doc.llm !== 'object') doc.llm = {};
      doc.llm.provider = result.provider;
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(configPath, yaml.dump(doc), 'utf8');
      config = loadConfig(projectRoot);
      res.json({ ok: true, chat: { provider: config.llm?.provider || '' } });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to save', code: 'RUNTIME_ERROR' });
    }
  },
);

/**
 * Validate optional Muse base URL for config/local.yaml (self-hosted Settings).
 * @param {unknown} raw
 * @returns {{ ok: true, url: string } | { ok: false, error: string, code: string }}
 */
function validateMuseUrlForYaml(raw) {
  if (raw == null) return { ok: true, url: '' };
  const s = String(raw).trim();
  if (!s) return { ok: true, url: '' };
  if (s.length > 2048) return { ok: false, error: 'URL too long (max 2048)', code: 'VALIDATION_ERROR' };
  const normalized = s.replace(/\/+$/, '');
  const parsed = parseMuseConfigFromEnv({ ...process.env, MUSE_URL: normalized });
  if (!parsed) {
    return {
      ok: false,
      error: 'Muse URL must start with https:// or http:// and be a valid URL.',
      code: 'VALIDATION_ERROR',
    };
  }
  return { ok: true, url: parsed.baseUrl };
}

app.post(
  '/api/v1/settings/muse',
  jwtAuth,
  apiLimiter,
  requireRole('admin'),
  express.json(),
  async (req, res) => {
    try {
      if (process.env.MUSE_URL != null && String(process.env.MUSE_URL).trim() !== '') {
        return res.status(409).json({
          error:
            'MUSE_URL is set in the Hub process environment. Unset it to save the Muse URL in config/local.yaml from Settings.',
          code: 'ENV_CONFLICT',
        });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const v = validateMuseUrlForYaml(body.url);
      if (!v.ok) return res.status(400).json({ error: v.error, code: v.code });
      const yaml = (await import('js-yaml')).default;
      const configPath = process.env.KNOWTATION_CONFIG || path.join(projectRoot, 'config', 'local.yaml');
      let doc = {};
      if (fs.existsSync(configPath)) {
        doc = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
      }
      if (!v.url) {
        if (doc.muse && typeof doc.muse === 'object') {
          delete doc.muse.url;
          if (Object.keys(doc.muse).length === 0) delete doc.muse;
        }
      } else {
        doc.muse = { ...(doc.muse && typeof doc.muse === 'object' ? doc.muse : {}), url: v.url };
      }
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(configPath, yaml.dump(doc), 'utf8');
      config = loadConfig(projectRoot);
      roleMap = loadRoleMap(config.data_dir);
      res.json({ ok: true, muse_bridge: museBridgePublicSettings() });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to save', code: 'RUNTIME_ERROR' });
    }
  },
);

app.post(
  '/api/v1/settings/proposal-policy',
  jwtAuth,
  apiLimiter,
  requireRole('admin'),
  (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      writeProposalPolicyMerge(config.data_dir, {
        proposal_evaluation_required: body.proposal_evaluation_required,
        review_hints_enabled: body.review_hints_enabled,
        enrich_enabled: body.enrich_enabled,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
    }
  },
);

/**
 * POST /api/v1/memory/consolidate
 * Self-hosted: runs consolidation inline using the user's config (LLM key from env or config.daemon).
 * Body: { dry_run?, passes?, lookback_hours? }
 */
app.post('/api/v1/memory/consolidate', jwtAuth, apiLimiter, express.json(), async (req, res) => {
  const uid = req.user?.sub ?? 'local';
  const { dry_run, passes, lookback_hours } = req.body || {};

  const llmApiKey =
    config.daemon?.llm?.api_key ||
    process.env.CONSOLIDATION_LLM_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!llmApiKey) {
    return res.status(503).json({
      error: 'No LLM API key configured. Set OPENAI_API_KEY in your environment or config/local.yaml daemon.llm.api_key.',
      code: 'LLM_NOT_CONFIGURED',
    });
  }

  try {
    const { createMemoryManager } = await import('../lib/memory.mjs');
    const { consolidateMemory } = await import('../lib/memory-consolidate.mjs');
    const { computeCallCost } = await import('../lib/daemon-cost.mjs');
    const { completeChat } = await import('../lib/llm-complete.mjs');

    const vaultId = req.vault_id || 'default';
    const mm = createMemoryManager(config, vaultId);

    const consolidationConfig = {
      data_dir: config.data_dir,
      llm: {
        provider: config.daemon?.llm?.provider || 'openai',
        api_key: llmApiKey,
        model: config.daemon?.llm?.model || process.env.CONSOLIDATION_LLM_MODEL || 'gpt-4o-mini',
        base_url: config.daemon?.llm?.base_url || undefined,
      },
      daemon: config.daemon || {},
      memory: config.memory || { provider: 'file' },
    };

    let totalCostUsd = 0;
    const trackingLlmFn = async (cfg, callOpts) => {
      const rawResponse = await completeChat(consolidationConfig, callOpts);
      totalCostUsd += computeCallCost(callOpts, rawResponse);
      return rawResponse;
    };

    const result = await consolidateMemory(consolidationConfig, {
      mm,
      dryRun: Boolean(dry_run),
      passes: passes ?? undefined,
      lookbackHours: lookback_hours != null ? Number(lookback_hours) : undefined,
      llmFn: dry_run ? undefined : trackingLlmFn,
    });

    const pass_id = 'cpass_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

    // Store a pass-level summary event so History shows one row per run.
    if (!dry_run) {
      mm.store('consolidation_pass', {
        topics_count: Array.isArray(result.topics) ? result.topics.length : (result.topics ?? 0),
        total_events: result.total_events,
        cost_usd: totalCostUsd,
        pass_id,
        verify: result.verify ?? null,
        discover: result.discover ?? null,
      });
    }

    return res.json({
      topics: result.topics,
      total_events: result.total_events,
      verify: result.verify ?? null,
      discover: result.discover ?? null,
      cost_usd: totalCostUsd,
      pass_id,
      dry_run: result.dry_run,
    });
  } catch (e) {
    console.error('[hub] POST /api/v1/memory/consolidate', e?.message);
    res.status(500).json({ error: e.message || 'Consolidation failed', code: 'RUNTIME_ERROR' });
  }
});

/**
 * GET /api/v1/memory/consolidate/status
 * Self-hosted: returns daemon config + last consolidation pass from memory log.
 */
app.get('/api/v1/memory/consolidate/status', jwtAuth, async (req, res) => {
  try {
    const { createMemoryManager } = await import('../lib/memory.mjs');
    const vaultId = req.vault_id || 'default';
    const mm = createMemoryManager(config, vaultId);
    const recentPasses = mm.list({ type: 'consolidation_pass', limit: 1 });
    const lastPass = recentPasses.length > 0 ? (recentPasses[0].ts || recentPasses[0].created_at || null) : null;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const allPasses = mm.list({ type: 'consolidation_pass', since: monthStart.toISOString(), limit: 500 });
    return res.json({
      enabled: Boolean(config.daemon?.enabled),
      interval_minutes: config.daemon?.interval_minutes ?? null,
      last_pass: lastPass,
      cost_today_usd: 0,
      cost_cap_usd: config.daemon?.max_cost_per_day_usd ?? null,
      pass_count_month: allPasses.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Status unavailable', code: 'RUNTIME_ERROR' });
  }
});

/**
 * GET /api/v1/memory — list memory events (used by History button).
 * Query: type, since, until, limit (max 100)
 */
app.get('/api/v1/memory', jwtAuth, async (req, res) => {
  try {
    const { createMemoryManager } = await import('../lib/memory.mjs');
    const vaultId = req.vault_id || 'default';
    const mm = createMemoryManager(config, vaultId);
    const events = mm.list({
      type: req.query.type || undefined,
      since: req.query.since || undefined,
      until: req.query.until || undefined,
      limit: Math.min(parseInt(req.query.limit) || 20, 100),
    });
    res.json({ events, count: events.length });
  } catch (e) {
    res.status(500).json({ error: e.message, code: 'RUNTIME_ERROR' });
  }
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
    const beforeMap = loadRoleMap(config.data_dir);
    const current = readRolesObject(config.data_dir);
    const uidKey = userId.trim();
    current[uidKey] = r;
    const actorSub = req.user?.sub ?? '';
    const toWrite = ensureActorAdminOnFirstRolesPopulation(beforeMap.size, current, actorSub);
    writeRolesFile(config.data_dir, toWrite);
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
    res.json({ ok: true, roles: toWrite });
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
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') {
    const isApi = req.path === '/api' || req.path.startsWith('/api/');
    const message = `Request body exceeds Hub JSON limit (${jsonBodyLimit}).`;
    if (isApi) return res.status(413).json({ error: message, code: 'PAYLOAD_TOO_LARGE' });
    return res.status(413).type('text/plain').send(message);
  }
  return next(err);
});
// Disable caching for JS/CSS so the browser always fetches the latest source.
app.use((req, res, next) => {
  if (/\.(mjs|js|css)$/.test(req.path)) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
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
  if (isProduction && roleMap.size === 0) {
    console.warn(
      '\x1b[33m[SECURITY] No roles configured (data/hub_roles.json is empty or missing). ' +
      'All authenticated users currently have admin access. ' +
      'Add at least one role via POST /api/v1/roles before public launch.\x1b[0m'
    );
  }
});
