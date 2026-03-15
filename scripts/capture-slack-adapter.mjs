#!/usr/bin/env node
/**
 * Slack Events API adapter. Receives Slack event payloads and forwards message events
 * to the Knowtation capture endpoint (Hub or standalone webhook).
 *
 * Usage:
 *   node scripts/capture-slack-adapter.mjs [--port 3132]
 *   CAPTURE_URL=http://localhost:3333/api/v1/capture node scripts/capture-slack-adapter.mjs
 *
 * Env:
 *   CAPTURE_URL     — Where to POST the normalized payload (default http://localhost:3333/api/v1/capture)
 *   CAPTURE_WEBHOOK_SECRET — If set, sent as X-Webhook-Secret header
 *   SLACK_SIGNING_SECRET  — If set, verify Slack request signature (X-Slack-Signature)
 *
 * In Slack: App → Event Subscriptions → Enable → Request URL: https://your-host:3132/
 * Subscribe to bot events: message.channels, message.groups, message.im (or as needed).
 */

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_CAPTURE_URL = 'http://localhost:3333/api/v1/capture';
const CAPTURE_URL = process.env.CAPTURE_URL || DEFAULT_CAPTURE_URL;

function parseArgs() {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PORT || '3132', 10);
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

function verifySlackSignature(body, signature) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !signature) return true;
  const sigBasename = signature.startsWith('v0=') ? signature.slice(3) : signature;
  const computed = 'v0=' + crypto.createHmac('sha256', secret).update('v0:' + body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(signature, 'utf8'));
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
    if (req.method !== 'POST' || (req.url !== '/' && req.url !== '')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. POST / for Slack events.' }));
      return;
    }

    let rawBody = '';
    req.on('data', (chunk) => { rawBody += chunk; });
    await new Promise((resolve) => req.on('end', resolve));

    const signature = req.headers['x-slack-signature'];
    if (!verifySlackSignature(rawBody, signature)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    res.setHeader('Content-Type', 'application/json');

    if (payload.type === 'url_verification') {
      res.writeHead(200);
      res.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    if (payload.type === 'event_callback') {
      const event = payload.event || {};
      if (event.type === 'message' && event.text != null && event.text !== '') {
        const sourceId = event.ts || event.client_msg_id || `${event.channel}_${Date.now()}`;
        const capturePayload = {
          body: event.text,
          source: 'slack',
          source_id: sourceId,
          project: event.channel ? undefined : undefined,
          tags: event.channel ? `channel:${event.channel}` : undefined,
        };
        try {
          await postToCapture(capturePayload);
        } catch (e) {
          console.error('capture-slack-adapter: capture error', e.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
      }
      res.writeHead(200);
      res.end('');
      return;
    }

    res.writeHead(200);
    res.end('');
  });

  server.listen(port, () => {
    console.log(`capture-slack-adapter listening on http://localhost:${port}`);
    console.log('  CAPTURE_URL:', CAPTURE_URL);
    console.log('  Configure Slack Event Subscriptions to this URL');
  });
}

main();
