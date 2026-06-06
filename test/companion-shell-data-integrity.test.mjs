/**
 * Tier 5 — DATA-INTEGRITY: Phase 5 integrity and token-rotation invariants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCompanionInferenceListener } from '../lib/companion-inference-listener.mjs';
import {
  createRuntimeGroup,
  downloadVerifyAndStageModel,
} from '../lib/companion-shell.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('downloaded model integrity', () => {
  it('rejects one-bit corruption and leaves no verified model behind', async () => {
    const expected = Buffer.from('expected model bytes');
    const corrupted = Buffer.from(expected);
    corrupted[0] ^= 0x01;
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'knowtation-phase5-integrity-'));
    const verifiedPath = path.join(tmp, 'model.gguf');
    try {
      const runtimeGroup = createRuntimeGroup({
        async download(_url, onChunk) {
          onChunk(corrupted);
        },
        async spawn() {
          throw new Error('spawn must not run');
        },
        async healthCheck() {
          return false;
        },
      });

      await assert.rejects(
        () => downloadVerifyAndStageModel({
          runtimeGroup,
          tempPath: path.join(tmp, 'model.tmp'),
          verifiedPath,
          spec: {
            modelUrl: 'https://cdn.knowtation-models.com/model.gguf',
            expectedDigest: sha256(expected),
            expectedSizeBytes: expected.length,
            allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
          },
        }),
        /integrity_failed/,
      );
      await assert.rejects(() => readFile(verifiedPath), /ENOENT/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('loopback token rotation data boundary', () => {
  it('makes the old loopback token inert after a new listener starts', async () => {
    let hits = 0;
    const listener = createCompanionInferenceListener({
      expectedToken: 'new-loopback-token',
      runtimeRequest(_req, res) {
        hits += 1;
        res.statusCode = 200;
        res.end('ok');
      },
    });
    const bound = await listener.start();
    try {
      const url = `http://127.0.0.1:${bound.port}/v1/models`;
      const oldToken = await fetch(url, { headers: { Authorization: 'Bearer old-loopback-token' } });
      assert.equal(oldToken.status, 401);
      assert.equal(hits, 0);
      const newToken = await fetch(url, { headers: { Authorization: 'Bearer new-loopback-token' } });
      assert.equal(newToken.status, 200);
      assert.equal(hits, 1);
    } finally {
      await listener.close();
    }
  });
});
