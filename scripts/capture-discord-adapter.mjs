#!/usr/bin/env node
/**
 * Discord webhook adapter. Receives POSTs with Discord-style message payloads
 * and forwards them to the Knowtation capture endpoint.
 *
 * Usage:
 *   node scripts/capture-discord-adapter.mjs [--port 3133]
 *   CAPTURE_URL=http://localhost:3333/api/v1/capture node scripts/capture-discord-adapter.mjs
 *
 * POST body (JSON): { "content": "message text", "id?", "channel_id?", "author?", "project?", "tags?" }
 * Or minimal: { "content": "message text" }
 *
 * Env: CAPTURE_URL (default http://localhost:3333/api/v1/capture), CAPTURE_WEBHOOK_SECRET
 *
 * Use with Discord bot gateway, Zapier, n8n, or any service that can POST this shape.
 */

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CAPTURE_URL = 'http://localhost:3333/api/v1/capture';
const CAPTURE_URL = process.env.CAPTURE_URL || DEFAULT_CAPTURE_URL;

function parseArgs() {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PORT || '3133', 10);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
  }
  return port;
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

async function postToCapture(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CAPTURE_WEBHOOK_SECRET) {
    headers['X-Webhook-Secret'] = process.env.CAPTURE_WEBHOOK_SECRET;
  }
  const res = await fetch(CAPTURE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Capture returned ${res.status}: ${text}`);
  return text;
}

function main() {
  const port = parseArgs();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || (req.url !== '/' && req.url !== '/capture' && req.url !== '')) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found. POST / or /capture with JSON { content, id?, channel_id?, project?, tags? }' }));
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

    const content = payload.content ?? payload.body ?? payload.message;
    if (!content || typeof content !== 'string') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'content (or body/message) string is required' }));
      return;
    }

    const sourceId = payload.id ?? payload.message_id ?? (payload.channel_id ? `${payload.channel_id}_${Date.now()}` : undefined);
    const capturePayload = {
      body: content,
      source: 'discord',
      source_id: sourceId || undefined,
      project: payload.project || undefined,
      tags: payload.tags != null ? (Array.isArray(payload.tags) ? payload.tags.join(',') : String(payload.tags)) : undefined,
    };

    try {
      await postToCapture(capturePayload);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('capture-discord-adapter: capture error', e.message);
      res.writeHead(502);
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, () => {
    console.log(`capture-discord-adapter listening on http://localhost:${port}`);
    console.log('  CAPTURE_URL:', CAPTURE_URL);
    console.log('  POST / or /capture with JSON: { content, id?, channel_id?, project?, tags? }');
  });
}

main();
