import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';

import { createCompanionInferenceListener } from '../../lib/companion-inference-listener.mjs';

const MAX_BODY_BYTES = 512 * 1024;

function waitForWorker(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PRIVATE_MODEL_UNAVAILABLE')), 30_000);
    timer.unref?.();
    const onMessage = (message) => {
      if (message?.ready !== true) return;
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
      resolve();
    };
    const onExit = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      reject(new Error('PRIVATE_MODEL_UNAVAILABLE'));
    };
    worker.on('message', onMessage);
    worker.once('exit', onExit);
  });
}

function createWorkerClient(worker) {
  const pending = new Map();
  worker.on('message', (message) => {
    if (!message?.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error ?? 'PRIVATE_MODEL_UNAVAILABLE'));
  });
  worker.once('exit', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('PRIVATE_MODEL_UNAVAILABLE'));
    }
    pending.clear();
  });
  return {
    embed(texts) {
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('PRIVATE_MODEL_UNAVAILABLE'));
        }, 60_000);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        worker.send({ id, command: 'embed', arguments: { texts } });
      });
    },
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('PRIVATE_INFERENCE_INPUT');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startAppRuntime({
  custody,
  runtimeRoot,
  spawnWorker = fork,
  listenerFactory = createCompanionInferenceListener,
  stateDirectory = path.join(os.homedir(), 'Library/Application Support/Knowtation'),
}) {
  const loopbackToken = crypto.randomBytes(32).toString('base64url');
  const tokenAccount = 'knowtation.companion.loopbackToken';
  const workerPath = path.join(runtimeRoot, 'companion/runtime/inference-worker.mjs');
  const stateFile = path.join(stateDirectory, 'companion.json');
  let worker;
  let listener;
  let closed = false;

  async function cleanup() {
    if (closed) return;
    closed = true;
    const tasks = [];
    if (listener) tasks.push(Promise.resolve().then(() => listener.close()));
    if (worker) worker.kill('SIGTERM');
    tasks.push(Promise.resolve().then(() => custody.delete(tokenAccount)));
    tasks.push(fs.rm(stateFile, { force: true }));
    const results = await Promise.allSettled(tasks);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  try {
    await custody.set(tokenAccount, loopbackToken);
    worker = spawnWorker(workerPath, [runtimeRoot], {
      execPath: process.execPath,
      execArgv: ['--permission', `--allow-fs-read=${runtimeRoot}`],
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await waitForWorker(worker);
    const client = createWorkerClient(worker);

    listener = listenerFactory({
      expectedToken: loopbackToken,
      async runtimeRequest(request, response) {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        if (request.method === 'GET') {
          response.statusCode = 200;
          response.end(JSON.stringify({ ok: true, model: 'all-MiniLM-L6-v2', dimensions: 384 }));
          return;
        }
        const body = await readJsonBody(request);
        const result = await client.embed(body?.texts);
        response.statusCode = 200;
        response.end(JSON.stringify({ ok: true, ...result }));
      },
    });
    const endpoint = await listener.start();

    await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(stateFile, `${JSON.stringify({
      schema: 1,
      host: endpoint.host,
      port: endpoint.port,
      pid: process.pid,
      version: process.env.KNOWTATION_RELEASE_VERSION,
      build: Number(process.env.KNOWTATION_RELEASE_BUILD),
    })}\n`, { mode: 0o600 });

    return Object.freeze({ endpoint, close: cleanup });
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}
