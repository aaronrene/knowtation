/**
 * ElevenLabs text-to-speech bridge.
 *
 * Used as a backup voice path for non-HeyGen audio (podcasts, audio-only newsletter).
 * For the main video pipeline, the voice clone lives INSIDE HeyGen via their
 * ElevenLabs integration — the script is sent to HeyGen, not here.
 *
 * Calls POST /v1/text-to-speech/{voice_id} which returns audio bytes (mp3 by default).
 * We keep the response as ArrayBuffer; the caller writes it to disk or uploads to S3.
 *
 * @typedef {object} ElevenLabsTtsArgs
 * @property {string} text              ≤5000 chars per request.
 * @property {string} voiceId           Pro Voice Clone ID.
 * @property {string} [modelId]         Default 'eleven_multilingual_v2'.
 * @property {number} [stability]       0.0–1.0 (default 0.5).
 * @property {number} [similarityBoost] 0.0–1.0 (default 0.75).
 *
 * @typedef {object} ElevenLabsClientOptions
 * @property {string} apiKey
 * @property {string} [baseUrl]   Default 'https://api.elevenlabs.io'.
 * @property {typeof fetch} [fetch]
 */

const EL_DEFAULT_BASE_URL = 'https://api.elevenlabs.io';

/**
 * @param {ElevenLabsClientOptions} opts
 * @returns {{
 *   tts: (args: ElevenLabsTtsArgs) => Promise<{ audio: ArrayBuffer, contentType: string, voiceId: string, modelId: string }>,
 *   getQuota: () => Promise<{ characterCount: number, characterLimit: number, remaining: number }>,
 * }}
 */
export function createElevenLabsClient(opts) {
  const {
    apiKey,
    baseUrl = EL_DEFAULT_BASE_URL,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;

  if (!apiKey) throw new Error('createElevenLabsClient: apiKey required');
  if (typeof fetchImpl !== 'function') throw new Error('createElevenLabsClient: fetch required');

  async function tts(args) {
    validateTtsArgs(args);
    const voiceId = args.voiceId;
    const modelId = args.modelId ?? 'eleven_multilingual_v2';

    const body = {
      text: args.text,
      model_id: modelId,
      voice_settings: {
        stability: clamp01(args.stability ?? 0.5),
        similarity_boost: clamp01(args.similarityBoost ?? 0.75),
      },
    };

    const res = await fetchImpl(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await safeJson(res);
      throw Object.assign(
        new Error(`elevenlabs_${res.status}: ${errBody?.detail?.message || errBody?.message || 'tts failed'}`),
        { code: `ELEVENLABS_${res.status}`, status: res.status, body: errBody }
      );
    }

    const audio = await res.arrayBuffer();
    const contentType = res.headers?.get?.('content-type') ?? 'audio/mpeg';

    return { audio, contentType, voiceId, modelId };
  }

  async function getQuota() {
    const res = await fetchImpl(`${baseUrl}/v1/user/subscription`, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await safeJson(res);
      throw Object.assign(new Error(`elevenlabs_quota_${res.status}`), {
        code: `ELEVENLABS_QUOTA_${res.status}`,
        status: res.status,
        body,
      });
    }
    const data = await res.json();
    const characterCount = Number(data?.character_count ?? 0);
    const characterLimit = Number(data?.character_limit ?? 0);
    return {
      characterCount,
      characterLimit,
      remaining: Math.max(0, characterLimit - characterCount),
    };
  }

  return { tts, getQuota };
}

function validateTtsArgs(args) {
  if (!args || typeof args !== 'object') {
    throw Object.assign(new Error('elevenlabs_invalid_args'), { code: 'ELEVENLABS_INVALID_ARGS' });
  }
  if (typeof args.text !== 'string' || !args.text.trim()) {
    throw Object.assign(new Error('elevenlabs_invalid_text'), { code: 'ELEVENLABS_INVALID_TEXT' });
  }
  if (args.text.length > 5000) {
    throw Object.assign(new Error('elevenlabs_text_too_long: chunk into <=5000-char calls'), {
      code: 'ELEVENLABS_TEXT_TOO_LONG',
    });
  }
  if (typeof args.voiceId !== 'string' || !args.voiceId.trim()) {
    throw Object.assign(new Error('elevenlabs_invalid_voice_id'), {
      code: 'ELEVENLABS_INVALID_VOICE_ID',
    });
  }
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (_e) {
    return null;
  }
}
