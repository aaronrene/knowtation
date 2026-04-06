/**
 * Audio/video importer: file checks, dry-run skips Whisper, happy path with mocked fetch.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { importAudio, importVideo } from '../lib/importers/audio.mjs';
import { readNote } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('importAudio / importVideo', () => {
  let vault;
  let tmpDir;
  let origFetch;
  let origKey;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-audio-vault-'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-audio-in-'));
    origFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'sk-test-mock';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.OPENAI_API_KEY;
    try {
      fs.rmSync(vault, { recursive: true, force: true });
    } catch (_) {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  const ctxBase = (dryRun) => ({
    vaultPath: vault,
    outputBase: 'inbox',
    project: undefined,
    tags: [],
    dryRun,
  });

  it('throws when input file is missing', async () => {
    await assert.rejects(
      () => importAudio(path.join(tmpDir, 'missing.mp3'), ctxBase(false)),
      /file not found/i
    );
  });

  it('throws on unsupported extension', async () => {
    const p = path.join(tmpDir, 'x.ogg');
    fs.writeFileSync(p, 'x');
    await assert.rejects(() => importAudio(p, ctxBase(false)), /Unsupported format/);
  });

  it('dryRun does not call OpenAI and does not write a note', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ text: 'should not run' }), { status: 200 });
    };

    const p = path.join(tmpDir, 'clip.mp3');
    fs.writeFileSync(p, Buffer.from([0, 0, 0]));

    const result = await importAudio(p, ctxBase(true));
    assert.strictEqual(fetchCalls, 0);
    assert.strictEqual(result.count, 1);
    assert.ok(result.imported[0].path.includes('audio_'));
    assert.throws(() => readNote(vault, result.imported[0].path), /Note not found/);
  });

  it('writes note with transcript when not dryRun (fetch mocked)', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ text: 'Fixture transcript line.' }), { status: 200 });

    const p = path.join(tmpDir, 'talk.m4a');
    fs.writeFileSync(p, Buffer.from([0, 1, 2, 3]));

    const result = await importAudio(p, ctxBase(false));
    assert.strictEqual(result.count, 1);
    const note = readNote(vault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'audio');
    assert.strictEqual(note.frontmatter.title, 'talk');
    assert.ok(String(note.body || '').includes('Fixture transcript'));
  });

  it('importVideo sets source: video', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ text: 'Video track speech.' }), { status: 200 });

    const p = path.join(tmpDir, 'clip.mp4');
    fs.writeFileSync(p, Buffer.from([0, 1, 2, 3]));

    const result = await importVideo(p, ctxBase(false));
    const note = readNote(vault, result.imported[0].path);
    assert.strictEqual(note.frontmatter.source, 'video');
    assert.ok(result.imported[0].path.includes('video_'));
  });
});
