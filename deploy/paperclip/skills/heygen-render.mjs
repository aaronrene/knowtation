/**
 * HeyGen render bridge.
 *
 * Calls HeyGen v2 API to render a Custom Digital Twin avatar speaking a script with
 * a chosen voice (typically a HeyGen voice paired to ElevenLabs).
 *
 * Two-step flow per HeyGen docs:
 *   1. POST /v2/video/generate — submits the render job, returns video_id
 *   2. GET /v1/video_status.get?video_id=... — poll until status == 'completed'
 *      (statuses: pending, processing, completed, failed)
 *
 * @typedef {object} HeyGenRenderArgs
 * @property {string}  script        The text the avatar speaks (≤30,000 chars).
 * @property {string}  avatarId      HeyGen avatar_id (the Custom Digital Twin ID).
 * @property {string}  voiceId       HeyGen voice_id (paired ElevenLabs voice).
 * @property {'1080p'|'720p'} [quality='1080p']
 * @property {number}  [pollIntervalMs=10000]
 * @property {number}  [pollTimeoutMs=1_200_000]   20 min default; HeyGen Avatar IV can take 5-10 min for 5 min content.
 *
 * @typedef {object} HeyGenClientOptions
 * @property {string} apiKey
 * @property {string} [baseUrl]      Default 'https://api.heygen.com'.
 * @property {typeof fetch} [fetch]
 * @property {(ms:number)=>Promise<void>} [sleep]  Inject for testing.
 */

const HEYGEN_DEFAULT_BASE_URL = 'https://api.heygen.com';

/**
 * @param {HeyGenClientOptions} opts
 * @returns {{
 *   render: (args: HeyGenRenderArgs) => Promise<{ video_id: string, video_url: string, duration_seconds: number, status: 'completed' }>,
 *   submitRender: (args: HeyGenRenderArgs) => Promise<{ video_id: string }>,
 *   pollStatus: (videoId: string, opts?: { intervalMs?: number, timeoutMs?: number }) => Promise<{ video_id: string, video_url: string, duration_seconds: number, status: 'completed' }>,
 * }}
 */
export function createHeyGenClient(opts) {
  const {
    apiKey,
    baseUrl = HEYGEN_DEFAULT_BASE_URL,
    fetch: fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  if (!apiKey) throw new Error('createHeyGenClient: apiKey required');
  if (typeof fetchImpl !== 'function') throw new Error('createHeyGenClient: fetch required');

  const headers = () => ({
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  async function submitRender(args) {
    validateRenderArgs(args);
    const body = {
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: args.avatarId,
            avatar_style: 'normal',
          },
          voice: {
            type: 'text',
            input_text: args.script,
            voice_id: args.voiceId,
          },
        },
      ],
      dimension: dimensionFor(args.quality ?? '1080p'),
      test: false,
    };

    const res = await fetchImpl(`${baseUrl}/v2/video/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await safeJson(res);
      throw heygenError(res.status, text, 'submit');
    }

    const data = await res.json();
    const videoId = data?.data?.video_id ?? data?.video_id;
    if (!videoId) {
      throw Object.assign(new Error('heygen_missing_video_id'), {
        code: 'HEYGEN_MISSING_VIDEO_ID',
        body: data,
      });
    }
    return { video_id: String(videoId) };
  }

  async function pollStatus(videoId, options = {}) {
    const intervalMs = options.intervalMs ?? 10_000;
    const timeoutMs = options.timeoutMs ?? 1_200_000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const res = await fetchImpl(
        `${baseUrl}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
        { method: 'GET', headers: headers() }
      );

      if (!res.ok) {
        const text = await safeJson(res);
        throw heygenError(res.status, text, 'status');
      }

      const data = await res.json();
      const node = data?.data ?? data ?? {};
      const status = String(node.status ?? '').toLowerCase();

      if (status === 'completed') {
        const video_url = String(node.video_url ?? '');
        if (!video_url) {
          throw Object.assign(new Error('heygen_completed_but_no_url'), {
            code: 'HEYGEN_COMPLETED_BUT_NO_URL',
            body: data,
          });
        }
        return {
          video_id: videoId,
          video_url,
          duration_seconds: Number(node.duration ?? 0),
          status: 'completed',
        };
      }
      if (status === 'failed') {
        throw Object.assign(new Error(`heygen_render_failed: ${node.error ?? 'unknown'}`), {
          code: 'HEYGEN_RENDER_FAILED',
          body: data,
        });
      }

      await sleep(intervalMs);
    }

    throw Object.assign(new Error(`heygen_poll_timeout after ${timeoutMs}ms`), {
      code: 'HEYGEN_POLL_TIMEOUT',
      videoId,
    });
  }

  async function render(args) {
    const { video_id } = await submitRender(args);
    return pollStatus(video_id, {
      intervalMs: args.pollIntervalMs,
      timeoutMs: args.pollTimeoutMs,
    });
  }

  return { render, submitRender, pollStatus };
}

function validateRenderArgs(args) {
  if (!args || typeof args !== 'object') {
    throw Object.assign(new Error('heygen_invalid_args'), { code: 'HEYGEN_INVALID_ARGS' });
  }
  if (typeof args.script !== 'string' || !args.script.trim()) {
    throw Object.assign(new Error('heygen_invalid_script'), { code: 'HEYGEN_INVALID_SCRIPT' });
  }
  if (args.script.length > 30_000) {
    throw Object.assign(new Error('heygen_script_too_long'), { code: 'HEYGEN_SCRIPT_TOO_LONG' });
  }
  if (typeof args.avatarId !== 'string' || !args.avatarId.trim()) {
    throw Object.assign(new Error('heygen_invalid_avatar_id'), {
      code: 'HEYGEN_INVALID_AVATAR_ID',
    });
  }
  if (typeof args.voiceId !== 'string' || !args.voiceId.trim()) {
    throw Object.assign(new Error('heygen_invalid_voice_id'), {
      code: 'HEYGEN_INVALID_VOICE_ID',
    });
  }
}

function dimensionFor(quality) {
  if (quality === '720p') return { width: 1280, height: 720 };
  return { width: 1920, height: 1080 };
}

function heygenError(status, body, stage) {
  return Object.assign(
    new Error(`heygen_${stage}_${status}: ${body?.message || body?.error || 'request failed'}`),
    { code: `HEYGEN_${stage.toUpperCase()}_${status}`, status, body }
  );
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (_e) {
    return null;
  }
}
