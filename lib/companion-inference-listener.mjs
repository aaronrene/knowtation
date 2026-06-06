/**
 * Companion App — Phase 5 guarded inference listener.
 *
 * Binds an OS-assigned loopback port and applies `verifyLoopbackRequest` before any
 * runtime work is invoked. The listener never emits permissive CORS headers.
 */

import http from 'node:http';

import {
  createLoopbackRateState,
  recordLoopbackRequest,
  shouldCountTowardRateLimit,
  verifyLoopbackRequest,
} from './companion-loopback-guard.mjs';

export const INFERENCE_LISTENER_REASONS = Object.freeze({
  BIND_NOT_LOOPBACK: 'bind_not_loopback',
  NOT_LISTENING: 'not_listening',
  RUNTIME_UNAVAILABLE: 'runtime_unavailable',
});

const LOOPBACK_BINDS = new Set(['127.0.0.1', '::1']);

/**
 * Build the exact Host allowlist for a bound loopback port.
 * @param {{ host: string, port: number }} params
 * @returns {string[]}
 */
export function buildAllowedHosts({ host, port }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(INFERENCE_LISTENER_REASONS.NOT_LISTENING);
  }
  if (host === '::1') return [`[::1]:${port}`];
  if (host === '127.0.0.1') return [`127.0.0.1:${port}`, `localhost:${port}`];
  throw new TypeError(INFERENCE_LISTENER_REASONS.BIND_NOT_LOOPBACK);
}

/**
 * Extract the bearer token from a request without inspecting the body.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function extractLoopbackBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const companionHeader = req.headers['x-knowtation-companion-token'];
  return typeof companionHeader === 'string' ? companionHeader.trim() : '';
}

/**
 * Create a loopback-only HTTP listener with the Phase 2 guard as the front door.
 * @param {{
 *   host?: '127.0.0.1'|'::1',
 *   expectedToken: string,
 *   runtimeRequest: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>|void,
 *   now?: () => number,
 *   rateState?: ReturnType<typeof createLoopbackRateState>,
 *   verify?: typeof verifyLoopbackRequest,
 *   createServer?: typeof http.createServer,
 * }} params
 */
export function createCompanionInferenceListener(params) {
  const {
    host = '127.0.0.1',
    expectedToken,
    runtimeRequest,
    now = () => Date.now(),
    verify = verifyLoopbackRequest,
    createServer = http.createServer,
  } = params ?? {};

  if (!LOOPBACK_BINDS.has(host)) {
    throw new TypeError(INFERENCE_LISTENER_REASONS.BIND_NOT_LOOPBACK);
  }
  if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
    throw new TypeError('expected_token_required');
  }
  if (typeof runtimeRequest !== 'function') {
    throw new TypeError(INFERENCE_LISTENER_REASONS.RUNTIME_UNAVAILABLE);
  }

  let rateState = params?.rateState ?? createLoopbackRateState();
  let allowedHosts = [];

  const server = createServer(async (req, res) => {
    const verdict = verify({
      method: req.method,
      headers: req.headers,
      token: extractLoopbackBearerToken(req),
      expectedToken,
      allowedHosts,
      now: now(),
      rateState,
    });

    if (shouldCountTowardRateLimit(verdict)) {
      rateState = recordLoopbackRequest(rateState, now());
    }

    if (!verdict.allow) {
      res.statusCode = verdict.status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, reason: verdict.reason }));
      return;
    }

    try {
      await runtimeRequest(req, res);
    } catch {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, reason: INFERENCE_LISTENER_REASONS.RUNTIME_UNAVAILABLE }));
    }
  });

  return {
    server,
    get allowedHosts() {
      return [...allowedHosts];
    },
    get port() {
      const address = server.address();
      return address && typeof address === 'object' ? address.port : null;
    },
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address !== 'object' || !LOOPBACK_BINDS.has(address.address)) {
        await this.close();
        throw new Error(INFERENCE_LISTENER_REASONS.BIND_NOT_LOOPBACK);
      }
      allowedHosts = buildAllowedHosts({ host: address.address, port: address.port });
      return { host: address.address, port: address.port, allowedHosts: [...allowedHosts] };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
