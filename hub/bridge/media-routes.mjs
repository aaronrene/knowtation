/**
 * Hosted bridge REST routes for media write surfaces
 * (SEC-SEAM-MEDIA-b — SM-C3, SM-C4, SM-C6, SM-C7).
 *
 * Gated by MEDIA_EXTERNAL_LINK_ENABLED / MEDIA_ATTACH_ENABLED (both default OFF →
 * 403 MEDIA_*_DISABLED, same refusal codes as self-hosted hub/server.mjs). This
 * module does NOT flip those envs (SM-C10).
 *
 * Role gates mirror self-hosted: writes require editor/admin (MEDIA_WRITE_ROLES);
 * consent list + attachment list/get allow viewer/editor/admin/evaluator.
 *
 * Every mutating route runs inside withMediaBlobSync and every read hydrates the
 * media stores from Blobs first: hosted Netlify lambdas have ephemeral DATA_DIR,
 * so a consent granted on one instance must survive to the propose precheck on
 * another, and an external-ref upsert must be visible to later attachment reads
 * (capture blob-sync parity — SM-C6).
 *
 * media_attach propose uses the SM-C5 temp-stage: GET the canister target note,
 * stage into a per-request temp vaultPath, run the SAME
 * `handleMediaAttachProposeRequest` (note existence + base_state_id checks against
 * the canister-fresh note), and stamp the propose-time `media_pointer` on the
 * proposal via the hosted createProposal wrapper (G22).
 *
 * @see docs/SEC-SEAM-MEDIA-FREEZE.md
 * @see hub/bridge/flow-capture-routes.mjs (pattern sibling)
 */

import {
  handleMediaLinkProposeRequest,
  handleMediaAttachProposeRequest,
  handleMediaImportConsentGrantRequest,
  handleMediaImportConsentListRequest,
  handleMediaImportConsentRevokeRequest,
  resolveMediaPointerForAttach,
} from '../../lib/attachments/attachment-write.mjs';
import {
  handleAttachmentListRequest,
  handleAttachmentGetRequest,
} from '../../lib/attachments/attachment-handlers.mjs';
import {
  createMediaProposalOnCanister,
  applyApprovedMediaProposalFromCanister,
  stageCanisterNoteToTempVault,
  notePathFromRef,
} from '../../lib/attachments/media-hosted-proposal.mjs';
import { withMediaBlobSync, hydrateMediaStoresFromBlob } from './media-blob-store.mjs';
import { isSessionBoundActor } from '../gateway/access-token-authz.mjs';
import { verifyJwtWithSecretRotation } from '../lib/session-secret-rotation.mjs';

/** Self-hosted MEDIA_WRITE_ROLES parity (hub/server.mjs:1325). */
const MEDIA_WRITE_ROLE_SET = new Set(['editor', 'admin']);
/** Self-hosted MEDIA_CONSENT_READ_ROLES / attachment read parity (hub/server.mjs:1326). */
const MEDIA_READ_ROLE_SET = new Set(['viewer', 'editor', 'admin', 'evaluator']);

/**
 * Map bridge role to media handler role (member → editor, matching capture bridge).
 *
 * @param {string} role
 * @returns {string}
 */
export function bridgeMediaHandlerRole(role) {
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
export function registerBridgeMediaRoutes(app, deps) {
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
   * @param {Set<string>} allowedRoles
   */
  async function mediaHandlerContext(req, allowedRoles) {
    const hctx = await resolveHostedBridgeContext(req, req.uid);
    if (!hctx.ok) return hctx;
    const roles = await loadRoles(req.blobStore);
    const role = bridgeMediaHandlerRole(effectiveRole(req.uid, roles));
    if (!allowedRoles.has(role)) {
      return { ok: false, status: 403, error: 'Insufficient role', code: 'FORBIDDEN' };
    }
    return { ok: true, hctx, role };
  }

  /**
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  function sessionBoundFromReq(req) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const secret = process.env.SESSION_SECRET;
    if (!token || !secret) return false;
    const payload = verifyJwtWithSecretRotation(token, secret, process.env.SESSION_SECRET_PREVIOUS);
    return payload ? isSessionBoundActor(payload) : false;
  }

  /**
   * Hosted createProposal for media handlers → canister proposal store (SM-C3).
   *
   * When `stampPointer` is set (media_attach), resolve the attach pointer ONCE at
   * propose time against the staged temp vault and persist it as
   * `media_meta.media_pointer` (+ frontmatter via mergeMediaFrontmatter) so hosted
   * apply never needs a vault-wide walk on the bridge lambda (SM-C5 / G22).
   *
   * @param {{
   *   effectiveCanisterUid: string,
   *   actorUid: string,
   *   vaultId: string,
   *   sessionBound?: boolean,
   *   stampPointer?: { vaultPath: string, vaultConfig: object },
   * }} ctx
   */
  function hostedCreateProposal(ctx) {
    return async function createProposal(_dataDir, input) {
      let mediaMeta = input.media_meta;
      if (ctx.stampPointer && mediaMeta && mediaMeta.proposal_kind === 'media_attach') {
        const pointer = resolveMediaPointerForAttach(
          ctx.stampPointer.vaultPath,
          ctx.stampPointer.vaultConfig,
          String(mediaMeta.attachment_id || ''),
        );
        if (!pointer) {
          const err = new Error('unknown_attachment');
          err.status = 404;
          err.code = 'unknown_attachment';
          throw err;
        }
        mediaMeta = { ...mediaMeta, media_pointer: pointer };
      }
      return createMediaProposalOnCanister({
        canisterUrl,
        sessionBound: ctx.sessionBound === true,
        headers: canisterHeaders({
          'X-User-Id': ctx.effectiveCanisterUid,
          'X-Actor-Id': ctx.actorUid,
          'X-Vault-Id': ctx.vaultId,
        }),
        input: {
          ...input,
          media_meta: mediaMeta,
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
    const e =
      err && typeof err === 'object'
        ? /** @type {{ status?: number, code?: string, message?: string }} */ (err)
        : {};
    const status = typeof e.status === 'number' ? e.status : 500;
    const code = typeof e.code === 'string' ? e.code : 'RUNTIME_ERROR';
    const message = typeof e.message === 'string' ? e.message : String(err);
    return res.status(status).json({ error: message, code });
  }

  app.post('/api/v1/attachments/link-proposals', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_WRITE_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withMediaBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleMediaLinkProposeRequest({
            dataDir,
            vaultPath: dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            body,
            intent: body.intent,
            sessionBound: sessionBoundFromReq(req),
            createProposal: hostedCreateProposal({
              effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
              actorUid: req.uid,
              vaultId: ctx.hctx.vaultId,
              sessionBound: sessionBoundFromReq(req),
            }),
            vaultConfig: {},
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

  app.post('/api/v1/attachments/attach-proposals', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_WRITE_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const noteRef = typeof body.note_ref === 'string' ? body.note_ref.trim() : '';

    // SM-C5 temp-stage: hosted note lives on the canister, so stage it before the
    // shared handler validates note existence / scope / base_state_id. Invalid or
    // missing note_ref stages nothing → the shared handler refuses (unknown_note /
    // MEDIA_DRAFT_INVALID) exactly like self-hosted.
    let staged = null;
    try {
      if (noteRef) {
        staged = await stageCanisterNoteToTempVault({
          canisterUrl,
          headers: canisterHeaders({
            'X-User-Id': ctx.hctx.effectiveCanisterUid,
            'X-Actor-Id': req.uid,
            'X-Vault-Id': ctx.hctx.vaultId,
          }),
          notePath: notePathFromRef(noteRef),
        });
        if ('error' in staged) {
          return res
            .status(staged.error.status)
            .json({ error: staged.error.error, code: staged.error.code });
        }
      }

      const vaultPath = staged ? staged.vaultPath : dataDir;
      const result = await withMediaBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleMediaAttachProposeRequest({
            dataDir,
            vaultPath,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            body,
            intent: body.intent,
            sessionBound: sessionBoundFromReq(req),
            createProposal: hostedCreateProposal({
              effectiveCanisterUid: ctx.hctx.effectiveCanisterUid,
              actorUid: req.uid,
              vaultId: ctx.hctx.vaultId,
              sessionBound: sessionBoundFromReq(req),
              stampPointer: { vaultPath, vaultConfig: {} },
            }),
            vaultConfig: {},
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.status(201).json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    } finally {
      if (staged && typeof staged.cleanup === 'function') staged.cleanup();
    }
  });

  app.post('/api/v1/attachments/import-consents', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_WRITE_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await withMediaBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleMediaImportConsentGrantRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            body,
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

  app.get('/api/v1/attachments/import-consents', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_READ_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    try {
      await hydrateMediaStoresFromBlob(req.blobStore ?? null, dataDir);
      const result = handleMediaImportConsentListRequest({
        dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  app.delete('/api/v1/attachments/import-consents/:id', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_WRITE_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const consentId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    try {
      const result = await withMediaBlobSync({
        blobStore: req.blobStore ?? null,
        dataDir,
        run: () =>
          handleMediaImportConsentRevokeRequest({
            dataDir,
            vaultId: ctx.hctx.vaultId,
            userId: req.uid,
            role: ctx.role,
            consentId,
          }),
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  // Hub-complete media apply (SM-C4). Called by the gateway post-approve hook; also
  // re-callable by ops after fixing store state while the proposal is still
  // `approved` (SM-C12 recovery). withMediaBlobSync hydrates the connector/consent/
  // external-ref stores before the shared precheck and persists after apply.
  app.post(
    '/api/v1/attachments/proposals/:proposal_id/apply-approved',
    requireBridgeAuth,
    async (req, res) => {
      const hctx = await resolveHostedBridgeContext(req, req.uid);
      if (!hctx.ok) return res.status(hctx.status).json({ error: hctx.error, code: hctx.code });

      const proposalId =
        typeof req.params.proposal_id === 'string'
          ? decodeURIComponent(req.params.proposal_id).trim()
          : '';
      if (!proposalId) {
        return res.status(400).json({ error: 'proposal_id required', code: 'BAD_REQUEST' });
      }

      try {
        const result = await withMediaBlobSync({
          blobStore: req.blobStore ?? null,
          dataDir,
          run: () =>
            applyApprovedMediaProposalFromCanister({
              dataDir,
              canisterUrl,
              headers: canisterHeaders({
                'X-User-Id': hctx.effectiveCanisterUid,
                'X-Actor-Id': req.uid,
                'X-Vault-Id': hctx.vaultId,
              }),
              proposalId,
              requireApproved: true,
              vaultId: hctx.vaultId,
            }),
        });
        if (!result.ok) {
          return res.status(result.status).json({ error: result.error, code: result.code });
        }
        return res.json(result.payload);
      } catch (err) {
        return sendRouteError(res, err);
      }
    },
  );

  // Hosted attachment list/get exposure (SM-C7) — same handlers as self-hosted so
  // connector_ref rows from external-link apply are visible to Scooling hosted
  // reads. vaultPath = dataDir: no vault filesystem on the bridge, so derivation
  // covers external-ref (connector_ref) rows; vault-file/mist rows are self-hosted.
  app.get('/api/v1/attachments', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_READ_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const limitRaw = req.query.limit != null ? parseInt(String(req.query.limit), 10) : undefined;
    try {
      await hydrateMediaStoresFromBlob(req.blobStore ?? null, dataDir);
      const result = handleAttachmentListRequest({
        dataDir,
        vaultPath: dataDir,
        vaultId: ctx.hctx.vaultId,
        userId: req.uid,
        role: ctx.role,
        scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
        note_ref: typeof req.query.note_ref === 'string' ? req.query.note_ref : undefined,
        source: typeof req.query.source === 'string' ? req.query.source : undefined,
        mime_class: typeof req.query.mime_class === 'string' ? req.query.mime_class : undefined,
        storage_kind:
          typeof req.query.storage_kind === 'string' ? req.query.storage_kind : undefined,
        agent_visible: req.query.agent_visible === 'true',
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
        hubScope: null,
        vaultConfig: {},
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });

  // MUST stay registered after GET /api/v1/attachments/import-consents (above) so
  // 'import-consents' is never treated as an attachment id — static-path ordering
  // (SM-C7, capture CHA-C5 parity).
  app.get('/api/v1/attachments/:id', requireBridgeAuth, async (req, res) => {
    const ctx = await mediaHandlerContext(req, MEDIA_READ_ROLE_SET);
    if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error, code: ctx.code });

    const attachmentId =
      typeof req.params.id === 'string' ? decodeURIComponent(req.params.id).trim() : '';
    try {
      await hydrateMediaStoresFromBlob(req.blobStore ?? null, dataDir);
      const result = handleAttachmentGetRequest({
        dataDir,
        vaultPath: dataDir,
        vaultId: ctx.hctx.vaultId,
        attachmentId,
        userId: req.uid,
        role: ctx.role,
        hubScope: null,
        vaultConfig: {},
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json(result.payload);
    } catch (err) {
      return sendRouteError(res, err);
    }
  });
}
