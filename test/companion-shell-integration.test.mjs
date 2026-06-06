/**
 * Tier 2 — INTEGRATION: Phase 5 adapters composed with Phase 2–4 cores.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCompanionInferenceListener } from '../lib/companion-inference-listener.mjs';
import {
  createCompanionShell,
  createRuntimeGroup,
  downloadVerifyAndStageModel,
} from '../lib/companion-shell.mjs';

const tmpRoots = [];
after(async () => {
  for (const dir of tmpRoots) await rm(dir, { recursive: true, force: true });
});

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('guarded listener fronts the runtime callback', () => {
  it('admits only same-origin loopback requests with the bearer token', async () => {
    let runtimeHits = 0;
    const listener = createCompanionInferenceListener({
      expectedToken: 'loopback-token',
      runtimeRequest(_req, res) {
        runtimeHits += 1;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      },
    });
    const bound = await listener.start();
    try {
      const url = `http://127.0.0.1:${bound.port}/v1/models`;
      const denied = await fetch(url, { headers: { Origin: 'https://evil.example', Authorization: 'Bearer loopback-token' } });
      assert.equal(denied.status, 403);
      assert.equal(runtimeHits, 0);

      const allowed = await fetch(url, {
        headers: {
          Host: `127.0.0.1:${bound.port}`,
          Origin: `http://127.0.0.1:${bound.port}`,
          'Sec-Fetch-Site': 'same-origin',
          Authorization: 'Bearer loopback-token',
        },
      });
      assert.equal(allowed.status, 200);
      assert.equal(runtimeHits, 1);
      assert.equal(allowed.headers.get('access-control-allow-origin'), null);
    } finally {
      await listener.close();
    }
  });
});

describe('download → integrity → atomic stage', () => {
  it('streams chunks through the accumulator before verified rename', async () => {
    const data = Buffer.from('verified model payload');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'knowtation-phase5-'));
    tmpRoots.push(dir);
    const tempPath = path.join(dir, 'model.tmp');
    const verifiedPath = path.join(dir, 'model.gguf');
    const runtimeGroup = createRuntimeGroup({
      spawn: async () => ({ pid: 42, kill: async () => {} }),
      healthCheck: async () => true,
      async download(_url, onChunk) {
        onChunk(data.subarray(0, 8));
        onChunk(data.subarray(8));
      },
    });

    const result = await downloadVerifyAndStageModel({
      runtimeGroup,
      tempPath,
      verifiedPath,
      spec: {
        modelUrl: 'https://cdn.knowtation-models.com/model.gguf',
        expectedDigest: sha256(data),
        expectedSizeBytes: data.length,
        allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
      },
    });

    assert.equal(result.verifiedPath, verifiedPath);
    assert.equal(await readFile(verifiedPath, 'utf8'), data.toString('utf8'));
  });
});

describe('runtime lifecycle drives lane selection', () => {
  it('integrity + listener + token + health_ok flips companionAvailable and selects local', async () => {
    let now = 1000;
    const shell = createCompanionShell({
      now: () => now,
      healthRecencyMs: 500,
      runtimeGroup: {
        spawn: async () => ({ pid: 7, port: 41111, kill: async () => {} }),
        download: async () => {},
        healthCheck: async () => true,
      },
    });
    shell.markIntegrityVerified();
    shell.setListenerBound(true);
    shell.setLoopbackTokenPresent(true);
    await shell.startRuntime({
      binaryPath: '/opt/knowtation/runtime',
      modelPath: '/models/verified.gguf',
      port: 41111,
      maxRamBytes: 1024,
    });

    assert.equal(shell.companionAvailable(), true);
    assert.equal(shell.selectLane({}, { managedKeyAvailable: true }), 'local');
    now = 2000;
    assert.equal(shell.companionAvailable(), false);
  });
});
