#!/usr/bin/env node
/**
 * Webhook server for capture. Receives POST JSON and writes to vault inbox per CAPTURE-CONTRACT.
 * Optional; use when Slack, Discord, or another service can POST to a URL.
 *
 * Usage:
 *   node scripts/capture-webhook.mjs [--port 3131]
 *   PORT=3131 node scripts/capture-webhook.mjs
 *
 * POST /capture with JSON body:
 *   { "body": "Message content", "source_id": "msg-123", "source": "slack", "project": "myproject", "tags": "a,b" }
 *
 * Required: body. Optional: source_id, source (default webhook), project, tags.
 * Config: config/local.yaml or env KNOWTATION_VAULT_PATH.
 */

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';
import { writeNote } from '../lib/write.mjs';
import { normalizeSlug } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PORT || '3131', 10);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    }
  }
  return port;
}

function sanitizeForFilename(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function main() {
  const port = parseArgs();
  let config;
  try {
    config = loadConfig(projectRoot);
  } catch (e) {
    console.error('capture-webhook: config error:', e.message);
    process.exit(2);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.url !== '/capture') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found. POST /capture with JSON body.' }));
      return;
    }

    let payload;
    try {
      payload = await parseJsonBody(req);
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const body = payload.body;
    if (!body || typeof body !== 'string') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'body (string) is required' }));
      return;
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

    const frontmatter = {
      source,
      date: now,
      ...(sourceId && { source_id: sourceId }),
      ...(project && { project: normalizeSlug(project) }),
      ...(tags && { tags }),
    };

    try {
      const result = writeNote(config.vault_path, relativePath, {
        body: body.trimEnd(),
        frontmatter,
      });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, path: result.path }));
    } catch (e) {
      console.error('capture-webhook write error:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, () => {
    console.log(`capture-webhook listening on http://localhost:${port}`);
    console.log('POST /capture with JSON: { body, source_id?, source?, project?, tags? }');
  });
}

main();
