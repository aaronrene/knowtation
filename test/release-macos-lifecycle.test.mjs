import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startAppRuntime } from '../companion/runtime/app-runtime.mjs';

function fakeWorker() {
  const worker = new EventEmitter();
  worker.killedWith = null;
  worker.kill = (signal) => { worker.killedWith = signal; };
  worker.send = () => {};
  worker.once('newListener', (event) => {
    if (event === 'message') queueMicrotask(() => worker.emit('message', { ready: true }));
  });
  return worker;
}

test('app runtime publishes state and removes capability and state on close', async () => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowtation-lifecycle-'));
  const store = new Map();
  const custody = {
    set: async (key, value) => store.set(key, value),
    delete: async (key) => store.delete(key),
  };
  const worker = fakeWorker();
  let listenerClosed = false;
  const runtime = await startAppRuntime({
    custody,
    runtimeRoot: '/fixed/runtime',
    stateDirectory,
    spawnWorker: () => worker,
    listenerFactory: ({ expectedToken }) => ({
      start: async () => {
        assert.equal(expectedToken, store.get('knowtation.companion.loopbackToken'));
        return { host: '127.0.0.1', port: 43123 };
      },
      close: async () => { listenerClosed = true; },
    }),
  });
  const stateFile = path.join(stateDirectory, 'companion.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.deepEqual({ host: state.host, port: state.port }, { host: '127.0.0.1', port: 43123 });
  assert.ok(store.has('knowtation.companion.loopbackToken'));

  await runtime.close();
  await runtime.close();
  assert.equal(listenerClosed, true);
  assert.equal(worker.killedWith, 'SIGTERM');
  assert.equal(store.has('knowtation.companion.loopbackToken'), false);
  await assert.rejects(fs.access(stateFile));
  await fs.rm(stateDirectory, { recursive: true, force: true });
});

test('failed startup revokes the capability and terminates the worker', async () => {
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowtation-lifecycle-fail-'));
  const store = new Map();
  const custody = {
    set: async (key, value) => store.set(key, value),
    delete: async (key) => store.delete(key),
  };
  const worker = fakeWorker();
  await assert.rejects(startAppRuntime({
    custody,
    runtimeRoot: '/fixed/runtime',
    stateDirectory,
    spawnWorker: () => worker,
    listenerFactory: () => ({
      start: async () => { throw new Error('listener_failed'); },
      close: async () => {},
    }),
  }), /listener_failed/);
  assert.equal(worker.killedWith, 'SIGTERM');
  assert.equal(store.has('knowtation.companion.loopbackToken'), false);
  await fs.rm(stateDirectory, { recursive: true, force: true });
});
