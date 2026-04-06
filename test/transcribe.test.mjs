/**
 * Transcription helper: validation, size limit, OpenAI response handling (fetch mocked).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { transcribe, WHISPER_MAX_FILE_BYTES } from '../lib/transcribe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('transcribe()', () => {
  let tmpDir;
  let origFetch;
  let origKey;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-tr-'));
    origFetch = globalThis.fetch;
    origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-mock-key';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = origKey;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('throws when file is missing', async () => {
    const p = path.join(tmpDir, 'nope.mp3');
    await assert.rejects(() => transcribe(p), /File not found/);
  });

  it('throws on unsupported extension', async () => {
    const p = path.join(tmpDir, 'x.flac');
    fs.writeFileSync(p, Buffer.from('x'));
    await assert.rejects(() => transcribe(p), /Unsupported format/);
  });

  it('throws when file exceeds WHISPER_MAX_FILE_BYTES', async () => {
    const p = path.join(tmpDir, 'huge.wav');
    const fd = fs.openSync(p, 'w');
    try {
      fs.ftruncateSync(fd, WHISPER_MAX_FILE_BYTES + 1);
    } finally {
      fs.closeSync(fd);
    }
    await assert.rejects(() => transcribe(p, { transcodeOversized: false }), /25MB/);
  });

  it('throws when OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY;
    const p = path.join(tmpDir, 'a.mp3');
    fs.writeFileSync(p, Buffer.from([0, 0, 0]));
    await assert.rejects(() => transcribe(p), /OPENAI_API_KEY/);
  });

  it('returns trimmed text from API JSON', async () => {
    const p = path.join(tmpDir, 'a.mp3');
    fs.writeFileSync(p, Buffer.from([0xff, 0xfb, 0x90, 0x00]));

    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /audio\/transcriptions/);
      assert.ok(init && init.headers && init.headers.Authorization);
      return new Response(JSON.stringify({ text: '  hello world  ' }), { status: 200 });
    };

    const out = await transcribe(p);
    assert.strictEqual(out.text, 'hello world');
    assert.strictEqual(out.transcoded, undefined);
  });

  it('propagates API errors', async () => {
    const p = path.join(tmpDir, 'b.m4a');
    fs.writeFileSync(p, Buffer.from([0, 1, 2]));

    globalThis.fetch = async () =>
      new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });

    await assert.rejects(() => transcribe(p), /429/);
  });
});
