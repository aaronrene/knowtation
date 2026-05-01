/**
 * Mocked API tests for the 3 SaaS bridges that Paperclip uses to build the video factory:
 *   - HeyGen render bridge (Custom Digital Twin avatar speaks the script)
 *   - ElevenLabs TTS bridge (Pro Voice Clone backup audio)
 *   - Descript import bridge (auto-edit + caption + 5-clip slicing)
 *
 * Per Aaron's Rule #0: every bridge has a test before it ships to AWS.
 * Per Aaron's Rule #5: tests cover happy path AND error paths AND timeout paths
 * AND validation boundaries.
 *
 * These tests use injected fetch + sleep so no real API calls are made and the
 * polling loops complete in microseconds rather than the 10-second real interval.
 *
 * Run: node --test test/paperclip-bridges.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHeyGenClient } from '../deploy/paperclip/skills/heygen-render.mjs';
import { createElevenLabsClient } from '../deploy/paperclip/skills/elevenlabs-tts.mjs';
import { createDescriptClient } from '../deploy/paperclip/skills/descript-import.mjs';

/**
 * Build a fake fetch that consumes scripted responses in order.
 * @param {Array<{ status?: number, body?: any, contentType?: string, audioBytes?: number }>} responses
 */
function makeFakeFetch(responses) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    calls.push({ url: String(url), init });
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      statusText: r.statusText ?? 'OK',
      headers: {
        get: (name) => {
          if (String(name).toLowerCase() === 'content-type')
            return r.contentType ?? 'application/json';
          return null;
        },
      },
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
      arrayBuffer: async () => new ArrayBuffer(r.audioBytes ?? 0),
    };
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {}; // make poll loops instant

// ============================================================
// HeyGen — render
// ============================================================

describe('createHeyGenClient — required options', () => {
  it('throws if apiKey missing', () => {
    assert.throws(() => createHeyGenClient({ fetch: () => {} }), /apiKey required/);
  });
  it('throws if fetch missing', () => {
    assert.throws(() => createHeyGenClient({ apiKey: 'k', fetch: null }), /fetch required/);
  });
});

describe('HeyGen submitRender — request shape', () => {
  it('POSTs to /v2/video/generate with correct body, headers, and X-Api-Key', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { data: { video_id: 'vid_123' } } },
    ]);
    const client = createHeyGenClient({ apiKey: 'sk_test', fetch: fetchImpl, sleep: noSleep });

    const r = await client.submitRender({
      script: 'Hello world.',
      avatarId: 'avatar_abc',
      voiceId: 'voice_xyz',
    });

    assert.equal(r.video_id, 'vid_123');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['X-Api-Key'], 'sk_test');
    assert.match(calls[0].url, /\/v2\/video\/generate$/);

    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.video_inputs[0].character.avatar_id, 'avatar_abc');
    assert.equal(sent.video_inputs[0].voice.voice_id, 'voice_xyz');
    assert.equal(sent.video_inputs[0].voice.input_text, 'Hello world.');
    assert.deepEqual(sent.dimension, { width: 1920, height: 1080 });
  });

  it('uses 720p dimension when quality=720p', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { data: { video_id: 'v' } } },
    ]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await client.submitRender({
      script: 'x',
      avatarId: 'a',
      voiceId: 'v',
      quality: '720p',
    });
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent.dimension, { width: 1280, height: 720 });
  });

  it('throws when API returns non-2xx', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 401, body: { message: 'invalid api key' } },
    ]);
    const client = createHeyGenClient({ apiKey: 'wrong', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.submitRender({ script: 'x', avatarId: 'a', voiceId: 'v' }),
      (err) => err.status === 401 && /heygen_submit_401/.test(err.message)
    );
  });

  it('throws HEYGEN_MISSING_VIDEO_ID when API returns 200 but no video_id', async () => {
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: { data: {} } }]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.submitRender({ script: 'x', avatarId: 'a', voiceId: 'v' }),
      (err) => err.code === 'HEYGEN_MISSING_VIDEO_ID'
    );
  });
});

describe('HeyGen submitRender — input validation', () => {
  const client = createHeyGenClient({ apiKey: 'k', fetch: () => {}, sleep: noSleep });
  it('rejects empty script', async () => {
    await assert.rejects(
      client.submitRender({ script: '', avatarId: 'a', voiceId: 'v' }),
      (err) => err.code === 'HEYGEN_INVALID_SCRIPT'
    );
  });
  it('rejects script > 30000 chars', async () => {
    await assert.rejects(
      client.submitRender({ script: 'x'.repeat(30_001), avatarId: 'a', voiceId: 'v' }),
      (err) => err.code === 'HEYGEN_SCRIPT_TOO_LONG'
    );
  });
  it('rejects empty avatarId', async () => {
    await assert.rejects(
      client.submitRender({ script: 's', avatarId: '', voiceId: 'v' }),
      (err) => err.code === 'HEYGEN_INVALID_AVATAR_ID'
    );
  });
  it('rejects empty voiceId', async () => {
    await assert.rejects(
      client.submitRender({ script: 's', avatarId: 'a', voiceId: '' }),
      (err) => err.code === 'HEYGEN_INVALID_VOICE_ID'
    );
  });
});

describe('HeyGen pollStatus — completion paths', () => {
  it('returns video_url when status=completed', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      {
        status: 200,
        body: {
          data: {
            status: 'completed',
            video_url: 'https://heygen.cdn/abc.mp4',
            duration: 240,
          },
        },
      },
    ]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    const r = await client.pollStatus('vid_1', { intervalMs: 1, timeoutMs: 1000 });
    assert.equal(r.status, 'completed');
    assert.equal(r.video_url, 'https://heygen.cdn/abc.mp4');
    assert.equal(r.duration_seconds, 240);
    assert.match(calls[0].url, /video_status\.get\?video_id=vid_1/);
  });

  it('polls through processing -> completed', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { data: { status: 'pending' } } },
      { status: 200, body: { data: { status: 'processing' } } },
      {
        status: 200,
        body: { data: { status: 'completed', video_url: 'https://heygen.cdn/x.mp4', duration: 60 } },
      },
    ]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    const r = await client.pollStatus('vid_1', { intervalMs: 1, timeoutMs: 10_000 });
    assert.equal(r.video_url, 'https://heygen.cdn/x.mp4');
    assert.equal(calls.length, 3);
  });

  it('throws HEYGEN_RENDER_FAILED when status=failed', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { data: { status: 'failed', error: 'avatar not found' } } },
    ]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.pollStatus('vid_1', { intervalMs: 1, timeoutMs: 1000 }),
      (err) => err.code === 'HEYGEN_RENDER_FAILED' && /avatar not found/.test(err.message)
    );
  });

  it('throws HEYGEN_COMPLETED_BUT_NO_URL when API returns completed without URL', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { data: { status: 'completed' } } },
    ]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.pollStatus('vid_1', { intervalMs: 1, timeoutMs: 1000 }),
      (err) => err.code === 'HEYGEN_COMPLETED_BUT_NO_URL'
    );
  });

  it('throws HEYGEN_POLL_TIMEOUT when poll exceeds timeoutMs', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { data: { status: 'processing' } } },
    ]);
    // Use a real (tiny) sleep so the timeout actually elapses.
    const client = createHeyGenClient({
      apiKey: 'k',
      fetch: fetchImpl,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    await assert.rejects(
      client.pollStatus('vid_1', { intervalMs: 5, timeoutMs: 25 }),
      (err) => err.code === 'HEYGEN_POLL_TIMEOUT' && err.videoId === 'vid_1'
    );
  });
});

describe('HeyGen render — end-to-end (submit + poll)', () => {
  it('submits, polls processing, returns completed result', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { data: { video_id: 'v_e2e' } } },
      { status: 200, body: { data: { status: 'processing' } } },
      {
        status: 200,
        body: { data: { status: 'completed', video_url: 'https://heygen.cdn/e2e.mp4', duration: 90 } },
      },
    ]);
    const client = createHeyGenClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    const r = await client.render({
      script: 'Hello, factory.',
      avatarId: 'a1',
      voiceId: 'v1',
      pollIntervalMs: 1,
      pollTimeoutMs: 5000,
    });
    assert.equal(r.video_id, 'v_e2e');
    assert.equal(r.video_url, 'https://heygen.cdn/e2e.mp4');
    assert.equal(r.duration_seconds, 90);
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[1].url, /video_status\.get/);
    assert.match(calls[2].url, /video_status\.get/);
  });
});

// ============================================================
// ElevenLabs — TTS + quota
// ============================================================

describe('createElevenLabsClient', () => {
  it('throws if apiKey missing', () => {
    assert.throws(() => createElevenLabsClient({ fetch: () => {} }), /apiKey required/);
  });
});

describe('ElevenLabs tts', () => {
  it('POSTs to /v1/text-to-speech/{voiceId} with correct body, xi-api-key header, accepts audio/mpeg', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, audioBytes: 1234, contentType: 'audio/mpeg' },
    ]);
    const client = createElevenLabsClient({ apiKey: 'xi_test', fetch: fetchImpl });
    const r = await client.tts({
      text: 'Hello',
      voiceId: 'voice_aaa',
      stability: 0.6,
      similarityBoost: 0.8,
    });

    assert.ok(r.audio instanceof ArrayBuffer);
    assert.equal(r.audio.byteLength, 1234);
    assert.equal(r.contentType, 'audio/mpeg');
    assert.equal(r.voiceId, 'voice_aaa');
    assert.equal(r.modelId, 'eleven_multilingual_v2');

    assert.match(calls[0].url, /\/v1\/text-to-speech\/voice_aaa$/);
    assert.equal(calls[0].init.headers['xi-api-key'], 'xi_test');
    assert.equal(calls[0].init.headers.Accept, 'audio/mpeg');

    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.text, 'Hello');
    assert.equal(sent.model_id, 'eleven_multilingual_v2');
    assert.equal(sent.voice_settings.stability, 0.6);
    assert.equal(sent.voice_settings.similarity_boost, 0.8);
  });

  it('clamps voice settings to 0..1', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, audioBytes: 100 },
    ]);
    const client = createElevenLabsClient({ apiKey: 'k', fetch: fetchImpl });
    await client.tts({
      text: 'x',
      voiceId: 'v',
      stability: 5,        // out of range
      similarityBoost: -2, // out of range
    });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.voice_settings.stability, 1);
    assert.equal(sent.voice_settings.similarity_boost, 0);
  });

  it('rejects empty text', async () => {
    const client = createElevenLabsClient({ apiKey: 'k', fetch: () => {} });
    await assert.rejects(
      client.tts({ text: '', voiceId: 'v' }),
      (err) => err.code === 'ELEVENLABS_INVALID_TEXT'
    );
  });

  it('rejects text > 5000 chars (forces caller to chunk)', async () => {
    const client = createElevenLabsClient({ apiKey: 'k', fetch: () => {} });
    await assert.rejects(
      client.tts({ text: 'x'.repeat(5001), voiceId: 'v' }),
      (err) => err.code === 'ELEVENLABS_TEXT_TOO_LONG'
    );
  });

  it('rejects empty voiceId', async () => {
    const client = createElevenLabsClient({ apiKey: 'k', fetch: () => {} });
    await assert.rejects(
      client.tts({ text: 'x', voiceId: '' }),
      (err) => err.code === 'ELEVENLABS_INVALID_VOICE_ID'
    );
  });

  it('throws structured error on 401', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 401, body: { detail: { message: 'invalid api key' } } },
    ]);
    const client = createElevenLabsClient({ apiKey: 'wrong', fetch: fetchImpl });
    await assert.rejects(
      client.tts({ text: 'x', voiceId: 'v' }),
      (err) => err.status === 401 && /elevenlabs_401/.test(err.message)
    );
  });
});

describe('ElevenLabs getQuota', () => {
  it('returns characterCount, characterLimit, remaining', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { character_count: 25_000, character_limit: 100_000 } },
    ]);
    const client = createElevenLabsClient({ apiKey: 'k', fetch: fetchImpl });
    const q = await client.getQuota();
    assert.deepEqual(q, { characterCount: 25_000, characterLimit: 100_000, remaining: 75_000 });
  });

  it('clamps remaining to 0 when overage', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { character_count: 110_000, character_limit: 100_000 } },
    ]);
    const client = createElevenLabsClient({ apiKey: 'k', fetch: fetchImpl });
    const q = await client.getQuota();
    assert.equal(q.remaining, 0);
  });
});

// ============================================================
// Descript — import
// ============================================================

describe('createDescriptClient', () => {
  it('throws if apiKey missing', () => {
    assert.throws(() => createDescriptClient({ fetch: () => {} }), /apiKey required/);
  });
});

describe('Descript submitImport', () => {
  it('POSTs to /v1/projects/{id}/imports with auth, body shape', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { import_id: 'imp_1' } },
    ]);
    const client = createDescriptClient({ apiKey: 'ds_test', fetch: fetchImpl, sleep: noSleep });
    const r = await client.submitImport({
      projectId: 'proj_bornfree',
      videoUrl: 'https://heygen.cdn/x.mp4',
      title: 'Born Free Episode 1',
    });
    assert.equal(r.import_id, 'imp_1');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer ds_test');
    assert.match(calls[0].url, /\/v1\/projects\/proj_bornfree\/imports$/);

    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent.source, { type: 'url', url: 'https://heygen.cdn/x.mp4' });
    assert.equal(sent.auto_transcribe, true);
    assert.equal(sent.auto_generate_shorts, true);
    assert.equal(sent.title, 'Born Free Episode 1');
  });

  it('rejects invalid videoUrl (not http/https)', async () => {
    const client = createDescriptClient({ apiKey: 'k', fetch: () => {}, sleep: noSleep });
    await assert.rejects(
      client.submitImport({ projectId: 'p', videoUrl: 'file:///etc/passwd' }),
      (err) => err.code === 'DESCRIPT_INVALID_VIDEO_URL'
    );
  });

  it('rejects empty projectId', async () => {
    const client = createDescriptClient({ apiKey: 'k', fetch: () => {}, sleep: noSleep });
    await assert.rejects(
      client.submitImport({ projectId: '', videoUrl: 'https://x.com/y.mp4' }),
      (err) => err.code === 'DESCRIPT_INVALID_PROJECT_ID'
    );
  });

  it('throws DESCRIPT_MISSING_IMPORT_ID when API returns 200 with no id', async () => {
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: {} }]);
    const client = createDescriptClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.submitImport({ projectId: 'p', videoUrl: 'https://x.com/y.mp4' }),
      (err) => err.code === 'DESCRIPT_MISSING_IMPORT_ID'
    );
  });

  it('throws structured error on 403', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 403, body: { error: 'project not found' } },
    ]);
    const client = createDescriptClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.submitImport({ projectId: 'p', videoUrl: 'https://x.com/y.mp4' }),
      (err) => err.status === 403
    );
  });
});

describe('Descript pollImport', () => {
  it('returns ready status with shorts array', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      {
        status: 200,
        body: {
          status: 'ready',
          project_id: 'proj_x',
          media_id: 'media_y',
          transcript_url: 'https://d.cdn/t.txt',
          shorts: [
            { id: 's1', start: 0, end: 60, suggested_title: 'Hook 1' },
            { id: 's2', start: 90, end: 150, suggested_title: 'Hook 2' },
          ],
        },
      },
    ]);
    const client = createDescriptClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    const r = await client.pollImport('imp_1', { intervalMs: 1, timeoutMs: 1000 });
    assert.equal(r.status, 'ready');
    assert.equal(r.shorts.length, 2);
    assert.match(calls[0].url, /\/v1\/imports\/imp_1$/);
  });

  it('polls processing -> ready', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { status: 'processing' } },
      { status: 200, body: { status: 'processing' } },
      { status: 200, body: { status: 'ready', project_id: 'p', media_id: 'm' } },
    ]);
    const client = createDescriptClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    const r = await client.pollImport('imp_1', { intervalMs: 1, timeoutMs: 5000 });
    assert.equal(r.status, 'ready');
  });

  it('throws DESCRIPT_IMPORT_FAILED on status=failed', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { status: 'failed', error: 'codec unsupported' } },
    ]);
    const client = createDescriptClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      client.pollImport('imp_1', { intervalMs: 1, timeoutMs: 1000 }),
      (err) => err.code === 'DESCRIPT_IMPORT_FAILED'
    );
  });

  it('throws DESCRIPT_POLL_TIMEOUT', async () => {
    const { fetchImpl } = makeFakeFetch([
      { status: 200, body: { status: 'processing' } },
    ]);
    const client = createDescriptClient({
      apiKey: 'k',
      fetch: fetchImpl,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    await assert.rejects(
      client.pollImport('imp_1', { intervalMs: 5, timeoutMs: 25 }),
      (err) => err.code === 'DESCRIPT_POLL_TIMEOUT'
    );
  });
});

describe('Descript end-to-end import', () => {
  it('submits then polls to ready', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: { import_id: 'imp_e2e' } },
      { status: 200, body: { status: 'processing' } },
      {
        status: 200,
        body: { status: 'ready', project_id: 'p', media_id: 'm', shorts: [] },
      },
    ]);
    const client = createDescriptClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
    const r = await client.import({
      projectId: 'p',
      videoUrl: 'https://heygen.cdn/abc.mp4',
      pollIntervalMs: 1,
      pollTimeoutMs: 5000,
    });
    assert.equal(r.status, 'ready');
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[1].url, /\/v1\/imports\//);
  });
});
