/**
 * Knowtation Hub Bridge — Connect GitHub + Back up now + indexer + search for hosted product.
 * Stores GitHub token per user; sync fetches vault from canister and pushes to repo.
 * Index/search: pull vault from canister, chunk → embed → sqlite-vec per user; search via POST /api/v1/search.
 * On Netlify, tokens and vector DBs persist via Netlify Blobs (set by netlify/functions/bridge.mjs).
 * Env: SESSION_SECRET, CANISTER_URL, HUB_BASE_URL; optional GITHUB_*, EMBEDDING_*, BRIDGE_PORT, DATA_DIR.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';

// When Netlify bundles as CJS, import.meta.url is empty; fallback so the app loads and routes register.
let projectRoot;
if (typeof import.meta !== 'undefined' && import.meta.url) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} else {
  projectRoot = process.cwd();
}
const __dirname = path.join(projectRoot, 'hub', 'bridge');
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const PORT = parseInt(process.env.BRIDGE_PORT || process.env.PORT || '3341', 10);
const BASE_URL = (process.env.HUB_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CANISTER_URL = (process.env.CANISTER_URL || '').replace(/\/$/, '');
const HUB_UI_ORIGIN = (process.env.HUB_UI_ORIGIN || BASE_URL).replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.HUB_JWT_SECRET;
const DATA_DIR = process.env.DATA_DIR
  ? (path.isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : path.join(projectRoot, process.env.DATA_DIR))
  : path.join(projectRoot, 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'hub_github_tokens.json');

function sanitizeUserId(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default';
}

function getBridgeEmbeddingConfig() {
  const provider = (process.env.EMBEDDING_PROVIDER || 'ollama').toLowerCase();
  const model = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
  return {
    provider,
    model,
    ollama_url: process.env.OLLAMA_URL || 'http://localhost:11434',
  };
}

const DB_FILENAME = 'knowtation_vectors.db';

function getBridgeStoreConfig(uid, vectorsDirOverride) {
  const vectorsDir = vectorsDirOverride ?? (() => {
    const d = path.join(DATA_DIR, 'vectors', sanitizeUserId(uid));
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  })();
  return {
    vector_store: 'sqlite-vec',
    data_dir: vectorsDir,
    embedding: getBridgeEmbeddingConfig(),
  };
}

const isServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
function encrypt(text, secret) {
  const key = crypto.scryptSync(secret, 'salt', 32);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64url') + '.' + tag.toString('base64url') + '.' + enc.toString('base64url');
}
function decrypt(encrypted, secret) {
  const [ivB, tagB, encB] = encrypted.split('.');
  if (!ivB || !tagB || !encB) return null;
  const key = crypto.scryptSync(secret, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return decipher.update(Buffer.from(encB, 'base64url')) + decipher.final('utf8');
}

async function loadTokens(blobStore) {
  if (!blobStore) {
    ensureDataDir();
    if (!fs.existsSync(TOKENS_FILE)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
      const out = {};
      for (const [uid, v] of Object.entries(raw)) {
        if (v && typeof v.token === 'string') {
          const t = decrypt(v.token, SESSION_SECRET);
          if (t) out[uid] = { token: t, repo: v.repo || null };
        }
      }
      return out;
    } catch (_) {
      return {};
    }
  }
  try {
    const rawStr = await blobStore.get('hub_github_tokens');
    if (!rawStr) return {};
    const raw = JSON.parse(rawStr);
    const out = {};
    for (const [uid, v] of Object.entries(raw)) {
      if (v && typeof v.token === 'string') {
        const t = decrypt(v.token, SESSION_SECRET);
        if (t) out[uid] = { token: t, repo: v.repo || null };
      }
    }
    return out;
  } catch (_) {
    return {};
  }
}

async function saveTokens(blobStore, tokens) {
  const toWrite = {};
  for (const [uid, v] of Object.entries(tokens)) {
    toWrite[uid] = { token: encrypt(v.token, SESSION_SECRET), repo: v.repo || null };
  }
  const str = JSON.stringify(toWrite, null, 2);
  if (!blobStore) {
    ensureDataDir();
    fs.writeFileSync(TOKENS_FILE, str, 'utf8');
    return;
  }
  await blobStore.set('hub_github_tokens', str);
}

/** Return a directory path that contains (or will contain) knowtation_vectors.db for this user. Rehydrates from Blob if needed. */
async function getVectorsDirForUser(req, uid) {
  const safeUid = sanitizeUserId(uid);
  if (!req.blobStore) {
    const d = path.join(DATA_DIR, 'vectors', safeUid);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }
  const dir = path.join(os.tmpdir(), 'knowtation-bridge-vectors', safeUid);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const key = 'vectors/' + safeUid;
  try {
    const data = await req.blobStore.get(key, { type: 'arrayBuffer' });
    if (data && data.byteLength > 0) {
      fs.writeFileSync(path.join(dir, DB_FILENAME), Buffer.from(data));
    }
  } catch (_) {
    // No existing blob or read error; start fresh
  }
  return dir;
}

/** Persist user's vector DB from disk to Blob (call after index). */
async function persistVectorsToBlob(req, uid, vectorsDir) {
  if (!req.blobStore) return;
  const dbPath = path.join(vectorsDir, DB_FILENAME);
  if (!fs.existsSync(dbPath)) return;
  const key = 'vectors/' + sanitizeUserId(uid);
  const buf = fs.readFileSync(dbPath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await req.blobStore.set(key, arrayBuffer);
}

function signState(payload) {
  const payloadStr = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('hex');
  return Buffer.from(payloadStr).toString('base64url') + '.' + sig;
}

function verifyState(stateStr, maxAgeMs = 600000) {
  if (!stateStr || typeof stateStr !== 'string') return null;
  const [b64, sig] = stateStr.split('.');
  if (!b64 || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(JSON.stringify(payload)).digest('hex');
    if (expected !== sig) return null;
    if (Date.now() - (payload.ts || 0) > maxAgeMs) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function userIdFromJwt(token) {
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    return payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  req.blobStore = globalThis.__netlify_blob_store || null;
  next();
});

app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.HUB_CORS_ORIGIN || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Credentials', 'true');
  next();
});

// ——— Connect GitHub ———
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  app.get('/auth/github-connect', (req, res) => {
    const token = req.query.token || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') && req.headers.authorization.slice(7));
    const uid = token ? userIdFromJwt(token) : null;
    if (!uid) {
      return res.redirect(HUB_UI_ORIGIN + '/?github_connect_error=not_authenticated');
    }
    const state = signState({ uid, ts: Date.now() });
    const redirectUri = BASE_URL + '/auth/callback/github-connect';
    const url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(process.env.GITHUB_CLIENT_ID)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&scope=repo'
      + '&state=' + encodeURIComponent(state);
    res.redirect(url);
  });

  app.get('/auth/callback/github-connect', async (req, res) => {
    const { code, state } = req.query || {};
    const baseRedirect = HUB_UI_ORIGIN + '/?github_connect=';
    const payload = verifyState(state);
    if (!payload) {
      return res.redirect(baseRedirect + 'error_state');
    }
    if (!code) {
      return res.redirect(baseRedirect + 'error_code');
    }
    const uid = payload.uid;
    const redirectUri = BASE_URL + '/auth/callback/github-connect';
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await tokenRes.json();
    if (!data.access_token) {
      return res.redirect(baseRedirect + 'error_token');
    }
    const tokensByUser = await loadTokens(req.blobStore);
    tokensByUser[uid] = { token: data.access_token, repo: tokensByUser[uid]?.repo || null };
    await saveTokens(req.blobStore, tokensByUser);
    res.redirect(baseRedirect + 'ok');
  });
}

// ——— Back up now: fetch vault from canister, push to GitHub ———
app.post('/api/v1/vault/sync', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const tokensByUser = await loadTokens(req.blobStore);
  const conn = tokensByUser[uid];
  const repo = req.body?.repo || conn?.repo;
  if (!conn?.token) {
    return res.status(400).json({ error: 'GitHub not connected', code: 'GITHUB_NOT_CONNECTED' });
  }
  if (!repo || typeof repo !== 'string') {
    return res.status(400).json({ error: 'Repo required', code: 'REPO_REQUIRED', hint: 'Send { "repo": "owner/name" } or set repo after connecting GitHub.' });
  }

  const [owner, name] = repo.split('/').filter(Boolean);
  if (!owner || !name) {
    return res.status(400).json({ error: 'Invalid repo format', code: 'BAD_REQUEST' });
  }

  // Fetch vault from canister (export)
  let exportRes;
  try {
    exportRes = await fetch(CANISTER_URL + '/api/v1/export', {
      method: 'GET',
      headers: { 'X-User-Id': uid, 'Accept': 'application/json' },
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach canister', code: 'BAD_GATEWAY' });
  }
  if (!exportRes.ok) {
    return res.status(502).json({ error: 'Canister error', code: 'BAD_GATEWAY', status: exportRes.status });
  }
  let vault;
  try {
    vault = await exportRes.json();
  } catch (_) {
    return res.status(502).json({ error: 'Invalid canister response', code: 'BAD_GATEWAY' });
  }
  const notes = vault.notes || [];

  // Store repo for next time
  if (req.body?.repo && (!conn.repo || conn.repo !== repo)) {
    tokensByUser[uid] = { ...conn, repo };
    await saveTokens(req.blobStore, tokensByUser);
  }

  // Push to GitHub: get default branch, create blobs, create tree, commit, push
  const ghToken = conn.token;
  const headers = {
    Authorization: 'token ' + ghToken,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  let defaultBranch;
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        return res.status(400).json({ error: 'Repo not found or no access', code: 'REPO_NOT_FOUND' });
      }
      throw new Error('GitHub API ' + repoRes.status);
    }
    const repoData = await repoRes.json();
    defaultBranch = repoData.default_branch || 'main';
  } catch (e) {
    return res.status(502).json({ error: 'GitHub API error', code: 'BAD_GATEWAY' });
  }

  const refRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/refs/heads/${defaultBranch}`, { headers });
  if (!refRes.ok) {
    return res.status(502).json({ error: 'Could not get branch', code: 'BAD_GATEWAY' });
  }
  const refData = await refRes.json();
  const baseSha = refData.object?.sha;
  if (!baseSha) {
    return res.status(502).json({ error: 'Invalid ref response', code: 'BAD_GATEWAY' });
  }

  const baseTreeRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/commits/${baseSha}`, { headers });
  if (!baseTreeRes.ok) {
    return res.status(502).json({ error: 'Could not get base commit', code: 'BAD_GATEWAY' });
  }
  const baseCommit = await baseTreeRes.json();
  const baseTreeSha = baseCommit.tree?.sha;

  const tree = [];
  for (const note of notes) {
    const path = note.path || 'note.md';
    const content = (note.frontmatter && note.frontmatter !== '{}' ? '---\n' + note.frontmatter + '\n---\n\n' : '') + (note.body || '');
    const blobRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' }),
    });
    if (!blobRes.ok) {
      return res.status(502).json({ error: 'GitHub blob failed', code: 'BAD_GATEWAY' });
    }
    const blob = await blobRes.json();
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!treeRes.ok) {
    return res.status(502).json({ error: 'GitHub tree failed', code: 'BAD_GATEWAY' });
  }
  const newTree = await treeRes.json();

  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: 'Knowtation Hub backup ' + new Date().toISOString(),
      tree: newTree.sha,
      parents: [baseSha],
    }),
  });
  if (!commitRes.ok) {
    return res.status(502).json({ error: 'GitHub commit failed', code: 'BAD_GATEWAY' });
  }
  const newCommit = await commitRes.json();

  const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/refs/heads/${defaultBranch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (!updateRefRes.ok) {
    return res.status(502).json({ error: 'GitHub push failed', code: 'BAD_GATEWAY' });
  }

  res.json({ ok: true, message: 'Synced', notesCount: notes.length });
});

// Optional: GET status for Settings (connected + repo)
app.get('/api/v1/vault/github-status', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const tokensByUser = await loadTokens(req.blobStore);
  const conn = tokensByUser[uid];
  res.json({
    github_connected: Boolean(conn?.token),
    repo: conn?.repo || null,
  });
});

// ——— Index + Search (hosted: indexer runs in bridge, canister does not run Node) ———
const BATCH_EMBED = 10;
const BATCH_UPSERT = 50;

app.post('/api/v1/index', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  let exportRes;
  try {
    exportRes = await fetch(CANISTER_URL + '/api/v1/export', {
      method: 'GET',
      headers: { 'X-User-Id': uid, Accept: 'application/json' },
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach canister', code: 'BAD_GATEWAY' });
  }
  if (!exportRes.ok) {
    return res.status(502).json({ error: 'Canister export failed', code: 'BAD_GATEWAY', status: exportRes.status });
  }
  let vault;
  try {
    vault = await exportRes.json();
  } catch (_) {
    return res.status(502).json({ error: 'Invalid canister response', code: 'BAD_GATEWAY' });
  }
  const notes = vault.notes || [];
  try {
    const { chunkNote } = await import('../../lib/chunk.mjs');
    const { embed, embeddingDimension } = await import('../../lib/embedding.mjs');
    const { createVectorStore } = await import('../../lib/vector-store.mjs');

    const vectorsDir = await getVectorsDirForUser(req, uid);
    const storeConfig = getBridgeStoreConfig(uid, vectorsDir);
    const chunkOpts = {
      chunkSize: parseInt(process.env.INDEXER_CHUNK_SIZE || '2048', 10),
      chunkOverlap: parseInt(process.env.INDEXER_CHUNK_OVERLAP || '256', 10),
    };
    const allChunks = [];
    for (const n of notes) {
      const note = {
        body: n.body || '',
        path: n.path || 'note.md',
        project: undefined,
        tags: [],
        date: undefined,
      };
      const chunks = chunkNote(note, chunkOpts);
      for (const c of chunks) allChunks.push(c);
    }
    if (allChunks.length === 0) {
      const store = await createVectorStore(storeConfig);
      const dim = embeddingDimension(storeConfig.embedding);
      await store.ensureCollection(dim);
      return res.json({ ok: true, notesProcessed: notes.length, chunksIndexed: 0 });
    }
    const embeddingConfig = storeConfig.embedding;
    const vectors = [];
    for (let i = 0; i < allChunks.length; i += BATCH_EMBED) {
      const batch = allChunks.slice(i, i + BATCH_EMBED);
      const texts = batch.map((c) => c.text);
      const batchVectors = await embed(texts, embeddingConfig);
      for (let j = 0; j < batch.length; j++) {
        vectors.push(batchVectors[j] || []);
      }
    }
    const dim = embeddingDimension(embeddingConfig);
    const store = await createVectorStore(storeConfig);
    await store.ensureCollection(dim);
    for (let i = 0; i < allChunks.length; i += BATCH_UPSERT) {
      const batch = allChunks.slice(i, i + BATCH_UPSERT);
      const points = batch.map((chunk, j) => ({
        id: chunk.id,
        vector: vectors[i + j] || [],
        text: chunk.text,
        path: chunk.path,
        project: chunk.project,
        tags: chunk.tags,
        date: chunk.date,
        causal_chain_id: chunk.causal_chain_id,
        entity: chunk.entity,
        episode_id: chunk.episode_id,
      }));
      await store.upsert(points);
    }
    await persistVectorsToBlob(req, uid, vectorsDir);
    return res.json({ ok: true, notesProcessed: notes.length, chunksIndexed: allChunks.length });
  } catch (e) {
    console.error('Bridge index error:', e);
    return res.status(500).json({ error: 'Index failed', code: 'INTERNAL_ERROR', message: e.message });
  }
});

function truncateSnippet(text, maxChars = 300) {
  if (text == null || typeof text !== 'string') return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > maxChars / 2 ? slice.slice(0, lastSpace) : slice) + '…';
}

app.post('/api/v1/search', async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const uid = token ? userIdFromJwt(token) : null;
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const query = req.body?.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query required', code: 'BAD_REQUEST' });
  }
  const limit = Math.max(1, Math.min(parseInt(req.body?.limit, 10) || 20, 100));
  const snippetChars = parseInt(req.body?.snippetChars, 10) || 300;
  try {
    const { embed } = await import('../../lib/embedding.mjs');
    const { createVectorStore } = await import('../../lib/vector-store.mjs');

    const vectorsDir = await getVectorsDirForUser(req, uid);
    const storeConfig = getBridgeStoreConfig(uid, vectorsDir);
    const store = await createVectorStore(storeConfig);
    const [queryVector] = await embed([query], storeConfig.embedding);
    if (!queryVector) {
      return res.status(500).json({ error: 'Embedding failed', code: 'INTERNAL_ERROR' });
    }
    const hits = await store.search(queryVector, {
      limit,
      project: req.body?.project,
      tag: req.body?.tag,
      folder: req.body?.folder,
      since: req.body?.since,
      until: req.body?.until,
      order: req.body?.order,
      chain: req.body?.chain,
      entity: req.body?.entity,
      episode: req.body?.episode,
    });
    const results = (hits || []).map((h) => ({
      path: h.path,
      score: h.score,
      project: h.project ?? null,
      tags: h.tags ?? [],
      snippet: truncateSnippet(h.text, snippetChars),
    }));
    return res.json({ results, query });
  } catch (e) {
    console.error('Bridge search error:', e);
    return res.status(500).json({ error: 'Search failed', code: 'INTERNAL_ERROR', message: e.message });
  }
});

if (!isServerless) {
  if (!CANISTER_URL || !SESSION_SECRET) {
    console.error('Bridge: CANISTER_URL and SESSION_SECRET (or HUB_JWT_SECRET) are required');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log('Knowtation Hub Bridge listening on http://localhost:' + PORT);
    console.log('  Canister: ' + CANISTER_URL);
    console.log('  GitHub connect: ' + (process.env.GITHUB_CLIENT_ID ? 'enabled' : 'not configured'));
    console.log('  Index/Search: ' + (process.env.EMBEDDING_PROVIDER || 'ollama') + ' (run POST /api/v1/index to index)');
  });
}

export { app };
