#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const runtimeIndex = process.argv.indexOf('--runtime');
if (runtimeIndex < 0 || !process.argv[runtimeIndex + 1]) throw new Error('missing --runtime');
const runtimeRoot = path.resolve(process.argv[runtimeIndex + 1]);
const worker = fork(path.join(runtimeRoot, 'companion/runtime/inference-worker.mjs'), [runtimeRoot], {
  execPath: path.join(runtimeRoot, 'node/bin/node'),
  execArgv: ['--permission', `--allow-fs-read=${runtimeRoot}`],
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', TMPDIR: '/tmp' },
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
});

const timeout = setTimeout(() => {
  worker.kill('SIGKILL');
  throw new Error('inference smoke test timed out');
}, 90_000);

try {
  await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code, signal) => reject(new Error(`worker exited before ready: ${code ?? signal}`)));
    const ready = (message) => {
      if (message?.ready !== true) return;
      worker.off('message', ready);
      resolve();
    };
    worker.on('message', ready);
  });
  const result = await new Promise((resolve, reject) => {
    worker.once('error', reject);
    const receive = (message) => {
      if (message?.id !== 'smoke') return;
      worker.off('message', receive);
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    };
    worker.on('message', receive);
    worker.send({ id: 'smoke', command: 'embed', arguments: { texts: ['Knowtation'] } });
  });
  assert.equal(result.vectors.length, 1);
  assert.equal(result.vectors[0].length, 384);
  assert.ok(result.vectors[0].every(Number.isFinite));
  const norm = Math.sqrt(result.vectors[0].reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5);
  console.log(JSON.stringify({ ok: true, dimensions: 384 }));
} finally {
  clearTimeout(timeout);
  worker.kill('SIGTERM');
}
