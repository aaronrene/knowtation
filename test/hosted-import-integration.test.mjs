/**
 * Hosted import: bridge runs importers and POSTs notes to canister; gateway streams multipart to bridge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SECRET = 'hosted-import-integration-test-secret-32';

/** HS256 JWT compatible with `jsonwebtoken` (bridge/gateway). */
function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) ?? headers.get(name.toLowerCase());
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return null;
}

test('bridge POST /api/v1/import: markdown upload → mock canister receives note + import provenance', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-bridge-import-int-'));
  t.after(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  });

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;

  const noteWrites = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/vaults') && (init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ vaults: [{ id: 'default' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(init.method || 'GET').toUpperCase() === 'POST' && u.includes('/api/v1/notes')) {
      let bodyText = '';
      if (typeof init.body === 'string') bodyText = init.body;
      else if (init.body != null && typeof init.body === 'object' && Symbol.asyncIterator in init.body) {
        const chunks = [];
        for await (const c of init.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        bodyText = Buffer.concat(chunks).toString('utf8');
      }
      noteWrites.push({
        url: u,
        'x-user-id': headerGet(init.headers, 'x-user-id'),
        'x-actor-id': headerGet(init.headers, 'x-actor-id'),
        'x-vault-id': headerGet(init.headers, 'x-vault-id'),
        body: bodyText,
      });
      const batch = u.includes('/notes/batch');
      return new Response(
        batch
          ? JSON.stringify({ imported: JSON.parse(bodyText).notes?.length ?? 0, written: true })
          : JSON.stringify({ ok: true }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return origFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?t=${Date.now()}`);

  const token = signTestJwt({ sub: 'github:integration-tester' });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => server.close(() => r())));

  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const fd = new FormData();
  fd.set('source_type', 'markdown');
  fd.set('file', new Blob(['# Hello\n\nIntegration body.\n'], { type: 'text/markdown' }), 'note.md');

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const json = JSON.parse(resText);
  assert.equal(json.count, 1);
  assert.ok(Array.isArray(json.imported));
  assert.equal(json.imported.length, 1);

  assert.equal(noteWrites.length, 1);
  const nw = noteWrites[0];
  assert.match(nw.url, /\/api\/v1\/notes\/batch/);
  assert.equal(nw['x-user-id'], 'github:integration-tester');
  assert.equal(nw['x-actor-id'], 'github:integration-tester');
  assert.equal(nw['x-vault-id'], 'default');
  const posted = JSON.parse(nw.body);
  assert.ok(Array.isArray(posted.notes));
  assert.equal(posted.notes.length, 1);
  assert.equal(posted.notes[0].path, 'inbox/note.md');
  assert.match(posted.notes[0].body, /Integration body/);
  assert.equal(typeof posted.notes[0].frontmatter, 'object');
  assert.match(JSON.stringify(posted.notes[0].frontmatter), /import/);
});

test('bridge POST /api/v1/import: pdf upload → note body contains extracted text', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-bridge-import-pdf-'));
  t.after(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  });

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;

  const noteWrites = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/vaults') && (init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ vaults: [{ id: 'default' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(init.method || 'GET').toUpperCase() === 'POST' && u.includes('/api/v1/notes')) {
      let bodyText = '';
      if (typeof init.body === 'string') bodyText = init.body;
      else if (init.body != null && typeof init.body === 'object' && Symbol.asyncIterator in init.body) {
        const chunks = [];
        for await (const c of init.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        bodyText = Buffer.concat(chunks).toString('utf8');
      }
      noteWrites.push({ url: u, body: bodyText });
      return new Response(JSON.stringify({ imported: JSON.parse(bodyText).notes?.length ?? 0, written: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?t=${Date.now()}-pdf`);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => server.close(() => r())));

  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const pdfPath = path.join(projectRoot, 'test', 'fixtures', 'pdf-import', 'hello.pdf');
  const pdfBuf = fs.readFileSync(pdfPath);
  const token = signTestJwt({ sub: 'github:integration-pdf' });
  const fd = new FormData();
  fd.set('source_type', 'pdf');
  fd.set('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'hello.pdf');

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const json = JSON.parse(resText);
  assert.equal(json.count, 1);
  assert.equal(noteWrites.length, 1);
  const posted = JSON.parse(noteWrites[0].body);
  assert.ok(posted.notes[0].body.includes('Knowtation PDF fixture'));
  assert.equal(posted.notes[0].frontmatter.source, 'pdf-import');
});

test('bridge POST /api/v1/import: docx upload → note body contains converted markdown', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-bridge-import-docx-'));
  t.after(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  });

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;

  const noteWrites = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/vaults') && (init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ vaults: [{ id: 'default' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(init.method || 'GET').toUpperCase() === 'POST' && u.includes('/api/v1/notes')) {
      let bodyText = '';
      if (typeof init.body === 'string') bodyText = init.body;
      else if (init.body != null && typeof init.body === 'object' && Symbol.asyncIterator in init.body) {
        const chunks = [];
        for await (const c of init.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        bodyText = Buffer.concat(chunks).toString('utf8');
      }
      noteWrites.push({ url: u, body: bodyText });
      return new Response(JSON.stringify({ imported: JSON.parse(bodyText).notes?.length ?? 0, written: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?t=${Date.now()}-docx`);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => server.close(() => r())));

  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const docxPath = path.join(projectRoot, 'test', 'fixtures', 'docx-import', 'hello.docx');
  const docxBuf = fs.readFileSync(docxPath);
  const token = signTestJwt({ sub: 'github:integration-docx' });
  const fd = new FormData();
  fd.set('source_type', 'docx');
  fd.set('file', new Blob([docxBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'hello.docx');

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const json = JSON.parse(resText);
  assert.equal(json.count, 1);
  assert.equal(noteWrites.length, 1);
  const posted = JSON.parse(noteWrites[0].body);
  assert.ok(posted.notes[0].body.includes('Knowtation DOCX fixture'));
  assert.equal(posted.notes[0].frontmatter.source, 'docx-import');
});

test('bridge POST /api/v1/import: generic-csv upload → one canister note per row', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-bridge-import-csv-'));
  t.after(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  });

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;

  const noteWrites = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/vaults') && (init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ vaults: [{ id: 'default' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(init.method || 'GET').toUpperCase() === 'POST' && u.includes('/api/v1/notes')) {
      let bodyText = '';
      if (typeof init.body === 'string') bodyText = init.body;
      else if (init.body != null && typeof init.body === 'object' && Symbol.asyncIterator in init.body) {
        const chunks = [];
        for await (const c of init.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        bodyText = Buffer.concat(chunks).toString('utf8');
      }
      noteWrites.push({ url: u, body: bodyText });
      return new Response(JSON.stringify({ imported: JSON.parse(bodyText).notes?.length ?? 0, written: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?t=${Date.now()}-gcsv`);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => server.close(() => r())));

  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const csvPath = path.join(projectRoot, 'test', 'fixtures', 'generic-csv-import', 'sample.csv');
  const csvBuf = fs.readFileSync(csvPath);
  const token = signTestJwt({ sub: 'github:integration-gcsv' });
  const fd = new FormData();
  fd.set('source_type', 'generic-csv');
  fd.set('file', new Blob([csvBuf], { type: 'text/csv' }), 'sample.csv');

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const json = JSON.parse(resText);
  assert.equal(json.count, 2);
  assert.equal(noteWrites.length, 1);
  const posted = JSON.parse(noteWrites[0].body);
  assert.equal(posted.notes.length, 2);
  assert.equal(posted.notes[0].frontmatter.source, 'csv-import');
  assert.equal(posted.notes[0].frontmatter.title, 'sample.csv · Alice');
  assert.equal(posted.notes[1].frontmatter.title, 'sample.csv · Bob');
  assert.ok(posted.notes[0].body.includes('Alice'));
  assert.ok(posted.notes[1].body.includes('Bob'));
});

test('bridge POST /api/v1/import: ZIP with multiple .md files → one canister batch (≤100 notes)', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-bridge-import-multi-'));
  t.after(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  });

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;

  const noteWrites = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/vaults') && (init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ vaults: [{ id: 'default' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(init.method || 'GET').toUpperCase() === 'POST' && u.includes('/api/v1/notes')) {
      let bodyText = '';
      if (typeof init.body === 'string') bodyText = init.body;
      noteWrites.push({ url: u, body: bodyText });
      const batch = u.includes('/notes/batch');
      return new Response(
        batch
          ? JSON.stringify({ imported: JSON.parse(bodyText).notes?.length ?? 0, written: true })
          : JSON.stringify({ ok: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return origFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?t=${Date.now()}-multi`);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => server.close(() => r())));

  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const zip = new AdmZip();
  zip.addFile('one.md', Buffer.from('# One\n\nfirst'));
  zip.addFile('two.md', Buffer.from('# Two\n\nsecond'));
  const zipBuf = zip.toBuffer();

  const token = signTestJwt({ sub: 'github:integration-multi' });
  const fd = new FormData();
  fd.set('source_type', 'markdown');
  fd.set('file', new Blob([zipBuf], { type: 'application/zip' }), 'pair.zip');

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const json = JSON.parse(resText);
  assert.equal(json.count, 2);
  assert.equal(noteWrites.length, 1);
  assert.match(noteWrites[0].url, /\/notes\/batch/);
  const batchBody = JSON.parse(noteWrites[0].body);
  assert.equal(batchBody.notes.length, 2);
});

test('bridge import chunks canister batch at 100 notes (101 files → 2 POSTs)', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-bridge-import-chunk-'));
  t.after(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  });

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://mock-canister.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;

  const noteWrites = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/v1/vaults') && (init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ vaults: [{ id: 'default' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(init.method || 'GET').toUpperCase() === 'POST' && u.includes('/api/v1/notes')) {
      let bodyText = '';
      if (typeof init.body === 'string') bodyText = init.body;
      noteWrites.push({ url: u, body: bodyText });
      return new Response(
        JSON.stringify({ imported: JSON.parse(bodyText).notes?.length ?? 0, written: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return origFetch(url, init);
  };
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const bridgeEntry = pathToFileURL(path.join(projectRoot, 'hub', 'bridge', 'server.mjs')).href;
  const { app } = await import(`${bridgeEntry}?t=${Date.now()}-chunk`);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => server.close(() => r())));

  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const zip = new AdmZip();
  for (let i = 0; i < 101; i++) {
    zip.addFile(`n${i}.md`, Buffer.from(`# Note ${i}\n\nbody ${i}.\n`));
  }
  const zipBuf = zip.toBuffer();

  const token = signTestJwt({ sub: 'github:chunk-test' });
  const fd = new FormData();
  fd.set('source_type', 'markdown');
  fd.set('file', new Blob([zipBuf], { type: 'application/zip' }), 'many.zip');

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const out = JSON.parse(resText);
  assert.equal(out.count, 101);
  assert.equal(noteWrites.length, 2);
  assert.match(noteWrites[0].url, /\/notes\/batch/);
  assert.match(noteWrites[1].url, /\/notes\/batch/);
  assert.equal(JSON.parse(noteWrites[0].body).notes.length, 100);
  assert.equal(JSON.parse(noteWrites[1].body).notes.length, 1);
});

test('gateway POST /api/v1/import streams multipart to BRIDGE_URL (mock bridge)', async (t) => {
  const mockBridge = express();
  const upload = multer({ storage: multer.memoryStorage() }).single('file');
  let received = /** @type {{ source_type?: string, fileLen: number, name?: string } | null} */ (null);
  mockBridge.post('/api/v1/import', upload, (req, res) => {
    received = {
      source_type: req.body?.source_type,
      fileLen: req.file?.buffer?.length ?? 0,
      name: req.file?.originalname,
    };
    res.json({ imported: [{ path: 'inbox/x.md' }], count: 1 });
  });
  const bridgeSrv = http.createServer(mockBridge);
  await new Promise((resolve, reject) => {
    bridgeSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => bridgeSrv.close(() => r())));
  const bridgePort = /** @type {import('net').AddressInfo} */ (bridgeSrv.address()).port;
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;

  process.env.NETLIFY = '1';
  process.env.CANISTER_URL = 'http://canister.placeholder.test';
  process.env.SESSION_SECRET = SECRET;
  process.env.BRIDGE_URL = bridgeUrl;

  const gwEntry = pathToFileURL(path.join(projectRoot, 'hub', 'gateway', 'server.mjs')).href;
  const { app: gwApp } = await import(`${gwEntry}?gw=${Date.now()}`);

  const gwSrv = http.createServer(gwApp);
  await new Promise((resolve, reject) => {
    gwSrv.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  t.after(() => new Promise((r) => gwSrv.close(() => r())));
  const gwPort = /** @type {import('net').AddressInfo} */ (gwSrv.address()).port;

  const token = signTestJwt({ sub: 'google:gw-import-test' });
  const fd = new FormData();
  fd.set('source_type', 'markdown');
  fd.set('file', new Blob(['# Z\n'], { type: 'text/markdown' }), 'z.md');

  const res = await fetch(`http://127.0.0.1:${gwPort}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Vault-Id': 'default' },
    body: fd,
  });

  const text = await res.text();
  assert.equal(res.status, 200, text);
  const json = JSON.parse(text);
  assert.equal(json.count, 1);
  assert.ok(received);
  assert.equal(received.source_type, 'markdown');
  assert.ok(received.fileLen > 0);
  assert.equal(received.name, 'z.md');
});
