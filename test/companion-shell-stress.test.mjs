/**
 * Tier 4 — STRESS: Phase 5 listener churn and streamed model handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createOAuthRedirectAttempt } from '../lib/companion-oauth-flow.mjs';
import {
  createRuntimeGroup,
  downloadVerifyAndStageModel,
} from '../lib/companion-shell.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('OAuth redirect listener churn', () => {
  it('binds and tears down many one-shot listeners on ephemeral loopback ports', async () => {
    const ports = new Set();
    for (let i = 0; i < 20; i += 1) {
      const attempt = await createOAuthRedirectAttempt({
        expectedState: `state-${i}`,
        expectedIssuer: 'https://gateway.knowtation.com/api/v1/auth/native',
        timeoutMs: 500,
      });
      const redirect = new URL(attempt.redirectUri);
      assert.equal(redirect.hostname, '127.0.0.1');
      assert.notEqual(redirect.port, '');
      ports.add(redirect.port);
      attempt.close();
    }
    assert.ok(ports.size > 1, 'ephemeral bind did not vary across churn');
  });
});

describe('large streamed download stress', () => {
  it('streams a multi-megabyte payload in chunks without buffering in the adapter contract', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const chunks = Array.from({ length: 32 }, () => chunk);
    const data = Buffer.concat(chunks);
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'knowtation-phase5-stress-'));
    try {
      let seenChunks = 0;
      const runtimeGroup = createRuntimeGroup({
        async download(_url, onChunk) {
          for (const c of chunks) {
            seenChunks += 1;
            onChunk(c);
          }
        },
        async spawn() {
          return { pid: 1, kill: async () => {} };
        },
        async healthCheck() {
          return true;
        },
      });
      await downloadVerifyAndStageModel({
        runtimeGroup,
        tempPath: path.join(tmp, 'large.tmp'),
        verifiedPath: path.join(tmp, 'large.gguf'),
        spec: {
          modelUrl: 'https://cdn.knowtation-models.com/large.gguf',
          expectedDigest: sha256(data),
          expectedSizeBytes: data.length,
          allowedSourceUrls: ['https://cdn.knowtation-models.com/'],
        },
      });
      assert.equal(seenChunks, chunks.length);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
