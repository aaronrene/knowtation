import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('getRepoRoot', () => {
  it('returns process.cwd when NETLIFY is set (bundled functions avoid import.meta.url)', async () => {
    const prevN = process.env.NETLIFY;
    const prevA = process.env.AWS_LAMBDA_FUNCTION_NAME;
    try {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      process.env.NETLIFY = 'true';
      const { getRepoRoot } = await import('../lib/repo-root.mjs');
      assert.strictEqual(getRepoRoot(), process.cwd());
    } finally {
      if (prevN === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = prevN;
      if (prevA === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      else process.env.AWS_LAMBDA_FUNCTION_NAME = prevA;
    }
  });
});
