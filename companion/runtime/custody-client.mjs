import crypto from 'node:crypto';
import net from 'node:net';

const MAX_FRAME_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_ACCOUNTS = new Set([
  'knowtation.companion.accessToken',
  'knowtation.companion.refreshToken',
  'knowtation.companion.sessionMeta',
  'knowtation.companion.loopbackToken',
  'knowtation.companion.updateFloor',
]);

function requireAccount(account) {
  if (typeof account !== 'string' || !ALLOWED_ACCOUNTS.has(account)) {
    throw new TypeError('custody_client_invalid_account');
  }
  return account;
}

function requireFd(env = process.env) {
  const raw = env.KNOWTATION_CUSTODY_FD;
  if (!/^[0-9]+$/.test(raw ?? '')) throw new Error('custody_capability_unavailable');
  const fd = Number(raw);
  if (!Number.isInteger(fd) || fd < 3) throw new Error('custody_capability_unavailable');
  return fd;
}

export function createCustodyClient({ fd = requireFd(), timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(fd) || fd < 3) throw new TypeError('custody_client_invalid_fd');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError('custody_client_invalid_timeout');
  }

  const socket = new net.Socket({ fd, readable: true, writable: true });
  socket.unref();
  let buffer = Buffer.alloc(0);
  let closed = false;
  const pending = new Map();

  function rejectPending(reason = 'custody_connection_closed') {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 65_536) {
      socket.destroy(new Error('custody_response_too_large'));
      return;
    }
    for (;;) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      const frame = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (frame.length > MAX_FRAME_BYTES) continue;
      let response;
      try {
        response = JSON.parse(frame.toString('utf8'));
      } catch {
        continue;
      }
      if (!response || typeof response.id !== 'string') continue;
      const entry = pending.get(response.id);
      if (!entry) continue;
      pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.ok === true) entry.resolve(response.value ?? null);
      else entry.reject(new Error('custody_operation_failed'));
    }
  });
  socket.on('error', () => rejectPending());
  socket.on('close', () => {
    closed = true;
    rejectPending();
  });

  function request(operation, account = null, value = null) {
    if (closed) return Promise.reject(new Error('custody_connection_closed'));
    const id = crypto.randomUUID();
    const message = JSON.stringify({ id, operation, account, value });
    if (Buffer.byteLength(message) > MAX_FRAME_BYTES) {
      return Promise.reject(new Error('custody_request_too_large'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('custody_request_timeout'));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      socket.write(`${message}\n`, 'utf8', (error) => {
        if (!error) return;
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error('custody_connection_closed'));
      });
    });
  }

  return Object.freeze({
    status: () => request('status'),
    get: (account) => request('get', requireAccount(account)),
    set: (account, value) => {
      requireAccount(account);
      if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 8192) {
        throw new TypeError('custody_client_invalid_value');
      }
      return request('set', account, value).then(() => undefined);
    },
    delete: (account) => request('delete', requireAccount(account)).then(() => undefined),
    close: () => {
      if (!closed) socket.destroy();
    },
  });
}

export function createCustodyKeychainAdapter(options) {
  const client = createCustodyClient(options);
  return Object.freeze({
    get: (account) => client.get(account),
    set: (account, value) => client.set(account, value),
    delete: (account) => client.delete(account),
    status: () => client.status(),
    close: () => client.close(),
  });
}

export const CUSTODY_ALLOWED_ACCOUNTS = Object.freeze([...ALLOWED_ACCOUNTS].sort());
