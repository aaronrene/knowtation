/**
 * readTranscriptionYaml defaults and yaml slice (no full loadConfig).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('readTranscriptionYaml', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-rty-'));
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  });

  it('returns defaults when no local.yaml', async () => {
    const { readTranscriptionYaml } = await import(`../lib/config.mjs?t=${Date.now()}`);
    const y = readTranscriptionYaml(tmp);
    assert.strictEqual(y.model, 'whisper-1');
    assert.strictEqual(y.transcode_oversized, true);
  });

  it('reads transcode_oversized false from yaml', async () => {
    const cfgDir = path.join(tmp, 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'local.yaml'),
      'transcription:\n  transcode_oversized: false\n  model: whisper-1\n'
    );
    const { readTranscriptionYaml } = await import(`../lib/config.mjs?t=${Date.now() + 1}`);
    const y = readTranscriptionYaml(tmp);
    assert.strictEqual(y.transcode_oversized, false);
  });
});
