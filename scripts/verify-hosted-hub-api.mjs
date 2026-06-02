#!/usr/bin/env node
/**
 * Hosted Hub API probe: list notes, report empty frontmatter, optional GET one path.
 * Use after sign-in: copy JWT from localStorage hub_token (DevTools → Application).
 *
 * Usage:
 *   KNOWTATION_HUB_TOKEN='<jwt>' node scripts/verify-hosted-hub-api.mjs
 *   KNOWTATION_HUB_TOKEN_FILE=~/.config/knowtation/hub_jwt.txt node scripts/verify-hosted-hub-api.mjs
 *
 * Full investigation (A1 + default detail path + A2 write probe):
 *   KNOWTATION_HUB_INVESTIGATE=1 KNOWTATION_HUB_TOKEN='...' node scripts/verify-hosted-hub-api.mjs
 *
 * Repo deploy snapshot only (no JWT; Phase B facts from git + canister_ids.json + live /health):
 *   KNOWTATION_HUB_SNAPSHOT_ONLY=1 node scripts/verify-hosted-hub-api.mjs
 *
 * Loads optional `KNOWTATION_HUB_TOKEN` / `HUB_JWT` from repo-root `.env` (dotenv) when present.
 *
 * Optional write probe (creates/overwrites a probe note — use a throwaway path):
 *   KNOWTATION_HUB_PROBE_PATH='inbox/.hub-probe-delete-me.md' KNOWTATION_HUB_DO_PROBE=1 \
 *     KNOWTATION_HUB_TOKEN='...' node scripts/verify-hosted-hub-api.mjs
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { materializeListFrontmatter, deriveFacetsFromCanisterNotes } from '../hub/gateway/note-facets.mjs';

function probeDetailPathFromNotes(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const prefer = list.find((n) => n.path === 'inbox/note-hello-world.md');
  const nonProbe = list.filter((n) => !String(n.path || '').includes('.hub-probe-delete-me'));
  return prefer?.path || nonProbe[0]?.path || list[0]?.path || '';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

function resolveToken() {
  let t = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_JWT || '';
  const fp = (process.env.KNOWTATION_HUB_TOKEN_FILE || '').trim();
  if (!t && fp) {
    const expanded = fp.startsWith('~') ? path.join(process.env.HOME || '', fp.slice(1)) : fp;
    try {
      t = fs.readFileSync(expanded, 'utf8').trim();
    } catch (e) {
      console.error('KNOWTATION_HUB_TOKEN_FILE read failed:', expanded, e.message);
      process.exit(1);
    }
  }
  return t;
}

const token = resolveToken();
const apiBase = (process.env.KNOWTATION_HUB_API || 'https://knowtation-gateway.netlify.app').replace(/\/$/, '');
const vaultId = process.env.KNOWTATION_HUB_VAULT_ID || 'default';
const envNotePath = (process.env.KNOWTATION_HUB_NOTE_PATH || '').trim();
let probePath = (process.env.KNOWTATION_HUB_PROBE_PATH || '').trim();
let doProbe = process.env.KNOWTATION_HUB_DO_PROBE === '1' || process.env.KNOWTATION_HUB_DO_PROBE === 'true';
const investigate = process.env.KNOWTATION_HUB_INVESTIGATE === '1' || process.env.KNOWTATION_HUB_INVESTIGATE === 'true';
const snapshotOnly = process.env.KNOWTATION_HUB_SNAPSHOT_ONLY === '1' || process.env.KNOWTATION_HUB_SNAPSHOT_ONLY === 'true';

function headers() {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Vault-Id': vaultId };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

async function httpHealth(url, label) {
  try {
    const r = await fetch(url, { method: 'GET' });
    return { label, url, status: r.status, ok: r.ok };
  } catch (e) {
    return { label, url, status: null, ok: false, error: e.message };
  }
}

function printDeploySnapshot() {
  console.log('--- Phase B: deploy alignment snapshot (verify against Netlify + ICP dashboards) ---');
  const idsPath = path.join(repoRoot, 'hub', 'icp', 'canister_ids.json');
  let canisterId = '(missing canister_ids.json)';
  try {
    const j = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    canisterId = j?.hub?.ic || canisterId;
  } catch {
    /* ignore */
  }
  console.log('repo hub/icp/canister_ids.json hub.ic:', canisterId);
  if (!String(canisterId).startsWith('(')) {
    console.log('docs expect CANISTER_URL (raw):', `https://${canisterId}.raw.icp0.io`);
  }
  console.log('Motoko extractFrontmatterFromPostBody: see git log hub/icp/src/hub/main.mo (e.g. fad98ec, 7e55a25)');
  try {
    const head = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
    console.log('repo git HEAD', head);
  } catch {
    /* not a git checkout */
  }
  const localWasm = path.join(repoRoot, 'hub', 'icp', '.dfx', 'local', 'canisters', 'hub', 'hub.wasm');
  try {
    if (fs.existsSync(localWasm)) {
      const buf = fs.readFileSync(localWasm);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      console.log('local hub.wasm sha256 (if built):', sha);
      console.log('compare to Internet Computer dashboard module hash for canister', canisterId);
    } else {
      console.log('local hub.wasm: (not built) run: cd hub/icp && dfx build hub');
    }
  } catch {
    /* ignore */
  }
  return canisterId;
}

/**
 * @param {{ token?: string, apiBase?: string, vaultId?: string, notePath?: string, probePath?: string, doProbe?: boolean, autoDetailPath?: boolean }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runHostedHubVerification(opts = {}) {
  const base = (opts.apiBase || apiBase).replace(/\/$/, '');
  const vid = opts.vaultId || vaultId;
  const tok = opts.token ?? token;
  const h = () => {
    const out = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Vault-Id': vid };
    if (tok) out.Authorization = 'Bearer ' + tok;
    return out;
  };

  /** @type {Record<string, unknown>} */
  const report = {
    apiBase: base,
    vaultId: vid,
    list_status: null,
    empty_frontmatter_count: null,
    notes_length: null,
    facets_status: null,
    gateway_facets_tag_count: null,
    detail_path: null,
    detail_status: null,
    detail_fm_key_count: null,
    probe_post_status: null,
    probe_get_status: null,
    after_probe_fm_key_count: null,
    interpretation: null,
  };

  const listUrl = `${base}/api/v1/notes?limit=200&offset=0`;
  const listRes = await fetch(listUrl, { headers: h() });
  const listText = await listRes.text();
  report.list_status = listRes.status;
  console.log('GET /api/v1/notes', listRes.status, listRes.ok ? 'ok' : 'FAIL');
  if (!listRes.ok) {
    console.log(listText.slice(0, 500));
    report.interpretation = 'list_failed';
    return report;
  }
  let data;
  try {
    data = JSON.parse(listText);
  } catch (e) {
    console.error('List response is not JSON:', e.message);
    console.log(listText.slice(0, 400));
    report.interpretation = 'list_not_json';
    return report;
  }
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const total = data.total ?? notes.length;
  report.notes_length = notes.length;
  console.log('notes.length', notes.length, 'total', total);

  let emptyFm = 0;
  let sampleNonEmpty = 0;
  for (const n of notes) {
    const fm = materializeListFrontmatter(n.frontmatter);
    const keys = Object.keys(fm);
    if (keys.length === 0) emptyFm += 1;
    else if (sampleNonEmpty < 2) {
      sampleNonEmpty += 1;
      console.log('sample path', n.path, 'fm keys', keys.slice(0, 12).join(', '));
    }
  }
  report.empty_frontmatter_count = emptyFm;
  console.log('empty_frontmatter_count', emptyFm, '/', notes.length);
  const derived = deriveFacetsFromCanisterNotes(notes);
  console.log('derived facets projects', derived.projects.length, 'tags', derived.tags.length, 'folders', derived.folders.length);
  if (derived.tags.length) console.log('tags sample', derived.tags.slice(0, 8).join(', '));

  const facetsRes = await fetch(`${base}/api/v1/notes/facets`, { headers: h() });
  const facetsText = await facetsRes.text();
  report.facets_status = facetsRes.status;
  console.log('GET /api/v1/notes/facets', facetsRes.status, facetsRes.ok ? 'ok' : 'FAIL');
  if (facetsRes.ok) {
    try {
      const f = JSON.parse(facetsText);
      report.gateway_facets_tag_count = (f.tags || []).length;
      console.log('gateway facets tags', (f.tags || []).length, 'projects', (f.projects || []).length);
    } catch {
      console.log(facetsText.slice(0, 200));
    }
  } else {
    console.log(facetsText.slice(0, 300));
  }

  let pathForDetail =
    opts.notePath != null && String(opts.notePath).trim() !== '' ? String(opts.notePath).trim() : '';
  if (!pathForDetail && notes.length && opts.autoDetailPath) {
    pathForDetail = probeDetailPathFromNotes(notes);
  }

  if (pathForDetail) {
    report.detail_path = pathForDetail;
    const enc = encodeURIComponent(pathForDetail);
    const oneUrl = `${base}/api/v1/notes/${enc}`;
    const oneRes = await fetch(oneUrl, { headers: h() });
    const oneText = await oneRes.text();
    report.detail_status = oneRes.status;
    console.log('GET /api/v1/notes/' + pathForDetail, oneRes.status, oneRes.ok ? 'ok' : 'FAIL');
    if (oneRes.ok) {
      try {
        const note = JSON.parse(oneText);
        const raw = typeof note.frontmatter === 'string' ? note.frontmatter : JSON.stringify(note.frontmatter);
        let fm = materializeListFrontmatter(note.frontmatter);
        if (typeof note.frontmatter === 'string' && Object.keys(fm).length === 0 && raw.trim().length > 2) {
          try {
            JSON.parse(raw.replace(/^\uFEFF/, '').trim());
          } catch (e) {
            console.log('detail frontmatter JSON.parse error:', e && e.message ? e.message : String(e));
            console.log('detail frontmatter first_80_codepoints', [...raw.slice(0, 80)].map((c) => c.charCodeAt(0)).join(','));
          }
        }
        report.detail_fm_key_count = Object.keys(fm).length;
        console.log('detail frontmatter keys', Object.keys(fm).join(', ') || '(none)');
        console.log('detail frontmatter raw length', raw.length, 'preview', raw.slice(0, 160).replace(/\n/g, ' '));
      } catch {
        console.log(oneText.slice(0, 400));
      }
    } else {
      console.log(oneText.slice(0, 300));
    }
  }

  const runProbe = opts.doProbe !== undefined ? opts.doProbe : doProbe;
  const pPath = (opts.probePath != null && String(opts.probePath).trim() !== '' ? String(opts.probePath).trim() : probePath);
  if (runProbe && pPath) {
    const body = JSON.stringify({
      path: pPath,
      body: '# probe\n',
      frontmatter: JSON.stringify({ title: 'Hub probe', tags: 'probe-tag', date: new Date().toISOString().slice(0, 10) }),
    });
    const postRes = await fetch(`${base}/api/v1/notes`, {
      method: 'POST',
      headers: h(),
      body,
    });
    const postText = await postRes.text();
    report.probe_post_status = postRes.status;
    console.log('POST /api/v1/notes (probe)', postRes.status, postText.slice(0, 200));
    const enc = encodeURIComponent(pPath);
    const verify = await fetch(`${base}/api/v1/notes/${enc}`, { headers: h() });
    const verifyText = await verify.text();
    report.probe_get_status = verify.status;
    console.log('GET after probe', verify.status);
    if (verify.ok) {
      const note = JSON.parse(verifyText);
      const fm = materializeListFrontmatter(note.frontmatter);
      report.after_probe_fm_key_count = Object.keys(fm).length;
      console.log('after_probe frontmatter keys', Object.keys(fm).join(', ') || '(none)');
    }
  }

  if (report.after_probe_fm_key_count != null) {
    if (report.after_probe_fm_key_count > 0) report.interpretation = 'write_path_ok_legacy_data_likely';
    else report.interpretation = 'write_path_broken_or_empty_probe_response';
  } else if (report.list_status === 200 && report.detail_fm_key_count != null) {
    report.interpretation =
      report.detail_fm_key_count === 0 && report.empty_frontmatter_count === report.notes_length
        ? 'all_notes_empty_fm_check_canister_deploy_and_post_path'
        : 'mixed_or_partial_metadata';
  }

  return report;
}

async function main() {
  if (snapshotOnly) {
    const cid = printDeploySnapshot();
    const g = await httpHealth(`${apiBase}/health`, 'gateway');
    const rawUrl =
      cid && !String(cid).startsWith('(')
        ? `https://${cid}.raw.icp0.io/health`
        : 'https://rsovz-byaaa-aaaaa-qgira-cai.raw.icp0.io/health';
    const c = await httpHealth(rawUrl, 'canister_raw');
    console.log('live_checks', JSON.stringify({ gateway: g, canister_raw: c }));
    process.exit(0);
  }

  if (!token) {
    console.error('Set KNOWTATION_HUB_TOKEN (or HUB_JWT) or KNOWTATION_HUB_TOKEN_FILE to your Hub JWT from localStorage hub_token.');
    console.error('Or run KNOWTATION_HUB_SNAPSHOT_ONLY=1 for Phase B repo + health snapshot without auth.');
    process.exit(1);
  }

  if (investigate) {
    if (!probePath) probePath = 'inbox/.hub-probe-delete-me.md';
    if (!doProbe) doProbe = true;
  }

  const report = await runHostedHubVerification({
    notePath: envNotePath || undefined,
    probePath,
    doProbe,
    autoDetailPath: investigate,
  });

  if (investigate) {
    console.log('__INVESTIGATION_JSON__', JSON.stringify(report));
  }

  if (report.list_status !== 200) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
