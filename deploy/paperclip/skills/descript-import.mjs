/**
 * Descript import bridge.
 *
 * Pushes a finished MP4 (typically the HeyGen render output URL) into a Descript
 * project so Descript's auto-edit pipeline can:
 *   - transcribe the audio
 *   - generate animated captions
 *   - cut filler words
 *   - propose 5 short-form clips per long-form
 *
 * Descript's public API surface is documented at https://www.descript.com/api.
 * The exact endpoint shape may evolve; this module wraps a stable interface and
 * isolates Paperclip from API drift.
 *
 * Two-step flow:
 *   1. POST /v1/projects/{project_id}/imports — submit the MP4 URL, returns import_id
 *   2. GET  /v1/imports/{import_id} — poll until status == 'ready'
 *
 * @typedef {object} DescriptImportArgs
 * @property {string} projectId   Descript project ID for the project (born-free / store-free / knowtation).
 * @property {string} videoUrl    Public URL of the MP4 (HeyGen output). Descript fetches it server-side.
 * @property {string} [title]     Display title in Descript UI.
 * @property {boolean} [autoTranscribe=true]
 * @property {boolean} [autoGenerateShorts=true]
 * @property {number} [pollIntervalMs=10000]
 * @property {number} [pollTimeoutMs=600000]    10 min default.
 *
 * @typedef {object} DescriptClientOptions
 * @property {string} apiKey
 * @property {string} [baseUrl]   Default 'https://api.descript.com'.
 * @property {typeof fetch} [fetch]
 * @property {(ms:number)=>Promise<void>} [sleep]
 */

const DS_DEFAULT_BASE_URL = 'https://api.descript.com';

/**
 * @param {DescriptClientOptions} opts
 * @returns {{
 *   import: (args: DescriptImportArgs) => Promise<{ import_id: string, project_id: string, status: 'ready', media_id: string, transcript_url?: string, shorts?: Array<{ id: string, start: number, end: number, suggested_title: string }> }>,
 *   submitImport: (args: DescriptImportArgs) => Promise<{ import_id: string }>,
 *   pollImport: (importId: string, opts?: { intervalMs?: number, timeoutMs?: number }) => Promise<any>,
 * }}
 */
export function createDescriptClient(opts) {
  const {
    apiKey,
    baseUrl = DS_DEFAULT_BASE_URL,
    fetch: fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  if (!apiKey) throw new Error('createDescriptClient: apiKey required');
  if (typeof fetchImpl !== 'function') throw new Error('createDescriptClient: fetch required');

  const headers = () => ({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  async function submitImport(args) {
    validate(args);
    const body = {
      source: { type: 'url', url: args.videoUrl },
      title: args.title ?? null,
      auto_transcribe: args.autoTranscribe ?? true,
      auto_generate_shorts: args.autoGenerateShorts ?? true,
    };

    const res = await fetchImpl(
      `${baseUrl}/v1/projects/${encodeURIComponent(args.projectId)}/imports`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errBody = await safeJson(res);
      throw Object.assign(
        new Error(
          `descript_submit_${res.status}: ${errBody?.error || errBody?.message || 'import failed'}`
        ),
        { code: `DESCRIPT_SUBMIT_${res.status}`, status: res.status, body: errBody }
      );
    }

    const data = await res.json();
    const importId = data?.import_id ?? data?.id;
    if (!importId) {
      throw Object.assign(new Error('descript_missing_import_id'), {
        code: 'DESCRIPT_MISSING_IMPORT_ID',
        body: data,
      });
    }
    return { import_id: String(importId) };
  }

  async function pollImport(importId, options = {}) {
    const intervalMs = options.intervalMs ?? 10_000;
    const timeoutMs = options.timeoutMs ?? 600_000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const res = await fetchImpl(`${baseUrl}/v1/imports/${encodeURIComponent(importId)}`, {
        method: 'GET',
        headers: headers(),
      });

      if (!res.ok) {
        const errBody = await safeJson(res);
        throw Object.assign(
          new Error(`descript_poll_${res.status}`),
          { code: `DESCRIPT_POLL_${res.status}`, status: res.status, body: errBody }
        );
      }

      const data = await res.json();
      const status = String(data?.status ?? '').toLowerCase();
      if (status === 'ready') {
        return {
          import_id: importId,
          project_id: String(data?.project_id ?? ''),
          status: 'ready',
          media_id: String(data?.media_id ?? ''),
          transcript_url: data?.transcript_url,
          shorts: Array.isArray(data?.shorts) ? data.shorts : undefined,
        };
      }
      if (status === 'failed') {
        throw Object.assign(new Error(`descript_import_failed: ${data?.error ?? 'unknown'}`), {
          code: 'DESCRIPT_IMPORT_FAILED',
          body: data,
        });
      }
      await sleep(intervalMs);
    }

    throw Object.assign(new Error(`descript_poll_timeout after ${timeoutMs}ms`), {
      code: 'DESCRIPT_POLL_TIMEOUT',
      importId,
    });
  }

  async function importVideo(args) {
    const { import_id } = await submitImport(args);
    return pollImport(import_id, {
      intervalMs: args.pollIntervalMs,
      timeoutMs: args.pollTimeoutMs,
    });
  }

  return { import: importVideo, submitImport, pollImport };
}

function validate(args) {
  if (!args || typeof args !== 'object') {
    throw Object.assign(new Error('descript_invalid_args'), { code: 'DESCRIPT_INVALID_ARGS' });
  }
  if (typeof args.projectId !== 'string' || !args.projectId.trim()) {
    throw Object.assign(new Error('descript_invalid_project_id'), {
      code: 'DESCRIPT_INVALID_PROJECT_ID',
    });
  }
  if (typeof args.videoUrl !== 'string' || !/^https?:\/\//.test(args.videoUrl)) {
    throw Object.assign(new Error('descript_invalid_video_url'), {
      code: 'DESCRIPT_INVALID_VIDEO_URL',
    });
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (_e) {
    return null;
  }
}
