/**
 * Hosted gateway: bulk delete/rename by effective project slug via canister orchestration.
 * @see docs/HUB-METADATA-BULK-OPS.md
 */

import jwt from 'jsonwebtoken';
import { effectiveProjectSlug, normalizeSlug } from '../../lib/vault.mjs';
import { materializeListFrontmatter } from './note-facets.mjs';
import { applyScopeFilterToNotes } from '../lib/scope-filter.mjs';
import { mergeHostedNoteBodyForCanister } from './apply-note-provenance.mjs';

/**
 * @param {{
 *   CANISTER_URL: string,
 *   BRIDGE_URL: string,
 *   SESSION_SECRET: string,
 *   getUserId: (req: import('express').Request) => string | null,
 *   getHostedAccessContext: (req: import('express').Request) => Promise<Record<string, unknown>|null>,
 * }} deps
 */
export function createMetadataBulkHandlers(deps) {
  const { CANISTER_URL, BRIDGE_URL, SESSION_SECRET, getUserId, getHostedAccessContext } = deps;

  async function resolveRole(req) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    let role = 'member';
    try {
      if (token && SESSION_SECRET) {
        const p = jwt.verify(token, SESSION_SECRET);
        if (p && typeof p === 'object' && p.role) role = String(p.role);
      }
    } catch (_) {
      /* keep default */
    }
    if (BRIDGE_URL && auth) {
      try {
        const r = await fetch(BRIDGE_URL + '/api/v1/role', {
          headers: { Authorization: auth, Accept: 'application/json' },
        });
        if (r.ok) {
          const d = await r.json();
          if (d && d.role) role = String(d.role);
        }
      } catch (_) {
        /* keep JWT role */
      }
    }
    return role;
  }

  function roleAllowsBulk(role) {
    return String(role).toLowerCase() !== 'viewer';
  }

  /**
   * @returns {Promise<{ uid: string, effective: string, vaultId: string, hctx: Record<string, unknown>|null } | { err: { status: number, json: object } }>}
   */
  async function resolveCtx(req) {
    const uid = getUserId(req);
    if (!uid) return { err: { status: 401, json: { error: 'Unauthorized', code: 'UNAUTHORIZED' } } };
    if (!CANISTER_URL) {
      return {
        err: {
          status: 503,
          json: { error: 'Hosted vault (canister) is not configured.', code: 'SERVICE_UNAVAILABLE' },
        },
      };
    }
    const vaultId = String(req.headers['x-vault-id'] || 'default').trim() || 'default';
    const hctx = await getHostedAccessContext(req);
    const effective =
      hctx && typeof hctx.effective_canister_user_id === 'string' && hctx.effective_canister_user_id.trim()
        ? hctx.effective_canister_user_id.trim()
        : uid;
    if (hctx && Array.isArray(hctx.allowed_vault_ids) && !hctx.allowed_vault_ids.includes(vaultId)) {
      return { err: { status: 403, json: { error: 'Access to this vault is not allowed.', code: 'FORBIDDEN' } } };
    }
    return { uid, effective, vaultId, hctx };
  }

  function scopeActive(hctx) {
    const s = hctx && hctx.scope && typeof hctx.scope === 'object' ? hctx.scope : null;
    return Boolean(s && (s.projects?.length || s.folders?.length));
  }

  /**
   * @param {string} uid
   * @param {string} effective
   * @param {string} vaultId
   */
  function readHeaders(uid, effective, vaultId) {
    return {
      Accept: 'application/json',
      'x-user-id': effective,
      'x-actor-id': uid,
      'x-vault-id': vaultId,
    };
  }

  /**
   * @param {string} uid
   * @param {string} effective
   * @param {string} vaultId
   */
  function writeHeaders(uid, effective, vaultId) {
    return {
      ...readHeaders(uid, effective, vaultId),
      'Content-Type': 'application/json',
    };
  }

  /**
   * @param {string} uid
   * @param {string} effective
   * @param {string} vaultId
   */
  async function fetchNotesJson(uid, effective, vaultId) {
    const url = `${CANISTER_URL}/api/v1/notes`;
    const r = await fetch(url, { headers: readHeaders(uid, effective, vaultId) });
    const text = await r.text();
    if (!r.ok) {
      const err = new Error(`canister_notes_http_${r.status}`);
      /** @type {any} */ (err).status = r.status;
      /** @type {any} */ (err).body = text;
      throw err;
    }
    try {
      return text ? JSON.parse(text) : { notes: [] };
    } catch (e) {
      const err = new Error('canister_notes_json');
      /** @type {any} */ (err).cause = e;
      throw err;
    }
  }

  /**
   * @param {Array<{ path?: string, frontmatter?: unknown, body?: string }>} rows
   * @param {string} slug
   * @param {Record<string, unknown>|null} hctx
   */
  function pathsMatchingProjectSlug(rows, slug, hctx) {
    /** @type {{ path: string, project: string|null }[]} */
    let matches = [];
    for (const n of rows) {
      if (!n || typeof n !== 'object' || !n.path) continue;
      const fm = materializeListFrontmatter(n.frontmatter);
      const eff = effectiveProjectSlug(String(n.path), fm);
      if (eff === slug) {
        matches.push({ path: String(n.path).replace(/\\/g, '/'), project: eff ?? null });
      }
    }
    if (hctx && scopeActive(hctx)) {
      const scope = /** @type {{ projects?: string[], folders?: string[] }} */ (hctx.scope);
      matches = applyScopeFilterToNotes(matches, scope);
    }
    return matches.map((m) => m.path);
  }

  /**
   * @param {string} uid
   * @param {string} effective
   * @param {string} vaultId
   * @param {Set<string>} pathSet
   */
  async function discardProposalsForPaths(uid, effective, vaultId, pathSet) {
    if (pathSet.size === 0) return 0;
    const r = await fetch(`${CANISTER_URL}/api/v1/proposals`, {
      headers: readHeaders(uid, effective, vaultId),
    });
    const text = await r.text();
    if (!r.ok) return 0;
    let data;
    try {
      data = text ? JSON.parse(text) : { proposals: [] };
    } catch {
      return 0;
    }
    const proposals = Array.isArray(data.proposals) ? data.proposals : [];
    let discarded = 0;
    for (const p of proposals) {
      if (!p || p.status !== 'proposed' || !p.proposal_id) continue;
      const pv = p.vault_id != null && String(p.vault_id).trim() ? String(p.vault_id).trim() : 'default';
      if (pv !== vaultId) continue;
      const normPath = String(p.path || '').replace(/\\/g, '/');
      if (!pathSet.has(normPath)) continue;
      const dr = await fetch(
        `${CANISTER_URL}/api/v1/proposals/${encodeURIComponent(p.proposal_id)}/discard`,
        {
          method: 'POST',
          headers: writeHeaders(uid, effective, vaultId),
          body: '{}',
        },
      );
      if (dr.ok) discarded += 1;
    }
    return discarded;
  }

  /** @param {import('express').Request} req */
  /** @param {import('express').Response} res */
  async function deleteByProject(req, res) {
    const role = await resolveRole(req);
    if (!roleAllowsBulk(role)) {
      return res.status(403).json({ error: 'This action requires a different role.', code: 'FORBIDDEN' });
    }
    const ctx = await resolveCtx(req);
    if ('err' in ctx) return res.status(ctx.err.status).json(ctx.err.json);
    const { uid, effective, vaultId, hctx } = ctx;

    const raw = req.body && req.body.project != null ? String(req.body.project) : '';
    const slug = normalizeSlug(raw.trim());
    if (!slug) {
      return res.status(400).json({ error: 'project slug required', code: 'BAD_REQUEST' });
    }

    let data;
    try {
      data = await fetchNotesJson(uid, effective, vaultId);
    } catch (e) {
      console.error('[gateway] delete-by-project: fetch notes', e?.message || e);
      return res.status(502).json({ error: 'Could not list notes from vault.', code: 'BAD_GATEWAY' });
    }
    const rows = Array.isArray(data.notes) ? data.notes : [];
    const pathsToDelete = pathsMatchingProjectSlug(rows, slug, hctx);
    const normalizedPaths = pathsToDelete.map((p) => String(p).replace(/\\/g, '/'));

    for (const p of normalizedPaths) {
      const url = `${CANISTER_URL}/api/v1/notes/${encodeURIComponent(p)}`;
      const dr = await fetch(url, {
        method: 'DELETE',
        headers: readHeaders(uid, effective, vaultId),
      });
      if (!dr.ok && dr.status !== 404) {
        console.error('[gateway] delete-by-project: DELETE failed', p, dr.status);
        return res.status(502).json({
          error: 'Could not delete one or more notes on the vault.',
          code: 'BAD_GATEWAY',
          path: p,
        });
      }
    }

    const pathSet = new Set(normalizedPaths);
    let proposals_discarded = 0;
    try {
      proposals_discarded = await discardProposalsForPaths(uid, effective, vaultId, pathSet);
    } catch (e) {
      console.error('[gateway] delete-by-project: proposals', e?.message || e);
    }

    return res.json({
      deleted: normalizedPaths.length,
      paths: normalizedPaths,
      proposals_discarded,
    });
  }

  /** @param {import('express').Request} req */
  /** @param {import('express').Response} res */
  async function renameProject(req, res) {
    const role = await resolveRole(req);
    if (!roleAllowsBulk(role)) {
      return res.status(403).json({ error: 'This action requires a different role.', code: 'FORBIDDEN' });
    }
    const ctx = await resolveCtx(req);
    if ('err' in ctx) return res.status(ctx.err.status).json(ctx.err.json);
    const { uid, effective, vaultId, hctx } = ctx;

    const fromRaw = req.body && req.body.from != null ? String(req.body.from) : '';
    const toRaw = req.body && req.body.to != null ? String(req.body.to) : '';
    const from = normalizeSlug(fromRaw.trim());
    const to = normalizeSlug(toRaw.trim());
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to project slugs required', code: 'BAD_REQUEST' });
    }
    if (from === to) {
      return res.json({ updated: 0, paths: [] });
    }

    let data;
    try {
      data = await fetchNotesJson(uid, effective, vaultId);
    } catch (e) {
      console.error('[gateway] rename-project: fetch notes', e?.message || e);
      return res.status(502).json({ error: 'Could not list notes from vault.', code: 'BAD_GATEWAY' });
    }
    const rows = Array.isArray(data.notes) ? data.notes : [];
    let pathsToUpdate = pathsMatchingProjectSlug(rows, from, hctx);
    pathsToUpdate = [...new Set(pathsToUpdate.map((p) => String(p).replace(/\\/g, '/')))];
    const updatedPaths = [];

    for (const notePath of pathsToUpdate) {
      const row = rows.find((n) => n && n.path && String(n.path).replace(/\\/g, '/') === notePath);
      if (!row) continue;
      const fmPrev = materializeListFrontmatter(row.frontmatter);
      const nextFm = { ...fmPrev, project: to };
      const bodyPayload = mergeHostedNoteBodyForCanister(
        {
          path: notePath,
          body: typeof row.body === 'string' ? row.body : '',
          frontmatter: nextFm,
        },
        uid,
      );
      const pr = await fetch(`${CANISTER_URL}/api/v1/notes`, {
        method: 'POST',
        headers: writeHeaders(uid, effective, vaultId),
        body: JSON.stringify(bodyPayload),
      });
      if (!pr.ok) {
        const t = await pr.text();
        console.error('[gateway] rename-project: POST note failed', notePath, pr.status, t?.slice(0, 200));
        return res.status(502).json({
          error: 'Could not update one or more notes on the vault.',
          code: 'BAD_GATEWAY',
          path: notePath,
        });
      }
      updatedPaths.push(notePath);
    }

    return res.json({ updated: updatedPaths.length, paths: updatedPaths });
  }

  return { deleteByProject, renameProject };
}
